import type { JiraIssue, ScopedThreadRef } from "@t3tools/contracts";
import DOMPurify from "dompurify";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FlagIcon,
  LayersIcon,
  PuzzleIcon,
  RefreshCwIcon,
  TagIcon,
  TimerIcon,
  UserIcon,
  UserPenIcon,
} from "lucide-react";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { jiraIssueUrl, jiraKeyFromUrl } from "../lib/jiraIssues";
import { cn } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { useRightPanelStore } from "../rightPanelStore";
import { previewEnvironment } from "../state/preview";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { toastManager } from "./ui/toast";

/** Opens a Jira issue as a tab of the thread's right panel, beside its pull requests. */
export function openJiraIssue(threadRef: ScopedThreadRef, key: string) {
  useRightPanelStore.getState().openJiraIssue(threadRef, key);
}

let purifier: ReturnType<typeof DOMPurify> | null = null;
function sanitize(html: string): string {
  purifier ??= DOMPurify(window);
  return purifier.sanitize(html, { FORBID_TAGS: ["style", "form", "input"] });
}

const STATUS_VARIANT = { new: "secondary", indeterminate: "info", done: "success" } as const;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const openExternal = (url: string) => void readLocalApi()?.shell.openExternal(url);

/** Issue links open as panel tabs; anything else goes to the browser instead of navigating the app. */
function handleLinkClick(event: MouseEvent<HTMLElement>, threadRef: ScopedThreadRef) {
  const anchor = (event.target as HTMLElement).closest("a");
  const href = anchor?.href;
  if (!anchor || !href) return;
  event.preventDefault();
  const key = anchor.dataset.issueKey ?? jiraKeyFromUrl(href);
  if (key) openJiraIssue(threadRef, key);
  else if (/^https?:/u.test(href)) openExternal(href);
}

function JiraHtml({
  html,
  threadRef,
  className,
}: {
  readonly html: string;
  readonly threadRef: ScopedThreadRef;
  readonly className?: string;
}) {
  const clean = useMemo(() => sanitize(html), [html]);
  return (
    <div
      onClick={(event) => handleLinkClick(event, threadRef)}
      className={cn(
        "text-sm leading-relaxed break-words [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-medium [&_hr]:my-4 [&_img]:max-w-full [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      // Sanitized with DOMPurify: Jira renders user-authored HTML.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid min-h-6 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<section aria-label={title} />}>
      <div className="sticky top-0 z-10 flex w-full items-center bg-background">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
          <span>{title}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <div className="px-4 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function StatusMenu({
  issue,
  busy,
  onTransition,
}: {
  readonly issue: JiraIssue;
  readonly busy: boolean;
  readonly onTransition: (transitionId: string) => void;
}) {
  const variant =
    STATUS_VARIANT[issue.statusCategory as keyof typeof STATUS_VARIANT] ?? ("outline" as const);
  return (
    <Menu>
      <MenuTrigger
        disabled={busy}
        render={
          <Badge
            render={<button type="button" />}
            variant={variant}
            size="lg"
            className="cursor-pointer gap-1 uppercase"
          />
        }
      >
        {busy ? "Moving…" : issue.status}
        <ChevronDownIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <MenuGroupLabel>Move to</MenuGroupLabel>
          {issue.transitions.length === 0 ? (
            <MenuItem disabled>Jira offers no transitions from {issue.status}</MenuItem>
          ) : (
            issue.transitions.map((option) => (
              <MenuItem key={option.id} onClick={() => onTransition(option.id)}>
                {option.name}
                {option.toStatus !== option.name ? (
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">
                    → {option.toStatus}
                  </span>
                ) : null}
              </MenuItem>
            ))
          )}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export function JiraIssuePanel({
  threadRef,
  issueKey,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly issueKey: string;
}) {
  const environmentId = threadRef.environmentId;
  const query = useEnvironmentQuery(
    previewEnvironment.jiraIssue({ environmentId, input: { key: issueKey } }),
  );
  const issue = query.data;
  const transition = useAtomCommand(previewEnvironment.transitionJiraIssue, {
    reportFailure: false,
  });
  const [transitioning, setTransitioning] = useState(false);
  const changeStatus = async (transitionId: string) => {
    setTransitioning(true);
    const result = await transition({ environmentId, input: { key: issueKey, transitionId } });
    setTransitioning(false);
    if (result._tag === "Success") {
      query.refresh();
      return;
    }
    const failure = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: `Could not change ${issueKey}`,
      description:
        failure && typeof failure === "object" && "reason" in failure
          ? String(failure.reason)
          : String(failure),
    });
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b px-4 pt-3 pb-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {issue?.parent ? (
            <>
              <button
                type="button"
                className="truncate hover:text-foreground hover:underline"
                onClick={() => openJiraIssue(threadRef, issue.parent!.key)}
              >
                {issue.parent.key} {issue.parent.summary}
              </button>
              <span>/</span>
            </>
          ) : null}
          <span className="shrink-0 font-mono">{issueKey}</span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh"
              disabled={query.isPending}
              onClick={() => query.refresh()}
            >
              <RefreshCwIcon className={query.isPending ? "animate-spin" : undefined} />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Open in Jira"
              onClick={() => openExternal(issue?.url ?? jiraIssueUrl(issueKey))}
            >
              <ExternalLinkIcon />
            </Button>
          </div>
        </div>
        <h1 className="text-base leading-snug font-semibold">{issue?.summary ?? issueKey}</h1>
        {issue ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusMenu
              issue={issue}
              busy={transitioning}
              onTransition={(id) => void changeStatus(id)}
            />
            {issue.issueType ? <span>{issue.issueType}</span> : null}
            {issue.updated ? <span>· updated {formatDate(issue.updated)}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.error && !issue ? (
          <p className="p-4 text-sm text-destructive-foreground">{query.error}</p>
        ) : null}
        {!issue && !query.error ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : null}
        {issue ? (
          <>
            <section className="space-y-1 px-4 pt-2.5 pb-1">
              <MetaRow icon={<UserIcon className="size-3.5" />} label="Assignee">
                {issue.assignee ?? <span className="text-muted-foreground">Unassigned</span>}
              </MetaRow>
              <MetaRow icon={<UserPenIcon className="size-3.5" />} label="Reporter">
                {issue.reporter ?? <span className="text-muted-foreground">None</span>}
              </MetaRow>
              <MetaRow icon={<FlagIcon className="size-3.5" />} label="Priority">
                {issue.priority ?? <span className="text-muted-foreground">None</span>}
              </MetaRow>
              <MetaRow icon={<TimerIcon className="size-3.5" />} label="Sprint">
                {issue.sprint ?? <span className="text-muted-foreground">None</span>}
              </MetaRow>
              {issue.components.length > 0 ? (
                <MetaRow icon={<PuzzleIcon className="size-3.5" />} label="Components">
                  {issue.components.join(", ")}
                </MetaRow>
              ) : null}
              <MetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
                {issue.labels.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {issue.labels.map((label) => (
                      <Badge key={label} variant="outline">
                        {label}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </MetaRow>
              {issue.dueDate ? (
                <MetaRow icon={<CalendarIcon className="size-3.5" />} label="Due">
                  {formatDay(issue.dueDate)}
                </MetaRow>
              ) : null}
              {issue.created ? (
                <MetaRow icon={<LayersIcon className="size-3.5" />} label="Created">
                  {formatDate(issue.created)}
                </MetaRow>
              ) : null}
            </section>

            <Section title="Description">
              {issue.descriptionHtml ? (
                <JiraHtml html={issue.descriptionHtml} threadRef={threadRef} />
              ) : (
                <p className="text-sm text-muted-foreground italic">No description provided.</p>
              )}
            </Section>

            <Section title={`Comments (${issue.comments.length})`}>
              {issue.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No comments yet.</p>
              ) : (
                <div className="space-y-3">
                  {issue.comments.map((comment) => (
                    <article
                      key={`${comment.created}-${comment.author}`}
                      className="rounded-lg border border-border/60 bg-background"
                    >
                      <div className="flex items-center gap-2 rounded-t-lg bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {comment.author ?? "Unknown"}
                        </span>
                        <span>{formatDate(comment.created)}</span>
                      </div>
                      <JiraHtml
                        className="px-3 py-3"
                        html={comment.bodyHtml}
                        threadRef={threadRef}
                      />
                    </article>
                  ))}
                </div>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}
