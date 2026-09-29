import { describe, expect, it } from "vitest";
import { buildAvailableSlots, normalizeAvailabilityWindow } from "./availability";

describe("availability", () => {
  it("normalizes a night interval into the next day", () => {
    expect(normalizeAvailabilityWindow(1, "22:00", "02:00")).toEqual({ weekday: 1, startMinutes: 1320, endMinutes: 1560 });
  });

  it("removes busy hours and marks two consecutive hours", () => {
    const window = normalizeAvailabilityWindow(1, "17:00", "21:00")!;
    const mondayStart = new Date("2026-09-28T00:00:00+03:00").getTime();
    const slots = buildAvailableSlots([window], [{ start: mondayStart + 18 * 60 * 60_000, end: mondayStart + 19 * 60 * 60_000 }], mondayStart, 1);

    expect(slots).toEqual([
      { startsAt: mondayStart + 17 * 60 * 60_000, endsAt: mondayStart + 18 * 60 * 60_000, maxUnits: 1 },
      { startsAt: mondayStart + 19 * 60 * 60_000, endsAt: mondayStart + 20 * 60 * 60_000, maxUnits: 2 },
      { startsAt: mondayStart + 20 * 60 * 60_000, endsAt: mondayStart + 21 * 60 * 60_000, maxUnits: 1 },
    ]);
  });
});
