import { expect, it } from "vite-plus/test";
import { act, render } from "../../../test/render";

import "~/index.css";
import { ScrollArea } from "./scroll-area";

it("only composites scroll fades while content overflows, including after a resize", async () => {
  const container = document.createElement("div");
  container.style.cssText = "width:500px;height:100px";
  await using screen = await render(
    <ScrollArea scrollFade>
      <div style={{ width: 400, height: 40 }}>Content</div>
    </ScrollArea>,
    { container },
  );
  const viewport = screen.container.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  )!;
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
});
