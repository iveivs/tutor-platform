import { describe, expect, it } from "vitest";
import { collectChangedSections, syncDelayForMoscowHour } from "./incremental-sync";

describe("incremental synchronization", () => {
  it("collects only known changed sections and advances to the newest cursor", () => {
    const result = collectChangedSections([
      { sections: "requests,lessons,historyEvents", id: 12 },
      { sections: "notifications,unknown", id: 15 },
    ], 10);

    expect([...result.sections]).toEqual(["requests", "lessons", "historyEvents", "notifications"]);
    expect(result.cursor).toBe(15);
  });

  it("uses the agreed daytime and nighttime schedule", () => {
    expect(syncDelayForMoscowHour(0)).toBe(60_000);
    expect(syncDelayForMoscowHour(1)).toBe(600_000);
    expect(syncDelayForMoscowHour(6)).toBe(600_000);
    expect(syncDelayForMoscowHour(7)).toBe(60_000);
    expect(syncDelayForMoscowHour(23)).toBe(60_000);
  });
});
