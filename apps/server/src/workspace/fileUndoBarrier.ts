import * as Semaphore from "effect/Semaphore";

// Startups may run together; file undo takes every permit while checking for active runs.
// Running providers are rejected by the persisted-run check, rather than held under this lock.
const STARTUP_PERMITS = 1024;
const barrier = Semaphore.makeUnsafe(STARTUP_PERMITS);

export const withProviderStartup = barrier.withPermit;
export const withFileUndo = barrier.withPermits(STARTUP_PERMITS);
