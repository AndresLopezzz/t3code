import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  ThreadId,
  type AgentSessionCandidate,
  type AgentSessionProjectCandidate,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, RefreshCwIcon, TerminalIcon } from "lucide-react";
import { useRef, useState } from "react";

import { newProjectId } from "../lib/utils";
import { resolveOnboardingProjectId } from "../onboarding/projectImport.logic";
import { useProjectScans } from "../onboarding/useProjectScans";
import { agentSessionImport } from "../state/agentSessions";
import { readProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type Folder = {
  readonly environmentId: EnvironmentId;
  readonly candidate: AgentSessionProjectCandidate;
};

export function TerminalSessionsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Open existing session"
              onClick={() => setOpen(true)}
              className="flex h-full shrink-0 items-center px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <TerminalIcon className="size-3" />
            </button>
          }
        />
        <TooltipPopup side="top">Open existing session</TooltipPopup>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <TerminalSessionsDialog onOpened={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function TerminalSessionsDialog({ onOpened }: { readonly onOpened: () => void }) {
  const { environments } = useEnvironments();
  const permitted = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const attempts = useRef(new Map<string, ReturnType<typeof newProjectId>>());
  const environmentIds =
    folder !== null
      ? [folder.environmentId]
      : environments
          .filter(
            (environment) => environment.entry.enabled && permitted.has(environment.environmentId),
          )
          .map((environment) => environment.environmentId);
  const scans = useProjectScans(environmentIds, folder?.candidate.path);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importSession = useAtomCommand(agentSessionImport, { reportFailure: false });
  const candidates = scans
    .flatMap((scan) =>
      (scan.data?.candidates ?? []).map((candidate) => ({
        candidate,
        environmentId: scan.environmentId,
      })),
    )
    .filter(({ candidate }) =>
      `${candidate.title} ${candidate.path}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
  const sessions = scans
    .flatMap((scan) => scan.data?.sessions ?? [])
    .filter((session) =>
      `${session.title} ${session.providerSessionId}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const loading = scans.some((scan) => scan.isPending);

  async function openSession(session: AgentSessionCandidate) {
    if (folder === null || pending !== null) return;
    const { environmentId, candidate } = folder;
    setPending(session.providerSessionId);
    setError(null);
    const opened = await settlePromise(async () => {
      if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope))
        throw new Error("This computer does not allow opening sessions.");
      const key = `${environmentId}:${candidate.path}`;
      let projectId = resolveOnboardingProjectId(readProjects(), environmentId, candidate);
      if (projectId === null) {
        projectId = attempts.current.get(key) ?? newProjectId();
        attempts.current.set(key, projectId);
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            commandId: CommandId.make(`terminal-sessions:project:create:${projectId}`),
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (result._tag !== "Success") throw new Error("Could not add this folder. Try again.");
      }
      const result = await importSession({
        environmentId,
        input: {
          projectId,
          expectedWorkspaceRoot: candidate.path,
          session: {
            providerInstanceId: session.providerInstanceId,
            providerSessionId: session.providerSessionId,
          },
        },
      });
      if (result._tag !== "Success" || result.value.importedCount !== 1)
        throw new Error("Could not open this session. Finish any active turn and try again.");
      await navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId,
          threadId: ThreadId.make(
            `import:${session.providerInstanceId}:${session.providerSessionId}`,
          ),
        },
      });
      onOpened();
    });
    if (opened._tag === "Failure") {
      const cause = squashAtomCommandFailure(opened);
      setError(cause instanceof Error ? cause.message : "Could not open this session.");
    }
    setPending(null);
  }

  return (
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Open existing session</DialogTitle>
        <DialogDescription>
          {folder === null
            ? "Choose a folder, then a Claude Code or Codex session to continue in T3."
            : folder.candidate.path}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex items-center gap-2">
          {folder !== null ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Back to folders"
              disabled={pending !== null}
              onClick={() => {
                setFolder(null);
                setQuery("");
                setError(null);
              }}
            >
              <ArrowLeftIcon />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            <Input
              aria-label={folder === null ? "Search folders" : "Search sessions"}
              placeholder={folder === null ? "Search folders or paths" : "Search sessions"}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Scan again"
            disabled={loading || pending !== null}
            onClick={() => scans.forEach((scan) => scan.refresh())}
          >
            <RefreshCwIcon />
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {scans.map((scan) =>
          scan.error ? (
            <p key={scan.environmentId} role="alert" className="text-sm text-destructive">
              {scan.error}
            </p>
          ) : scan.data?.truncated ? (
            <p key={scan.environmentId} className="text-sm text-muted-foreground">
              Scan limit reached. Some sessions may be missing.
            </p>
          ) : null,
        )}
        {loading ? (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Looking for sessions…
          </div>
        ) : null}
        {!loading && (folder === null ? candidates : sessions).length === 0 ? (
          <p role="status" className="py-4 text-sm text-muted-foreground">
            {query.trim()
              ? "No matches found."
              : folder === null
                ? "No folders with terminal sessions found on your connected computers."
                : "No sessions found in this folder."}
          </p>
        ) : null}
        <div className="divide-y divide-border">
          {folder === null
            ? candidates.map(({ candidate, environmentId }) => (
                <div
                  key={`${environmentId}:${candidate.path}`}
                  className="flex min-w-0 items-start gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{candidate.title}</p>
                    <p className="break-all text-xs text-muted-foreground">{candidate.path}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {
                        environments.find(
                          (environment) => environment.environmentId === environmentId,
                        )?.label
                      }{" "}
                      · {candidate.threadCount} sessions
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFolder({ candidate, environmentId });
                      setQuery("");
                    }}
                  >
                    Browse
                  </Button>
                </div>
              ))
            : sessions.map((session) => (
                <div
                  key={`${session.providerInstanceId}:${session.providerSessionId}`}
                  className="flex min-w-0 items-start gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{session.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {session.source === "claudeAgent" ? "Claude Code" : "Codex"} ·{" "}
                      {new Date(session.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => void openSession(session)}
                  >
                    {pending === session.providerSessionId ? <Spinner /> : null}
                    {pending === session.providerSessionId ? "Opening…" : "Open"}
                  </Button>
                </div>
              ))}
        </div>
      </DialogPanel>
    </DialogPopup>
  );
}
