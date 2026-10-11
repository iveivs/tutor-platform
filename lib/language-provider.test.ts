import { describe, expect, it } from "vitest";
import { translateUiText } from "../components/language-provider";

describe("translateUiText", () => {
  it.each([
    ["Недавние уроки", "Recent lessons"],
    ["Материалы", "Materials"],
    ["30 Сентября", "30 September"],
    ["Расписание осталось без изменений", "The schedule remains unchanged"],
    ["Уведомления в Telegram", "Telegram notifications"],
    ["Проверить подключение", "Check connection"],
    ["Баланс: ", "Balance: "],
    ["Баланс: 10 занятий", "Balance: 10 lessons"],
    ["Баланс: -1 занятие", "Balance: -1 lesson"],
    ["Необходимо оплатить 1 занятие", "Payment required for 1 lesson"],
    ["Вс 15:00", "Sun 15:00"],
    ["Остановить", "Stop"],
  ])("translates %s", (source, expected) => {
    expect(translateUiText(source)).toBe(expected);
  });
});
