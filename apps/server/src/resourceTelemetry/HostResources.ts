import * as NodeOS from "node:os";
import type { HostResourcesSnapshot } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class HostResources extends Context.Service<
  HostResources,
  { readonly read: Effect.Effect<HostResourcesSnapshot> }
>()("t3/resourceTelemetry/HostResources") {}

function readCpu() {
  const cpus = NodeOS.cpus();
  const cpu = cpus.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );
  return { ...cpu, count: cpus.length };
}

function darwinAvailableMemory(output: string): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  const free = /^Pages free:\s+(\d+)\./m.exec(output)?.[1];
  const inactive = /^Pages inactive:\s+(\d+)\./m.exec(output)?.[1];
  const speculative = /^Pages speculative:\s+(\d+)\./m.exec(output)?.[1];
  if (!pageSize || !free || !inactive || !speculative) return null;
  // vm_stat excludes speculative from free; add it once, without overlapping purgeable pages.
  const available = (Number(free) + Number(inactive) + Number(speculative)) * Number(pageSize);
  return Number.isSafeInteger(available) && Number(pageSize) > 0 ? available : null;
}

const make = Effect.fn("makeHostResources")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const sample = Effect.fn("HostResources.sample")(function* () {
    const previousCpu = readCpu();
    yield* Effect.sleep("200 millis");
    const cpu = readCpu();
    const totalDelta = cpu.total - previousCpu.total;
    const idleDelta = cpu.idle - previousCpu.idle;
    const cpuUtilization =
      previousCpu.count === cpu.count && totalDelta > 0 && idleDelta >= 0
        ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
        : null;
    const totalMemoryBytes = NodeOS.totalmem();
    // On Windows libuv returns GlobalMemoryStatusEx.ullAvailPhys, including standby memory.
    let availableMemoryBytes = NodeOS.freemem();
    if (platform === "linux") {
      const meminfo = yield* fs
        .readFileString("/proc/meminfo")
        .pipe(Effect.orElseSucceed(() => ""));
      const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      if (available) availableMemoryBytes = Number(available) * 1024;
    } else if (platform === "darwin") {
      const output = yield* spawner
        .string(ChildProcess.make("/usr/bin/vm_stat", [], { stdin: "ignore", stderr: "ignore" }))
        .pipe(
          Effect.timeout("1 second"),
          Effect.orElseSucceed(() => ""),
        );
      availableMemoryBytes = darwinAvailableMemory(output) ?? availableMemoryBytes;
    }
    return {
      sampledAt: DateTime.toEpochMillis(yield* DateTime.now),
      cpuUtilization,
      cpuCount: cpu.count,
      availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
      totalMemoryBytes,
      ...(platform === "linux" ? yield* readLinuxHostHealth() : {}),
    };
  });

  const cache = yield* Cache.make({
    capacity: 1,
    lookup: (_key: "host") => sample(),
    timeToLive: "5 seconds",
  });
  return HostResources.of({ read: Cache.get(cache, "host") });
});

export const layer = Layer.effect(HostResources, make());

/** Sysfs values describe the server's host, never the device opening T3. */
export const readLinuxHostHealth = Effect.fn("HostResources.readLinuxHostHealth")(function* (
  sysRoot = "/sys",
) {
  const fs = yield* FileSystem.FileSystem;
  const read = (path: string) =>
    fs.readFileString(path).pipe(
      Effect.map((value) => value.trim()),
      Effect.orElseSucceed(() => ""),
    );
  const directories = (path: string) => fs.readDirectory(path).pipe(Effect.orElseSucceed(() => []));
  const powerRoot = `${sysRoot}/class/power_supply`;
  const batteries = yield* directories(powerRoot).pipe(
    Effect.flatMap((names) =>
      Effect.forEach(
        names.toSorted(),
        (name) =>
          Effect.gen(function* () {
            const directory = `${powerRoot}/${name}`;
            if ((yield* read(`${directory}/type`)) !== "Battery") return null;
            if ((yield* read(`${directory}/present`)) === "0") return null;
            const capacity = yield* read(`${directory}/capacity`);
            const percent = capacity === "" ? NaN : Number(capacity);
            const status = (yield* read(`${directory}/status`)).toLowerCase();
            const state: NonNullable<HostResourcesSnapshot["batteryState"]> =
              status === "charging" || status === "discharging" || status === "full"
                ? status
                : "unknown";
            return {
              batteryPercent:
                Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null,
              batteryState: state,
            };
          }),
        { concurrency: 4 },
      ),
    ),
  );
  const hwmonRoot = `${sysRoot}/class/hwmon`;
  const sensors = yield* directories(hwmonRoot).pipe(
    Effect.flatMap((names) =>
      Effect.forEach(
        names,
        (name) =>
          Effect.gen(function* () {
            const directory = `${hwmonRoot}/${name}`;
            const chip = yield* read(`${directory}/name`);
            if (!["coretemp", "k10temp", "zenpower", "cpu_thermal"].includes(chip)) return [];
            const files = yield* directories(directory);
            const readings = yield* Effect.forEach(
              files.filter((file) => /^temp\d+_input$/.test(file)),
              (file) =>
                Effect.gen(function* () {
                  const raw = yield* read(`${directory}/${file}`);
                  const value = raw === "" ? NaN : Number(raw) / 1000;
                  const label = yield* read(`${directory}/${file.replace("_input", "_label")}`);
                  return { value, package: /^(Package id \d+|Tdie|Tctl)$/.test(label) };
                }),
              { concurrency: 4 },
            );
            const valid = readings.filter(
              ({ value }) => Number.isFinite(value) && value > 0 && value <= 150,
            );
            const packages = valid.filter((reading) => reading.package);
            return (packages.length ? packages : valid).map((reading) => reading.value);
          }),
        { concurrency: 4 },
      ),
    ),
  );
  const temperatures = sensors.flat();
  const battery = batteries.find((entry) => entry !== null);
  return {
    batteryPercent: battery?.batteryPercent ?? null,
    batteryState: battery?.batteryState ?? "unknown",
    cpuTemperatureCelsius: temperatures.length ? Math.max(...temperatures) : null,
  } satisfies Pick<
    HostResourcesSnapshot,
    "batteryPercent" | "batteryState" | "cpuTemperatureCelsius"
  >;
});
