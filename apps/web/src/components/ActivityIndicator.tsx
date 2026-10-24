import type { CSSProperties } from "react";
import { observeVisibleAnimation } from "../lib/visibleAnimation";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function ActivityIndicator({ kind }: { kind: "thinking" | "terminal" }) {
  return (
    <span
      ref={observeVisibleAnimation}
      className={`activity-indicator activity-${kind}`}
      aria-hidden="true"
    >
      {kind === "thinking"
        ? BRAILLE_FRAMES.map((frame, index) => (
            <span key={frame} style={{ "--activity-frame": index } as CSSProperties}>
              {frame}
            </span>
          ))
        : [0, 1, 2].map((index) => (
            <span key={index} style={{ "--activity-frame": index } as CSSProperties} />
          ))}
    </span>
  );
}
