import type { CheckpointId } from "@t3tools/contracts";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";

import type { CheckpointReviewStatus } from "../uiStateStore";

export type CheckpointReviewState = "pending" | CheckpointReviewStatus;
export type CheckpointReviews = Readonly<Record<string, CheckpointReviewStatus>>;
export type ReviewableCheckpoint = ThreadCheckpointSummary & {
  readonly checkpointId: CheckpointId;
};

// Checkpoint ids are derived from scope + ordinal and can be reused after a rewind.
export const checkpointReviewKey = (summary: ReviewableCheckpoint): string =>
  `${summary.runId}:${summary.checkpointId}`;

/** Undo targets the checkpoint id, so a checkpoint without one can't be reviewed. */
export function isReviewableCheckpoint(
  summary: ThreadCheckpointSummary,
): summary is ReviewableCheckpoint {
  return (
    summary.status === "ready" && summary.files.length > 0 && summary.checkpointId !== undefined
  );
}

/** Keeping turn N accepts turns 1..N. Only kept marks on checkpoints that still exist count. */
export function resolveKeptTurnCount(
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
  reviews: CheckpointReviews | undefined,
): number | null {
  let keptTurnCount: number | null = null;
  for (const summary of summaries) {
    if (!isReviewableCheckpoint(summary) || reviews?.[checkpointReviewKey(summary)] !== "kept")
      continue;
    if (keptTurnCount === null || summary.checkpointTurnCount > keptTurnCount) {
      keptTurnCount = summary.checkpointTurnCount;
    }
  }
  return keptTurnCount;
}

/** Only the latest unmarked checkpoint above the kept turn is pending. Marks follow the id, not the ordinal. */
export function deriveCheckpointReviewStates(
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
  reviews: CheckpointReviews | undefined,
): Map<CheckpointId, CheckpointReviewState> {
  const keptTurnCount = resolveKeptTurnCount(summaries, reviews);
  const states = new Map<CheckpointId, CheckpointReviewState>();
  let latestPending: ReviewableCheckpoint | null = null;
  for (const summary of summaries) {
    if (!isReviewableCheckpoint(summary)) continue;
    const review = reviews?.[checkpointReviewKey(summary)];
    if (review !== undefined) {
      states.set(summary.checkpointId, review);
    } else if (
      (keptTurnCount === null || summary.checkpointTurnCount > keptTurnCount) &&
      (latestPending === null || summary.checkpointTurnCount > latestPending.checkpointTurnCount)
    ) {
      latestPending = summary;
    }
  }
  if (latestPending !== null) states.set(latestPending.checkpointId, "pending");
  return states;
}

/** A completed child shows one control: its pending checkpoint, or else its most recent reviewed one. */
export function selectCompletedChildReview(
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
  reviews: CheckpointReviews | undefined,
): { readonly checkpoint: ReviewableCheckpoint; readonly status: CheckpointReviewState } | null {
  const states = deriveCheckpointReviewStates(summaries, reviews);
  let reviewed: { checkpoint: ReviewableCheckpoint; status: CheckpointReviewState } | null = null;
  for (const summary of summaries) {
    if (!isReviewableCheckpoint(summary)) continue;
    const status = states.get(summary.checkpointId);
    if (status === undefined) continue;
    if (status === "pending") return { checkpoint: summary, status };
    if (
      reviewed === null ||
      summary.checkpointTurnCount > reviewed.checkpoint.checkpointTurnCount
    ) {
      reviewed = { checkpoint: summary, status };
    }
  }
  return reviewed;
}
