import { describe, expect, it } from "vite-plus/test";
import { tightestUsageWindow } from "./footerUsage.logic";

describe("footer quota summary", () => {
  it("reflects an exhausted weekly allowance even when the session has room", () => {
    const session = {
      id: "five_hour",
      kind: "session",
      label: "5-hour limit",
      usedPercent: 10,
    } as const;
    const weekly = {
      id: "seven_day",
      kind: "weekly",
      label: "Weekly limit",
      usedPercent: 100,
    } as const;
    expect(tightestUsageWindow([session, weekly])).toBe(weekly);
    expect(tightestUsageWindow([weekly, session])).toBe(weekly);
  });
  it("handles accounts whose provider returns no windows", () => {
    expect(tightestUsageWindow([])).toBeNull();
  });
});
