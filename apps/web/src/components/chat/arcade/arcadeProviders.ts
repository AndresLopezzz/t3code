// Adapted from monocode, Copyright (c) 2026 Nick, MIT. See LICENSE.monocode.
import claude from "./assets/claude.svg";
import codex from "./assets/codex.svg";
import cursor from "./assets/cursor.svg";
import grok from "./assets/grok.svg";
import opencode from "./assets/opencode.svg";
import antigravity from "./assets/antigravity.svg";
export const HARNESSES = ["claude", "codex", "cursor", "grok", "opencode", "antigravity"] as const;
export type HarnessId = (typeof HARNESSES)[number];
export const HARNESS_ICONS: Record<HarnessId, string> = {
  claude,
  codex,
  cursor,
  grok,
  opencode,
  antigravity,
};
export const MONOCHROME_HARNESSES = new Set<HarnessId>(["cursor", "grok", "opencode"]);
