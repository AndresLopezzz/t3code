import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { withFileUndo, withProviderStartup } from "./fileUndoBarrier.ts";

it.effect("allows provider startups to run concurrently", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstEntered = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const start = (entered: Deferred.Deferred<void>) =>
        withProviderStartup(
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
        );
      const first = yield* start(firstEntered).pipe(Effect.forkChild);
      const second = yield* start(secondEntered).pipe(Effect.forkChild);
      yield* Deferred.await(firstEntered);
      yield* Deferred.await(secondEntered);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }),
  ),
);

it.effect("prevents a provider from starting between undo validation and file writes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let started = false;
      const provider = yield* withFileUndo(
        Effect.gen(function* () {
          const fiber = yield* withProviderStartup(
            Effect.sync(() => {
              started = true;
            }),
          ).pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          expect(started).toBe(false);
          return fiber;
        }),
      );
      yield* Fiber.join(provider);
      expect(started).toBe(true);
    }),
  ),
);
