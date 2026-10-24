import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { readLinuxHostHealth } from "./HostResources.ts";

const fixture = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-health-" });
    for (const [relative, contents] of Object.entries(files)) {
      const path = `${root}/${relative}`;
      yield* fs.makeDirectory(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      yield* fs.writeFileString(path, contents);
    }
    return root;
  });

describe("Linux host health", () => {
  it.effect(
    "reads battery percentage and CPU package temperature without mixing in SSD or core readings",
    () =>
      Effect.gen(function* () {
        const root = yield* fixture({
          "class/power_supply/BAT0/type": "Battery\n",
          "class/power_supply/BAT0/capacity": "82\n",
          "class/power_supply/BAT0/status": "Charging\n",
          "class/hwmon/hwmon0/name": "nvme\n",
          "class/hwmon/hwmon0/temp1_input": "110000\n",
          "class/hwmon/hwmon1/name": "coretemp\n",
          "class/hwmon/hwmon1/temp1_label": "Package id 0\n",
          "class/hwmon/hwmon1/temp1_input": "62500\n",
          "class/hwmon/hwmon1/temp2_label": "Core 0\n",
          "class/hwmon/hwmon1/temp2_input": "93000\n",
        });
        expect(yield* readLinuxHostHealth(root)).toEqual({
          batteryPercent: 82,
          batteryState: "charging",
          cpuTemperatureCelsius: 62.5,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps a zero battery reading and skips absent batteries", () =>
    Effect.gen(function* () {
      const root = yield* fixture({
        "class/power_supply/BAT0/type": "Battery",
        "class/power_supply/BAT0/present": "0",
        "class/power_supply/BAT0/capacity": "95",
        "class/power_supply/BAT1/type": "Battery",
        "class/power_supply/BAT1/capacity": "0",
        "class/power_supply/BAT1/status": "Discharging",
        "class/hwmon/hwmon0/name": "k10temp",
        "class/hwmon/hwmon0/temp1_label": "Tdie",
        "class/hwmon/hwmon0/temp1_input": "74000",
      });
      expect(yield* readLinuxHostHealth(root)).toEqual({
        batteryPercent: 0,
        batteryState: "discharging",
        cpuTemperatureCelsius: 74,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("returns unavailable values when sysfs is absent", () =>
    Effect.gen(function* () {
      const root = yield* fixture({});
      expect(yield* readLinuxHostHealth(root)).toEqual({
        batteryPercent: null,
        batteryState: "unknown",
        cpuTemperatureCelsius: null,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects corrupt percentages and invalid CPU readings", () =>
    Effect.gen(function* () {
      const root = yield* fixture({
        "class/power_supply/BAT0/type": "Battery",
        "class/power_supply/BAT0/capacity": "170",
        "class/power_supply/BAT0/status": "unknown",
        "class/hwmon/hwmon0/name": "coretemp",
        "class/hwmon/hwmon0/temp1_input": "",
        "class/hwmon/hwmon0/temp2_input": "0",
        "class/hwmon/hwmon0/temp3_input": "999000",
      });
      expect(yield* readLinuxHostHealth(root)).toEqual({
        batteryPercent: null,
        batteryState: "unknown",
        cpuTemperatureCelsius: null,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
