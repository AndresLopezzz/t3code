import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { ScrollArea } from "./scroll-area";

it("only composites scroll fades while content overflows, including after a resize", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  container.style.cssText = "width:500px;height:100px";
  document.body.append(container);
  const root = createRoot(container);
  const render = async (width: number) => {
    await act(async () => {
      root.render(
        <ScrollArea scrollFade>
          <div style={{ width, height: 40 }}>Content</div>
        </ScrollArea>,
      );
    });
  };
  try {
    await render(400);
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    await expect.poll(() => getComputedStyle(viewport).maskImage).toBe("none");
    await act(async () => {
      container.style.width = "200px";
    });
    await expect.poll(() => viewport.hasAttribute("data-has-overflow-x")).toBe(true);
    expect(getComputedStyle(viewport).maskImage).not.toBe("none");
    await act(async () => {
      container.style.width = "500px";
    });
    await expect.poll(() => getComputedStyle(viewport).maskImage).toBe("none");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
