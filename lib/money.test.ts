import { describe, expect, it } from "vitest";
import { formatMoney, moneyInputValue, parseMoneyInput } from "./money";

describe("money", () => {
  it("formats minor units with an optional currency label", () => {
    expect(formatMoney(200000, "руб.")).toBe("2 000 руб.");
    expect(formatMoney(199950, "$")).toBe("1 999,5 $");
    expect(formatMoney(5000)).toBe("50");
  });

  it("parses typed amounts", () => {
    expect(parseMoneyInput("2 000")).toBe(200000);
    expect(parseMoneyInput("19,99")).toBe(1999);
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNaN();
    expect(parseMoneyInput("1,234")).toBeNaN();
  });

  it("prepares input values", () => {
    expect(moneyInputValue(200000)).toBe("2000");
    expect(moneyInputValue(1999)).toBe("19,99");
    expect(moneyInputValue(null)).toBe("");
  });
});
