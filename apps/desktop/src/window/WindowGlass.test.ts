import { describe, expect, it, vi } from "vite-plus/test";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));
import { requestKwinBlur, windowGlassOptions } from "./WindowGlass.ts";

describe("native window glass", () => {
  it.each(["darwin", "win32", "linux"] as const)(
    "leaves the default window unchanged on %s",
    (platform) => {
      expect(windowGlassOptions(false, platform)).toEqual({});
    },
  );

  it("uses native blur materials on macOS and Windows and transparency on Linux", () => {
    expect(windowGlassOptions(true, "darwin")).toEqual({
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      visualEffectState: "followWindow",
    });
    expect(windowGlassOptions(true, "win32")).toEqual({
      transparent: true,
      backgroundColor: "#00000000",
      backgroundMaterial: "acrylic",
    });
    expect(windowGlassOptions(true, "linux")).toEqual({
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
    });
  });

  it.each([4, 8])("sets the full-window KWin blur hint for a %s-byte X11 handle", async (size) => {
    execFile.mockImplementation((_file, _args, _options, callback) => callback(null));
    const handle = Buffer.alloc(size);
    handle.writeUInt32LE(123456);
    await requestKwinBlur(handle);
    expect(execFile).toHaveBeenLastCalledWith(
      "xprop",
      [
        "-id",
        "123456",
        "-f",
        "_KDE_NET_WM_BLUR_BEHIND_REGION",
        "32c",
        "-set",
        "_KDE_NET_WM_BLUR_BEHIND_REGION",
        "0",
      ],
      { timeout: 2000 },
      expect.any(Function),
    );
  });

  it("reports a missing xprop so the caller can keep transparency without blur", async () => {
    execFile.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error("ENOENT")),
    );
    await expect(requestKwinBlur(Buffer.alloc(4))).rejects.toThrow("ENOENT");
  });
});
