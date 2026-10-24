import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { ORCHESTRATION_V2_WS_METHODS, type ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useState } from "react";

import { connectionAtomRuntime } from "~/connection/runtime";
import { ensureLocalApi } from "~/localApi";
import type { CheckpointReviewState, ReviewableCheckpoint } from "~/state/checkpointChanges";
import { checkpointReviewKey } from "~/state/checkpointChanges";
import { useAtomCommand } from "~/state/use-atom-command";
import { useUiStateStore } from "~/uiStateStore";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

const undoChangesCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:orchestration-v2:undo-changes",
  tag: ORCHESTRATION_V2_WS_METHODS.undoChanges,
});

/** Undo restores this checkpoint's files only. The conversation is never rewound. */
export function TurnChangeActions(props: {
  readonly threadRef: ScopedThreadRef;
  readonly checkpoint: ReviewableCheckpoint;
  readonly status: CheckpointReviewState;
  readonly disabled: boolean;
}) {
  const setCheckpointReview = useUiStateStore((store) => store.setCheckpointReview);
  const undoChanges = useAtomCommand(undoChangesCommand);
  const canUndo = useAtomValue(undoChangesCommand.permissionAtom(props.threadRef.environmentId));
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadKey = scopedThreadKey(props.threadRef);
  const { checkpointId, runId } = props.checkpoint;
  const reviewKey = checkpointReviewKey(props.checkpoint);

  const onUndo = async () => {
    if (undoing) return;
    setUndoing(true);
    setError(null);
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Undo the file changes from this turn? The conversation will be kept.\n\n${props.checkpoint.files.map((file) => file.path).join("\n")}\n\nManual edits made while the turn was running may be included. Newer conflicting edits will cancel Undo.`,
    );
    if (!confirmed) {
      setUndoing(false);
      return;
    }
    const result = await undoChanges({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, checkpointId, runId },
    });
    setUndoing(false);
    if (result._tag === "Failure") {
      const failure = Cause.squash(result.cause);
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "Could not undo the changes.",
      );
      return;
    }
    setCheckpointReview(threadKey, reviewKey, "undone");
    toastManager.add({ type: "success", title: "Changes undone" });
  };

  if (props.status === "kept") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Kept</span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => setCheckpointReview(threadKey, reviewKey, null)}
        >
          Reopen
        </Button>
      </div>
    );
  }
  if (props.status === "undone") {
    return <span className="text-xs text-muted-foreground">Undone</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={props.disabled || undoing}
        onClick={() => setCheckpointReview(threadKey, reviewKey, "kept")}
      >
        Keep
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={props.disabled || undoing || !canUndo}
        onClick={() => void onUndo()}
      >
        {undoing ? "Undoing…" : "Undo"}
      </Button>
      {error !== null ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
