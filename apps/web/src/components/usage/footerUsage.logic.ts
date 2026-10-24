import type { ServerProviderUsageWindow } from "@t3tools/contracts";

export function tightestUsageWindow(
  windows: readonly ServerProviderUsageWindow[],
): ServerProviderUsageWindow | null {
  return windows.reduce<ServerProviderUsageWindow | null>(
    (best, window) => (best === null || window.usedPercent > best.usedPercent ? window : best),
    null,
  );
}
