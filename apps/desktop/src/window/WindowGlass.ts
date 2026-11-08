// @effect-diagnostics nodeBuiltinImport:off -- X11 window properties are a native desktop boundary.
import * as NodeChildProcess from "node:child_process";
import type { BrowserWindowConstructorOptions } from "electron";

export function windowGlassOptions(
  enabled: boolean,
  platform: NodeJS.Platform,
): BrowserWindowConstructorOptions {
  if (!enabled) return {};
  return {
    transparent: true,
    backgroundColor: "#00000000",
    ...(platform === "darwin"
      ? ({ vibrancy: "under-window", visualEffectState: "followWindow" } as const)
      : {}),
    ...(platform === "win32" ? ({ backgroundMaterial: "acrylic" } as const) : {}),
    // Electron's framed Linux windows cannot expose a transparent client area.
    ...(platform === "linux" ? { frame: false } : {}),
  };
}

export function requestKwinBlur(handle: Buffer): Promise<void> {
  // Electron returns the X11 Window as an unsigned long; xprop accepts its decimal ID.
  const windowId =
    handle.length >= 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "xprop",
      [
        "-id",
        windowId,
        "-f",
        "_KDE_NET_WM_BLUR_BEHIND_REGION",
        "32c",
        "-set",
        "_KDE_NET_WM_BLUR_BEHIND_REGION",
        "0",
      ],
      { timeout: 2000 },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}
