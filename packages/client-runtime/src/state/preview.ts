import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createPreviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const lifecycleScheduler = createAtomCommandScheduler();
  const statusScheduler = createAtomCommandScheduler();
  const lifecycleConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      JSON.stringify([environmentId, input.threadId]),
  };
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:preview:list",
      tag: WS_METHODS.previewList,
      staleTimeMs: 5_000,
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:preview:events",
      tag: WS_METHODS.subscribePreviewEvents,
    }),
    discoveredServers: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:preview:discovered-servers",
      tag: WS_METHODS.subscribeDiscoveredLocalServers,
      // Configured URLs are part of this atom's key. Dispose immediately so
      // unmounted projects stop contributing probe candidates on the server.
      idleTtlMs: 0,
    }),
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:open",
      tag: WS_METHODS.previewOpen,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    navigate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:navigate",
      tag: WS_METHODS.previewNavigate,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    resize: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:resize",
      tag: WS_METHODS.previewResize,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    adjust: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:adjust",
      tag: WS_METHODS.previewAdjust,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    refresh: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:refresh",
      tag: WS_METHODS.previewRefresh,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    close: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:close",
      tag: WS_METHODS.previewClose,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    clearProfile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:clear-profile",
      tag: WS_METHODS.previewClearProfile,
    }),
    killLocalServer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:kill-local-server",
      tag: WS_METHODS.localServerKill,
    }),
    setVpn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:set-vpn",
      tag: WS_METHODS.vpnSet,
    }),
    transitionJiraIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:transition",
      tag: WS_METHODS.jiraTransition,
    }),
    moveJiraIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:move",
      tag: WS_METHODS.jiraMove,
    }),
    jiraBoard: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:board",
      tag: WS_METHODS.jiraBoard,
      staleTimeMs: 30_000,
    }),
    jiraIssue: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:jira:issue",
      tag: WS_METHODS.jiraIssue,
      staleTimeMs: 30_000,
    }),
    reportProfiles: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:report-profiles",
      tag: WS_METHODS.previewReportProfiles,
      concurrency: { mode: "latest", key: ({ environmentId }) => environmentId },
    }),
    reportStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:preview:report-status",
      tag: WS_METHODS.previewReportStatus,
      scheduler: statusScheduler,
      concurrency: {
        mode: "latest",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.threadId, input.tabId]),
      },
    }),
  };
}
