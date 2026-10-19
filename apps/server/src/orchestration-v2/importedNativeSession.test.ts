import { describe, expect, it } from "@effect/vitest";

import { isImportedNativeSession } from "./importedNativeSession.ts";

const thread = { id: "import:claudeAgent:session-1", historyOrigin: "v1_import" } as const;
const providerThread = (providerInstanceId: string, nativeId: string) =>
  ({
    providerInstanceId,
    nativeThreadRef: { strength: "strong", nativeId },
  }) as unknown as Parameters<typeof isImportedNativeSession>[1];

describe("isImportedNativeSession", () => {
  it.each([
    ["the importing instance", "claudeAgent", "session-1", true],
    ["a second account resuming the same session", "claudeNaowee", "session-1", true],
    ["a different native session", "claudeAgent", "session-2", false],
  ])("%s", (_label, instanceId, nativeId, expected) => {
    expect(isImportedNativeSession(thread as never, providerThread(instanceId, nativeId))).toBe(
      expected,
    );
  });
});
