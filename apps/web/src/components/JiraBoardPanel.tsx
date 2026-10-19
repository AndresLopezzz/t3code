import type { JiraBoard, ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../lib/utils";
import { previewEnvironment } from "../state/preview";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { openJiraIssue } from "./JiraIssuePanel";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

type Issue = JiraBoard["issues"][number];

// DEP's workflow order, each with a quiet tint; other statuses fall back to their category.
const STATUSES: ReadonlyArray<{ name: string; tone: Tone }> = [
  { name: "BACKLOG", tone: "slate" },
  { name: "READY FOR DEV", tone: "slate" },
  { name: "IN PROGRESS", tone: "sky" },
  { name: "BLOCKED", tone: "rose" },
  { name: "READY FOR QA", tone: "violet" },
  { name: "QA APPROVED", tone: "teal" },
  { name: "READY FOR DEPLOY", tone: "amber" },
  { name: "DONE", tone: "emerald" },
];
const CATEGORY = {
  new: { rank: 0, tone: "slate" },
  indeterminate: { rank: 1, tone: "sky" },
  done: { rank: 2, tone: "emerald" },
} as const;

type Tone = "slate" | "sky" | "rose" | "violet" | "teal" | "amber" | "emerald";
const TONES: Record<Tone, { column: string; dot: string; card: string }> = {
  slate: { column: "bg-slate-500/6", dot: "bg-slate-400", card: "border-l-slate-400/70" },
  sky: { column: "bg-sky-500/7", dot: "bg-sky-500", card: "border-l-sky-500/70" },
  rose: { column: "bg-rose-500/7", dot: "bg-rose-500", card: "border-l-rose-500/70" },
  violet: { column: "bg-violet-500/7", dot: "bg-violet-500", card: "border-l-violet-500/70" },
  teal: { column: "bg-teal-500/7", dot: "bg-teal-500", card: "border-l-teal-500/70" },
  amber: { column: "bg-amber-500/7", dot: "bg-amber-500", card: "border-l-amber-500/70" },
  emerald: { column: "bg-emerald-500/7", dot: "bg-emerald-500", card: "border-l-emerald-500/70" },
};

function statusInfo(issue: Issue): { rank: number; tone: Tone } {
  const index = STATUSES.findIndex((status) => status.name === issue.status.toUpperCase());
  if (index >= 0) return { rank: index * 10, tone: STATUSES[index]!.tone };
  const category =
    CATEGORY[issue.statusCategory as keyof typeof CATEGORY] ?? CATEGORY.indeterminate;
  return { rank: category.rank * 30 + 5, tone: category.tone };
}

function columnsOf(issues: readonly Issue[], showDone: boolean) {
  const columns = new Map<string, { tone: Tone; issues: Issue[] }>();
  for (const issue of [...issues].toSorted((a, b) => statusInfo(a).rank - statusInfo(b).rank)) {
    if (!showDone && issue.statusCategory === "done") continue;
    const column = columns.get(issue.status) ?? { tone: statusInfo(issue).tone, issues: [] };
    column.issues.push(issue);
    columns.set(issue.status, column);
  }
  return [...columns];
}

export function JiraBoardPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const query = useEnvironmentQuery(
    previewEnvironment.jiraBoard({ environmentId: threadRef.environmentId, input: {} }),
  );
  const move = useAtomCommand(previewEnvironment.moveJiraIssue, { reportFailure: false });
  const [showDone, setShowDone] = useState(false);
  // Drops show at once; the refresh after Jira answers replaces them with the real state.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);

  const issues = query.data?.issues.map((issue) => {
    const status = moved[issue.key];
    return status && status !== issue.status
      ? { ...issue, status, statusCategory: "indeterminate" }
      : issue;
  });
  const columns = columnsOf(issues ?? [], showDone);
  const doneCount = issues?.filter((issue) => issue.statusCategory === "done").length ?? 0;

  const drop = async (key: string, toStatus: string) => {
    const issue = issues?.find((entry) => entry.key === key);
    if (!issue || issue.status === toStatus) return;
    setMoved((current) => ({ ...current, [key]: toStatus }));
    const result = await move({
      environmentId: threadRef.environmentId,
      input: { key, toStatus },
    });
    if (result._tag !== "Success") {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not move ${key}`,
        description:
          failure && typeof failure === "object" && "reason" in failure
            ? String(failure.reason)
            : String(failure),
      });
    }
    setMoved((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    query.refresh();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-xs">
        <span className="font-medium">My open sprint issues</span>
        <span className="text-muted-foreground">{issues ? issues.length : ""}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => setShowDone((value) => !value)}>
            {showDone ? "Hide done" : `Show done (${doneCount})`}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh"
            disabled={query.isPending}
            onClick={() => query.refresh()}
          >
            <RefreshCwIcon className={query.isPending ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>
      {query.error && !issues ? (
        <p className="p-4 text-sm text-destructive-foreground">{query.error}</p>
      ) : !issues ? (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
          {columns.map(([status, column]) => {
            const tone = TONES[column.tone];
            return (
              <section
                key={status}
                aria-label={status}
                className={cn(
                  "flex w-60 shrink-0 flex-col rounded-lg ring-1 ring-transparent transition-shadow",
                  tone.column,
                  dragging && overColumn === status && "ring-primary/50",
                )}
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  setOverColumn(status);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setOverColumn(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const key = event.dataTransfer.getData("text/plain");
                  setOverColumn(null);
                  if (key) void drop(key, status);
                }}
              >
                <h3 className="flex items-center gap-1.5 px-3 pt-2.5 pb-2 text-2xs font-medium text-muted-foreground uppercase">
                  <span className={cn("size-2 rounded-full", tone.dot)} />
                  {status}
                  <span className="ml-auto tabular-nums">{column.issues.length}</span>
                </h3>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {column.issues.map((issue) => (
                    <button
                      key={issue.key}
                      type="button"
                      draggable
                      className={cn(
                        "cursor-grab rounded-md border border-l-2 border-border/60 bg-background p-2.5 text-left text-xs shadow-xs hover:border-border active:cursor-grabbing",
                        tone.card,
                        dragging === issue.key && "opacity-50",
                        moved[issue.key] && "animate-pulse",
                      )}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", issue.key);
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(issue.key);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOverColumn(null);
                      }}
                      onClick={() => openJiraIssue(threadRef, issue.key)}
                    >
                      <span className="line-clamp-3 text-sm text-foreground">{issue.summary}</span>
                      <span className="mt-2 flex items-center gap-2 text-muted-foreground">
                        <span className="font-mono">{issue.key}</span>
                        <span className="truncate">{issue.issueType}</span>
                        {issue.priority ? (
                          <span className="ml-auto shrink-0">{issue.priority}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
