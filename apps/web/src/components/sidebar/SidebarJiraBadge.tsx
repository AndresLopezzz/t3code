import type { ScopedThreadRef } from "@t3tools/contracts";
import { memo, useCallback } from "react";

import { openJiraIssue } from "../JiraIssuePanel";

/** Opens a thread's Jira issue in the right panel, like the PR badge opens its PR. */
export function useOpenJiraIssue() {
  return useCallback(
    (threadRef: ScopedThreadRef, key: string) => openJiraIssue(threadRef, key),
    [],
  );
}

export const SidebarJiraBadge = memo(function SidebarJiraBadge(props: {
  readonly issueKey: string;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Open ${props.issueKey} in Jira`}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen();
      }}
      className="shrink-0 cursor-pointer rounded px-1 font-mono text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {props.issueKey}
    </button>
  );
});
