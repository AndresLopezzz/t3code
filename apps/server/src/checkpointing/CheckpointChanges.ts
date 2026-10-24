import {
  OrchestrationUndoChangesError,
  type OrchestrationUndoChangesInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { checkpointRefForRunStart } from "../orchestration-v2/CheckpointService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { withFileUndo } from "../workspace/fileUndoBarrier.ts";

export class CheckpointChanges extends Context.Service<
  CheckpointChanges,
  {
    readonly undo: (
      input: OrchestrationUndoChangesInput,
    ) => Effect.Effect<void, OrchestrationUndoChangesError>;
  }
>()("t3/checkpointing/CheckpointChanges") {}

const isUndoChangesError = Schema.is(OrchestrationUndoChangesError);

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fail = (message: string) => new OrchestrationUndoChangesError({ message });
  const active = (status: string) =>
    !["completed", "failed", "interrupted", "cancelled", "rolled_back"].includes(status);

  const undo = Effect.fn("CheckpointChanges.undo")(function* (
    input: OrchestrationUndoChangesInput,
  ) {
    const context = yield* projections.getThreadRecords(input.threadId, [
      "runs",
      "checkpoints",
      "checkpointScopes",
    ]);
    const checkpoint = context.checkpoints.find((item) => item.id === input.checkpointId);
    const scope = context.checkpointScopes.find((item) => item.id === checkpoint?.scopeId);
    const run = context.runs.find((item) => item.id === checkpoint?.runId);
    if (
      !checkpoint ||
      !scope ||
      !run ||
      run.id !== input.runId ||
      checkpoint.status !== "ready" ||
      run.status !== "completed"
    )
      return yield* fail("Only a completed turn with an available checkpoint can be undone.");
    const cwd = yield* fs.realPath(scope.cwd);
    const handle = yield* registry.resolve({ cwd, requestedKind: "git" });
    const root = yield* fs.realPath(handle.repository.rootPath);
    const execute = (args: string[], stdin?: string) =>
      handle.driver.execute({
        operation: "CheckpointChanges.undo",
        cwd: root,
        args,
        ...(stdin === undefined ? {} : { stdin }),
        maxOutputBytes: 32 * 1024 * 1024,
        outputMode: "error",
      });

    return yield* withWorkspaceLease(
      root,
      Effect.gen(function* () {
        const startRef = yield* checkpointRefForRunStart(run.id).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
        );
        if (
          !handle.driver.checkpoints ||
          !(yield* handle.driver.checkpoints.hasCheckpointRef({ cwd, checkpointRef: startRef }))
        )
          return yield* fail(
            "This turn predates safe file undo. Make a new change to test Undo; its original files cannot be reconstructed safely.",
          );

        // Snapshot deltas are temporal, not proof of authorship. Refuse ambiguous overlaps.
        const shell = yield* projections.getShellSnapshot();
        const started = DateTime.toEpochMillis(run.startedAt ?? run.requestedAt);
        const finished = DateTime.toEpochMillis(checkpoint.capturedAt);
        const changedPaths = new Set(checkpoint.files.map((file) => file.path));
        for (const thread of [...shell.threads, ...shell.archivedThreads]) {
          if (thread.deletedAt !== null) continue;
          const other =
            thread.id === input.threadId
              ? context
              : yield* projections.getThreadRecords(thread.id, [
                  "runs",
                  "checkpoints",
                  "checkpointScopes",
                ]);
          let otherCwd = thread.worktreePath;
          if (otherCwd === null) {
            const project = yield* projects.get(thread.projectId, { includeDeleted: true });
            if (Option.isNone(project))
              return yield* fail(
                "A thread's workspace cannot be resolved. Undo was cancelled safely.",
              );
            otherCwd = project.value.workspaceRoot;
          }
          const directories = [otherCwd, ...other.checkpointScopes.map((item) => item.cwd)];
          let sharesWorkspace = false;
          for (const directory of directories) {
            const resolved = yield* fs
              .realPath(directory)
              .pipe(Effect.orElseSucceed(() => path.resolve(directory)));
            const relative = path.relative(root, resolved);
            const reverse = path.relative(resolved, root);
            if (
              relative === "" ||
              (!path.isAbsolute(relative) &&
                relative !== ".." &&
                !relative.startsWith(`..${path.sep}`)) ||
              (!path.isAbsolute(reverse) &&
                reverse !== ".." &&
                !reverse.startsWith(`..${path.sep}`))
            ) {
              sharesWorkspace = true;
              break;
            }
          }
          if (!sharesWorkspace) continue;
          for (const otherRun of other.runs) {
            if (otherRun.id === run.id) continue;
            if (active(otherRun.status))
              return yield* fail(
                "Wait for the other work in this checkout to finish before undoing files.",
              );
            if (otherRun.startedAt === null) continue;
            const from = DateTime.toEpochMillis(otherRun.startedAt);
            const to = DateTime.toEpochMillis(otherRun.completedAt ?? otherRun.startedAt);
            if (from > finished || to < started) continue;
            const otherCheckpoint = other.checkpoints.find(
              (item) => item.runId === otherRun.id && item.status === "ready",
            );
            if (
              !otherCheckpoint ||
              otherCheckpoint.files.some((file) => changedPaths.has(file.path))
            )
              return yield* fail(
                "These files were also touched by overlapping work. Undo cannot safely separate the changes.",
              );
          }
        }

        if (checkpoint.files.length === 0)
          return yield* fail("This checkpoint has no recorded file changes to undo.");
        const authoredPaths = yield* handle.driver.checkpoints.listAuthoredPaths({
          cwd,
          fromCheckpointRef: startRef,
          toCheckpointRef: checkpoint.ref,
        });
        if (
          authoredPaths !== null &&
          checkpoint.files.some((file) => !authoredPaths.has(file.path))
        )
          return yield* fail(
            "This turn includes imported Git changes that cannot be undone as agent edits.",
          );
        const paths = checkpoint.files.map((file) => `:(top,literal)${file.path}`);
        const end = `${checkpoint.ref}^{commit}`;
        // Never overwrite subsequent edits in a file, even when a patch could apply with an offset.
        const temp = yield* fs.makeTempDirectoryScoped();
        const env = { GIT_INDEX_FILE: path.join(temp, "index") };
        yield* handle.driver.execute({
          operation: "CheckpointChanges.undo",
          cwd: root,
          env,
          args: ["read-tree", end],
        });
        const current = yield* handle.driver.execute({
          operation: "CheckpointChanges.undo",
          cwd: root,
          env,
          args: ["diff", "--no-ext-diff", "--no-textconv", "--name-only", end, "--", ...paths],
          outputMode: "error",
        });
        if (current.stdout.trim() !== "")
          return yield* fail(
            "A changed file has newer edits. Undo was cancelled without changing any files.",
          );
        const patch = yield* execute([
          "diff",
          "--binary",
          "--full-index",
          "--no-renames",
          "--no-ext-diff",
          "--no-textconv",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          `${startRef}^{commit}`,
          end,
          "--",
          ...paths,
        ]);
        if (patch.stdout.length === 0)
          return yield* fail("No changes remain in this turn's patch.");
        yield* execute(["apply", "--reverse", "--check", "--whitespace=nowarn", "-"], patch.stdout);
        // Git apply checks the entire patch before writing; no --reject, --index, reset, or clean.
        yield* execute(["apply", "--reverse", "--whitespace=nowarn", "-"], patch.stdout);
      }),
    );
  });
  return CheckpointChanges.of({
    undo: (input) =>
      undo(input).pipe(
        withFileUndo,
        Effect.scoped,
        Effect.mapError((cause) =>
          isUndoChangesError(cause)
            ? cause
            : new OrchestrationUndoChangesError({
                message:
                  "Could not undo these changes safely. No conversation history was removed; check the files and server logs before retrying.",
                cause,
              }),
        ),
      ),
  });
});

export const layer = Layer.effect(CheckpointChanges, make);
