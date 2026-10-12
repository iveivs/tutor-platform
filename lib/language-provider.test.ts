import { describe, expect, it } from "vitest";
import { translateUiText } from "../components/language-provider";

describe("translateUiText", () => {
  it.each([
    ["Недавние уроки", "Recent lessons"],
    ["Материалы", "Materials"],
    ["Сегодня, ", "Today, "],
    ["Сегодня, 12 октября", "Today, 12 October"],
    ["30 Сентября", "30 September"],
    ["12 октября 2026 г.", "12 October 2026"],
    [" · нажмите на урок для управления", " · select a lesson to manage"],
    ["Открыть календарь", "Open calendar"],
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
