import { it, expect } from "@effect/vitest";
import { MessageId, ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Positions from "./TurnItemPositionStore.ts";

const layerTest = Positions.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

it.effect("places reopened terminal history after T3 turns and keeps retry positions stable", () =>
  Effect.gen(function* () {
    const positions = yield* Positions.TurnItemPositionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const threadId = ThreadId.make("terminal-position-thread");
    const at = DateTime.makeUnsafe("2026-10-09T12:00:00Z");
    const item = (id: string, ordinal: number): OrchestrationV2TurnItem => ({
      id: TurnItemId.make(id),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      status: "completed",
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
      type: "assistant_message",
      messageId: MessageId.make(id),
      text: id,
      streaming: false,
    });
    yield* sql`INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal) VALUES (${threadId}, 't3-last-item', 1000005)`;
    expect((yield* positions.normalize(item("initial-import", 1))).ordinal).toBe(1);
    const terminal = yield* positions.normalize(item("terminal-tail", 1_000_006));
    expect(terminal.ordinal).toBe(1_000_006);
    expect((yield* positions.normalize(item("terminal-tail", 1_000_007))).ordinal).toBe(
      terminal.ordinal,
    );
    expect((yield* positions.normalize(item("terminal-next", 1_000_007))).ordinal).toBe(1_000_007);
  }).pipe(Effect.provide(layerTest)),
);
