import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isActiveSubagentStatus } from "@t3tools/client-runtime/state/subagentRuntime";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { memo, useEffect, useMemo, useRef } from "react";

import { cn } from "../../lib/utils";
import { useThreadProjection } from "../../state/entities";
import { getClientSettings } from "../../hooks/useSettings";
import { hasNotificationSound, playNotificationSound } from "../../threadNotifications";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

/**
 * Running subagents of a working thread, nested under its row like a tree.
 * Native subagents live in the parent's projection, not the shell list, so
 * only working rows mount this and load that detail.
 */
export const SidebarSubagentRows = memo(function SidebarSubagentRows(props: {
  readonly thread: EnvironmentThreadShell;
  readonly activeThreadKey: string | null;
  readonly onOpen: (ref: ScopedThreadRef) => void;
}) {
  const parentRef = useMemo(
    () => scopeThreadRef(props.thread.environmentId, props.thread.id),
    [props.thread.environmentId, props.thread.id],
  );
  const allSubagents = useThreadProjection(parentRef)?.projection?.subagents;
  const subagents = (allSubagents ?? []).filter((subagent) =>
    isActiveSubagentStatus(subagent.status),
  );

  // Announce each subagent that stops working while this row watches it.
  const runningIds = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (allSubagents === undefined) return;
    const previous = runningIds.current;
    runningIds.current = new Set(
      allSubagents.filter((s) => isActiveSubagentStatus(s.status)).map((s) => s.id),
    );
    if (previous === null) return;
    for (const subagent of allSubagents) {
      if (!previous.has(subagent.id) || runningIds.current.has(subagent.id)) continue;
      toastManager.add({
        type: subagent.status === "failed" ? "error" : "success",
        title: subagent.status === "failed" ? "Subagent failed" : "Subagent finished",
        description: `${subagent.title ?? subagent.prompt} · ${props.thread.title}`,
      });
      const mode = getClientSettings().notificationMode;
      if (hasNotificationSound(mode)) {
        void playNotificationSound("completion", () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
    }
  }, [allSubagents, props.thread.title]);

  if (subagents.length === 0) return null;

  return (
    <ul
      role="presentation"
      className="ms-5 mb-1 flex flex-col gap-px border-s border-sidebar-border ps-1.5"
    >
      {subagents.map((subagent) => {
        // Children without their own thread open the parent, where the card lives.
        const target =
          subagent.childThreadId === null
            ? parentRef
            : scopeThreadRef(props.thread.environmentId, subagent.childThreadId);
        return (
          <li key={subagent.id} className="list-none">
            <button
              type="button"
              onClick={() => props.onOpen(target)}
              className={cn(
                "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                subagent.childThreadId !== null &&
                  props.activeThreadKey === scopedThreadKey(target) &&
                  "bg-sidebar-row-hover text-sidebar-foreground",
              )}
            >
              <Spinner className="size-3 shrink-0" />
              <span className="truncate">{subagent.title ?? subagent.prompt}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
});
