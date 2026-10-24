import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";
import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { checkpointRefForRunStart } from "../orchestration-v2/CheckpointService.ts";
import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import * as CheckpointService from "../orchestration-v2/CheckpointService.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as CheckpointStore from "./CheckpointStore.ts";
import * as CheckpointChanges from "./CheckpointChanges.ts";

const processLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const gitLayer = VcsDriverRegistry.layer.pipe(Layer.provideMerge(processLayer));
const testLayer = CheckpointStore.layer.pipe(
  Layer.provideMerge(gitLayer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeCrypto.layer),
  Layer.provideMerge(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-turn-undo-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
  ),
);
const threadId = ThreadId.make("thread:undo");
const runId = RunId.make("run:undo");
const checkpointId = CheckpointId.make("checkpoint:undo");
const at = (seconds: number) =>
  DateTime.makeUnsafe(`2026-10-22T00:00:${seconds.toString().padStart(2, "0")}Z`);

it.layer(testLayer)("safe code-only undo", (it) => {
  const fixture = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const store = yield* CheckpointStore.CheckpointStore;
    const vcs = yield* VcsProcess.VcsProcess;
    const cwd = yield* fs.makeTempDirectoryScoped();
    const git = (args: string[]) => vcs.run({ operation: "undo.test", command: "git", args, cwd });
    yield* git(["init"]);
    yield* git(["config", "user.name", "Undo Test"]);
    yield* git(["config", "user.email", "undo@test.invalid"]);
    yield* fs.writeFileString(`${cwd}/edited.txt`, "before\n");
    yield* fs.writeFileString(`${cwd}/deleted.txt`, "keep me\n");
    yield* fs.writeFile(`${cwd}/image.bin`, new Uint8Array([0, 1, 2, 3]));
    yield* git(["add", "."]);
    yield* git(["commit", "-m", "initial"]);
    const start = yield* checkpointRefForRunStart(runId);
    yield* store.captureCheckpoint({ cwd, checkpointRef: start });
    yield* fs.writeFileString(`${cwd}/edited.txt`, "after\n");
    yield* fs.writeFileString(`${cwd}/added.txt`, "new file\n");
    yield* fs.writeFile(`${cwd}/image.bin`, new Uint8Array([0, 9, 8, 7]));
    yield* fs.remove(`${cwd}/deleted.txt`);
    const end = CheckpointRef.make("refs/t3/test/end");
    yield* store.captureCheckpoint({ cwd, checkpointRef: end });
    const context = {
      thread: { id: threadId, worktreePath: null },
      runs: [
        {
          id: runId,
          status: "completed",
          startedAt: at(10),
          requestedAt: at(9),
          completedAt: at(20),
        },
      ],
      checkpoints: [
        {
          id: checkpointId,
          scopeId: "scope",
          runId,
          ref: end,
          status: "ready",
          capturedAt: at(20),
          files: ["edited.txt", "added.txt", "deleted.txt", "image.bin"].map((path) => ({ path })),
        },
      ],
      checkpointScopes: [{ id: "scope", cwd }],
    };
    const threads = [{ id: threadId, worktreePath: null, projectId: "project", deletedAt: null }];
    const records = new Map([[String(threadId), context]]);
    const layer = CheckpointChanges.layer.pipe(
      Layer.provide(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadRecords: (id) => Effect.succeed(records.get(id) as never),
          getShellSnapshot: () => Effect.succeed({ threads, archivedThreads: [] } as never),
        }),
      ),
      Layer.provide(
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () => Effect.succeed({ _tag: "Some", value: { workspaceRoot: cwd } } as never),
        }),
      ),
    );
    const undo = Effect.gen(function* () {
      const changes = yield* CheckpointChanges.CheckpointChanges;
      yield* changes.undo({ threadId, checkpointId, runId });
    }).pipe(Effect.provide(layer));
    return { fs, cwd, git, start, context, threads, records, undo };
  });

  it.effect(
    "restores modified/deleted files, removes added files, and preserves unrelated files and the index",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.fs.writeFileString(`${f.cwd}/unrelated.txt`, "someone else's work\n");
        yield* f.git(["add", "unrelated.txt"]);
        const index = (yield* f.git(["ls-files", "--stage"])).stdout;
        yield* f.undo;
        expect(yield* f.fs.readFileString(`${f.cwd}/edited.txt`)).toBe("before\n");
        expect(yield* f.fs.readFileString(`${f.cwd}/deleted.txt`)).toBe("keep me\n");
        expect(yield* f.fs.exists(`${f.cwd}/added.txt`)).toBe(false);
        expect(Array.from(yield* f.fs.readFile(`${f.cwd}/image.bin`))).toEqual([0, 1, 2, 3]);
        expect(yield* f.fs.readFileString(`${f.cwd}/unrelated.txt`)).toBe("someone else's work\n");
        expect((yield* f.git(["ls-files", "--stage"])).stdout).toBe(index);
        expect(f.context.runs[0]?.status).toBe("completed");
      }),
  );

  it.effect("rejects a later edit without partially undoing other files", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(`${f.cwd}/edited.txt`, "newer manual edit\n");
      const error = yield* Effect.flip(f.undo);
      expect(error.message).toContain("newer edits");
      expect(yield* f.fs.readFileString(`${f.cwd}/edited.txt`)).toBe("newer manual edit\n");
      expect(yield* f.fs.exists(`${f.cwd}/added.txt`)).toBe(true);
      expect(yield* f.fs.exists(`${f.cwd}/deleted.txt`)).toBe(false);
    }),
  );

  it.effect("rejects a newer untracked file at a deleted path without partially applying", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(`${f.cwd}/deleted.txt`, "someone recreated this\n");
      yield* Effect.flip(f.undo);
      expect(yield* f.fs.readFileString(`${f.cwd}/deleted.txt`)).toBe("someone recreated this\n");
      expect(yield* f.fs.readFileString(`${f.cwd}/edited.txt`)).toBe("after\n");
      expect(yield* f.fs.exists(`${f.cwd}/added.txt`)).toBe(true);
    }),
  );

  it.effect("captures the exact turn start when the previous checkpoint already exists", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const store = yield* CheckpointStore.CheckpointStore;
      const scope = {
        id: CheckpointScopeId.make("scope:next"),
        threadId,
        runId,
        nodeId: NodeId.make("node:next"),
        providerThreadId: ProviderThreadId.make("provider:next"),
        parentScopeId: null,
        kind: "root_run" as const,
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd: f.cwd,
        createdAt: at(21),
      };
      const previous = yield* checkpointRefForScopeOrdinal({
        scopeId: scope.id,
        ordinalWithinScope: 0,
      });
      yield* store.captureCheckpoint({ cwd: f.cwd, checkpointRef: previous });
      yield* f.fs.writeFileString(`${f.cwd}/between-turns.txt`, "preexisting manual edit\n");
      yield* Effect.gen(function* () {
        const checkpoints = yield* CheckpointService.CheckpointServiceV2;
        const nextRun = RunId.make("run:next");
        yield* checkpoints.captureBaseline({ scope, ordinalWithinScope: 0, runId: nextRun });
        yield* f.fs.writeFileString(`${f.cwd}/edited.txt`, "next turn\n");
        const result = yield* checkpoints.capture({
          scope,
          runId: nextRun,
          nodeId: scope.nodeId,
          ordinalWithinScope: 1,
          appRunOrdinal: 1,
          capturedAt: at(30),
        });
        expect(result.files.map((file) => file.path)).toEqual(["edited.txt"]);
        yield* f.fs.writeFileString(`${f.cwd}/edited.txt`, "late external edit\n");
        const retried = yield* checkpoints.capture({
          scope,
          runId: nextRun,
          nodeId: scope.nodeId,
          ordinalWithinScope: 1,
          appRunOrdinal: 1,
          capturedAt: at(31),
        });
        expect((yield* f.git(["show", `${retried.ref}:edited.txt`])).stdout).toBe("next turn\n");
      }).pipe(Effect.provide(CheckpointService.layer.pipe(Layer.provide(IdAllocator.layer))));
    }),
  );

  it.effect("refuses legacy checkpoints instead of inferring a destructive baseline", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.git(["update-ref", "-d", f.start]);
      expect((yield* Effect.flip(f.undo)).message).toContain("predates safe file undo");
      expect(yield* f.fs.readFileString(`${f.cwd}/edited.txt`)).toBe("after\n");
    }),
  );

  it.effect("rejects a stale action when a checkpoint ordinal was reused for another run", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const replacement = RunId.make("run:replacement");
      f.context.runs[0]!.id = replacement;
      f.context.checkpoints[0]!.runId = replacement;
      expect((yield* Effect.flip(f.undo)).message).toContain("completed turn");
      expect(yield* f.fs.readFileString(`${f.cwd}/edited.txt`)).toBe("after\n");
    }),
  );

  it.effect("rejects active or overlapping work in another thread in the same checkout", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const otherId = ThreadId.make("thread:other");
      f.threads.push({ ...f.threads[0]!, id: otherId });
      f.records.set(otherId, {
        ...f.context,
        runs: [{ ...f.context.runs[0]!, id: RunId.make("run:other"), status: "running" }],
      });
      expect((yield* Effect.flip(f.undo)).message).toContain("other work");
      f.records.set(otherId, {
        ...f.context,
        runs: [{ ...f.context.runs[0]!, id: RunId.make("run:other"), status: "queued" }],
      });
      expect((yield* Effect.flip(f.undo)).message).toContain("other work");
      f.records.set(otherId, {
        ...f.context,
        runs: [{ ...f.context.runs[0]!, id: RunId.make("run:other"), status: "completed" }],
        checkpoints: [{ ...f.context.checkpoints[0]!, runId: RunId.make("run:other") }],
      });
      expect((yield* Effect.flip(f.undo)).message).toContain("overlapping work");
      expect(yield* f.fs.readFileString(`${f.cwd}/edited.txt`)).toBe("after\n");
    }),
  );
});
