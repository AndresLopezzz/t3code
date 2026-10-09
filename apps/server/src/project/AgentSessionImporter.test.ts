import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as AgentSessionImporter from "./AgentSessionImporter.ts";
import * as AgentSessionScanner from "./AgentSessionScanner.ts";
import * as ProjectService from "./ProjectService.ts";

const projectId = ProjectId.make("agent-session-import-project");
const providerInstanceId = ProviderInstanceId.make("codex");
const providerSessionId = "native-codex-thread";
const threadId = ThreadId.make(`import:${providerInstanceId}:${providerSessionId}`);

it.effect("imports messages once and preserves the provider native resume binding", () => {
  const writes: Array<ReadonlyArray<OrchestrationV2DomainEvent>> = [];
  const upserts: Array<unknown> = [];
  const recorded: Array<unknown> = [];
  let imported = false;
  let active = false;
  let includeOtherSession = false;
  let continuedInT3 = false;
  const messages = [
    { role: "user" as const, text: "Fix it", createdAt: "2026-09-01T10:00:00.000Z" },
    { role: "assistant" as const, text: "Fixed", createdAt: "2026-09-01T10:01:00.000Z" },
  ];
  const scanner = AgentSessionScanner.AgentSessionScanner.of({
    scan: Effect.die("unused"),
    recentThreads: () =>
      Stream.succeed<AgentSessionScanner.AgentSessionRecentThread>({
        _tag: "Importable",
        source: {
          provider: "codex",
          providerInstanceId,
          providerSessionId,
          filePath: "/tmp/native-codex-thread.jsonl",
          size: 100,
          mtimeMs: 2,
          device: 3,
          inode: 4,
          birthtimeMs: 1,
        },
        thread: {
          source: "codex",
          providerInstanceId,
          providerSessionId,
          title: "Imported thread",
          model: "gpt-5.4",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:01:00.000Z",
          messages,
        },
      }).pipe(
        Stream.concat(
          includeOtherSession
            ? Stream.succeed<AgentSessionScanner.AgentSessionRecentThread>({
                _tag: "Importable" as const,
                source: {
                  provider: "codex" as const,
                  providerInstanceId,
                  providerSessionId: "other-session",
                  filePath: "/tmp/other-session.jsonl",
                  size: 100,
                  mtimeMs: 2,
                  device: 3,
                  inode: 5,
                  birthtimeMs: 1,
                },
                thread: {
                  source: "codex" as const,
                  providerInstanceId,
                  providerSessionId: "other-session",
                  title: "Other session",
                  model: "gpt-5.4",
                  createdAt: "2026-09-01T10:00:00.000Z",
                  updatedAt: "2026-09-01T10:01:00.000Z",
                  messages: [],
                },
              })
            : Stream.empty,
        ),
      ),
  });
  const layerTest = AgentSessionImporter.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(AgentSessionScanner.AgentSessionScanner, scanner),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeed(
              Option.some({ id: projectId, workspaceRoot: "/workspace/project" } as never),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: () =>
            imported
              ? Effect.succeed({
                  thread: { id: threadId, projectId, historyOrigin: "v1_import" },
                  messages: writes.flatMap((events) =>
                    events.flatMap((event) =>
                      event.type === "message.updated" ? [event.payload] : [],
                    ),
                  ),
                  turnItems: writes.flatMap((events) =>
                    events.flatMap((event) =>
                      event.type === "turn-item.updated" ? [event.payload] : [],
                    ),
                  ),
                  runs: active
                    ? [{ completedAt: null }]
                    : continuedInT3
                      ? [
                          {
                            completedAt: DateTime.makeUnsafe("2026-09-01T10:05:00.000Z"),
                          },
                        ]
                      : [],
                } as never)
              : Effect.fail(new Orchestrator.OrchestratorProjectionError({ threadId })),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          write: (input) =>
            Effect.sync(() => {
              writes.push(input.events);
              imported = true;
              return [];
            }),
        }),
        Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({
          list: () => Effect.succeed([]),
          upsert: (input) => Effect.sync(() => void upserts.push(input)),
          recordImportedTranscript: (input) => Effect.sync(() => void recorded.push(input)),
        }),
        IdAllocator.layer,
        NodeCrypto.layer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const importer = yield* AgentSessionImporter.AgentSessionImporter;
    const selected = { projectId, session: { providerInstanceId, providerSessionId } };
    expect(yield* importer.importRecentAgentThreads(selected)).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });
    expect(yield* importer.importRecentAgentThreads(selected)).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.map((event) => event.type)).toEqual([
      "thread.created",
      "message.updated",
      "turn-item.updated",
      "message.updated",
      "turn-item.updated",
      "provider-thread.updated",
    ]);
    const created = writes[0]?.find((event) => event.type === "thread.created");
    const providerThread = writes[0]?.find((event) => event.type === "provider-thread.updated");
    expect(created?.payload).toMatchObject({
      id: threadId,
      activeProviderThreadId: providerThread?.payload.id,
      historyOrigin: "v1_import",
    });
    expect(providerThread?.payload).toMatchObject({
      appThreadId: threadId,
      nativeThreadRef: {
        driver: "codex",
        nativeId: providerSessionId,
        strength: "strong",
      },
    });
    expect(
      writes[0]
        ?.filter((event) => event.type === "message.updated")
        .map((event) => event.payload.text),
    ).toEqual(["Fix it", "Fixed"]);
    expect(upserts).toEqual([
      expect.objectContaining({
        threadId,
        providerInstanceId,
        resumeCursor: { threadId: providerSessionId },
      }),
    ]);
    expect(recorded).toHaveLength(2);

    // A second terminal turn appends, retaining the original messages and binding.
    messages.push({ role: "user", text: "Fix it", createdAt: "2026-09-01T10:02:00.000Z" });
    messages.push({
      role: "assistant",
      text: "Fixed again",
      createdAt: "2026-09-01T10:03:00.000Z",
    });
    yield* importer.importRecentAgentThreads(selected);
    expect(writes).toHaveLength(2);
    expect(
      writes[1]
        ?.filter((event) => event.type === "message.updated")
        .map((event) => event.payload.text),
    ).toEqual(["Fix it", "Fixed again"]);
    expect(
      writes[1]
        ?.filter((event) => event.type === "turn-item.updated")
        .map((event) => event.payload.ordinal),
    ).toEqual([3, 4]);
    yield* importer.importRecentAgentThreads(selected);
    expect(writes).toHaveLength(2);
    expect(upserts).toHaveLength(1);

    // A moving 200-message scan window must not reuse index-based IDs.
    messages.splice(1, 1);
    active = true;
    messages.push({ role: "user", text: "From terminal", createdAt: "2026-09-01T10:06:00.000Z" });
    const recordedBeforeActiveRefresh = recorded.length;
    expect(yield* importer.importRecentAgentThreads(selected)).toEqual({
      importedCount: 0,
      skippedCount: 1,
    });
    expect(recorded).toHaveLength(recordedBeforeActiveRefresh);
    expect(writes).toHaveLength(2);

    active = false;
    continuedInT3 = true;
    // Native messages from a T3 turn are already represented in its timeline.
    messages.splice(1, 0, {
      role: "assistant",
      text: "T3 reply",
      createdAt: "2026-09-01T10:04:00.000Z",
    });
    yield* importer.importRecentAgentThreads(selected);
    expect(writes).toHaveLength(3);
    expect(
      writes[2]
        ?.filter((event) => event.type === "message.updated")
        .map((event) => event.payload.text),
    ).toEqual(["From terminal"]);
    const messageIds = writes.flatMap((events) =>
      events.flatMap((event) => (event.type === "message.updated" ? [event.payload.id] : [])),
    );
    expect(new Set(messageIds).size).toBe(messageIds.length);

    includeOtherSession = true;
    const listed = yield* importer.listFolderSessions("/workspace/project");
    expect(listed.sessions?.map((session) => session.providerSessionId)).toEqual([
      providerSessionId,
      "other-session",
    ]);
    expect(writes).toHaveLength(3); // Browsing is read-only.
    expect(yield* importer.importRecentAgentThreads(selected)).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });
    expect(writes).toHaveLength(3); // Opening one session never imports another.
    includeOtherSession = false;
    messages.push({
      role: "assistant",
      text: "Only explicit open refreshes",
      createdAt: "2026-09-01T10:07:00.000Z",
    });
    yield* importer.importRecentAgentThreads({ projectId });
    expect(writes).toHaveLength(3); // Preserve the original bulk import behavior.
    yield* importer.importRecentAgentThreads(selected);
    expect(writes).toHaveLength(4);
  }).pipe(Effect.provide(layerTest));
});
