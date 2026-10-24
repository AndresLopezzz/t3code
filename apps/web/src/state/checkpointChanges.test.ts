import { describe, expect, it } from "vite-plus/test";

import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";

import { checkpointReviewKey, selectCompletedChildReview } from "./checkpointChanges";

function makeCheckpoint(turn: number, overrides: Partial<ThreadCheckpointSummary> = {}) {
  return {
    checkpointId: `checkpoint-${turn}` as never,
    runId: `run-${turn}` as never,
    checkpointTurnCount: turn,
    checkpointRef: `ref-${turn}` as never,
    status: "ready",
    files: [{ path: `src/file-${turn}.ts`, kind: "modified", additions: 1, deletions: 0 }],
    assistantMessageId: null,
    completedAt: `2026-01-01T00:0${turn}:30Z`,
    ...overrides,
  } satisfies ThreadCheckpointSummary;
}

describe("selectCompletedChildReview", () => {
  it("does not reuse review decisions when a checkpoint id is reused by a new run", () => {
    const original = makeCheckpoint(1);
    const replacement = makeCheckpoint(1, { runId: "replacement-run" as never });
    expect(
      selectCompletedChildReview([replacement], { [checkpointReviewKey(original)]: "kept" })
        ?.status,
    ).toBe("pending");
  });
  it("selects the pending checkpoint over an earlier reviewed one", () => {
    const summaries = [makeCheckpoint(1), makeCheckpoint(2)];

    expect(selectCompletedChildReview(summaries, { "run-1:checkpoint-1": "kept" })).toMatchObject({
      status: "pending",
      checkpoint: { checkpointId: "checkpoint-2" },
    });
  });

  it("falls back to the most recent reviewed checkpoint when nothing is pending", () => {
    const summaries = [makeCheckpoint(1), makeCheckpoint(2)];

    expect(
      selectCompletedChildReview(summaries, {
        "run-1:checkpoint-1": "kept",
        "run-2:checkpoint-2": "undone",
      }),
    ).toMatchObject({ status: "undone", checkpoint: { checkpointId: "checkpoint-2" } });
  });

  it("selects a child checkpoint that has no assistant message on the parent timeline", () => {
    const summaries = [makeCheckpoint(1, { assistantMessageId: null })];

    expect(selectCompletedChildReview(summaries, undefined)).toMatchObject({
      status: "pending",
      checkpoint: { checkpointId: "checkpoint-1" },
    });
  });

  it("returns nothing when no ready checkpoint changed files", () => {
    const summaries = [makeCheckpoint(1, { files: [] }), makeCheckpoint(2, { status: "stale" })];

    expect(selectCompletedChildReview(summaries, undefined)).toBeNull();
  });
});
