import type { OrchestrationV2AppThread, OrchestrationV2ProviderThread } from "@t3tools/contracts";

/** Imported terminal history belongs to this native session, even before its first app run. */
export function isImportedNativeSession(
  thread: Pick<OrchestrationV2AppThread, "id" | "historyOrigin">,
  providerThread:
    | Pick<OrchestrationV2ProviderThread, "providerInstanceId" | "nativeThreadRef">
    | undefined,
): boolean {
  const native = providerThread?.nativeThreadRef;
  // Any instance: a switch only carries the native ref over when both share one history.
  return (
    thread.historyOrigin === "v1_import" &&
    native?.strength === "strong" &&
    thread.id.startsWith("import:") &&
    thread.id.endsWith(`:${native.nativeId}`)
  );
}
