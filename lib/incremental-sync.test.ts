import { describe, expect, it } from "vitest";
import { collectChangedSections, syncDelayForVisibility } from "./incremental-sync";

describe("incremental synchronization", () => {
  it("collects only known changed sections and advances to the newest cursor", () => {
    const result = collectChangedSections([
      { sections: "requests,lessons,historyEvents", id: 12 },
      { sections: "notifications,availability,unknown", id: 15 },
    ], 10);

    expect([...result.sections]).toEqual(["requests", "lessons", "historyEvents", "notifications", "availability"]);
    expect(result.cursor).toBe(15);
  });

  it("polls an active tab every 30 seconds and a hidden tab every 5 minutes", () => {
    expect(syncDelayForVisibility(true)).toBe(30_000);
    expect(syncDelayForVisibility(false)).toBe(300_000);
  });
});
