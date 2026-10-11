import { describe, expect, it } from "vitest";
import { russianPlural } from "./russian-plural";

describe("russianPlural", () => {
  it.each([
    [1, "1 занятие"],
    [2, "2 занятия"],
    [5, "5 занятий"],
    [10, "10 занятий"],
    [11, "11 занятий"],
    [21, "21 занятие"],
    [24, "24 занятия"],
    [25, "25 занятий"],
    [-1, "-1 занятие"],
    [-2, "-2 занятия"],
    [-10, "-10 занятий"],
  ])("formats %i correctly", (count, expected) => {
    expect(russianPlural(count, "занятие", "занятия", "занятий")).toBe(expected);
  });
});
