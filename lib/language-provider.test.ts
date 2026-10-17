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
    ["Необязательно. Оставьте пустым, если подпись над именем не нужна.", "Optional. Leave this blank if you do not need a subtitle."],
    ["Эти интервалы используются для показа свободного времени ученикам, которым вы дали доступ. Можно добавить несколько интервалов на один день.", "These time windows define the availability shown to students you have granted access. You can add several windows for the same day."],
    ["Расписание осталось без изменений", "The schedule remains unchanged"],
    ["Уведомления в Telegram", "Telegram notifications"],
    ["Проверить подключение", "Check connection"],
    ["Баланс: ", "Balance: "],
    ["Баланс: 10 занятий", "Balance: 10 lessons"],
    ["Баланс: -1 занятие", "Balance: -1 lesson"],
    ["Баланс -1", "Balance: -1 lesson"],
    ["Необходимо оплатить 1 занятие", "Payment required for 1 lesson"],
    ["Вс 15:00", "Sun 15:00"],
    ["пн, 12 окт.", "Mon, 12 Oct"],
    ["Остановить", "Stop"],
    ["0 из 50 загрузок в этом месяце", "0 of 50 uploads this month"],
    ["0 КБ из 5120 МБ", "0 KB of 5120 MB"],
    ["Показано 0 из 0", "Showing 0 of 0"],
    ["Упражнения на координацию", "Coordination exercises"],
    ["Поиск работает по названию, файлу, папкам, тегам и ученикам.", "Search by title, file, folder, tag, or student."],
    [" из ", " of "],
    [" загрузок в этом месяце", " uploads this month"],
    ["Показано ", "Showing "],
    ["0 КБ", "0 KB"],
    ["5120 МБ", "5120 MB"],
    ["5 слотов", "5 slots"],
    ["Запрос на новый урок отклонён", "New lesson request declined"],
    ["Двойной урок проведён", "Double lesson completed"],
    ["Списание за двойной урок", "Double lesson charge"],
    ["Автоматически", "Automatically"],
    ["10 октября 2026 г. в 21:29", "10 October 2026 at 21:29"],
    ["30 сентября 2026 г. в 17:00–19:00 · 2 занятия", "30 September 2026 at 17:00–19:00 · 2 lessons"],
    ["Назначен урок", "Lesson scheduled"],
    ["Урок назначен на 2026-10-12 в 17:00.", "Lesson scheduled for 12 October 2026 at 17:00."],
    ["-1 занятие · Урок проведён", "-1 lesson · Lesson completed"],
    ["+10 занятий · Оплата занятий", "+10 lessons · Lesson payment"],
    ["-2 занятий · Двойной урок", "-2 lessons · Double lesson"],
    ["Оплата учтена · отменена", "Payment recorded · reversed"],
    ["Пробное занятие проведено", "Trial lesson completed"],
    ["2 октября 2026 г. в 17:00–18:00 · Пробное занятие · бесплатно", "2 October 2026 at 17:00–18:00 · Trial lesson · free"],
    ["0 непрочитанных", "0 unread"],
    ["Новый запрос ученика", "New student request"],
    ["Новое занятие: запрос требует ответа", "New lesson: request needs review"],
    ["Документы (3)", "Documents (3)"],
    ["Фотографии (2)", "Photos (2)"],
    ["Фотография от Светослав", "Photo from Светослав"],
  ])("translates %s", (source, expected) => {
    expect(translateUiText(source)).toBe(expected);
  });

  it("covers the recently added materials and lesson workflow", () => {
    const texts = [
      "Библиотека преподавателя",
      "Добавить документ",
      "Нет непривязанных документов",
      "Настроить материал",
      "Заменить файл",
      "Правила пользовательского контента",
      "Домашнее задание",
      "Задание ученику",
      "Личная заметка преподавателя",
      "Ученик пока не добавил ответ.",
      "Фотография удалена",
      "Не удалось загрузить материалы урока",
      "Материалы и домашка",
      "Отменить без списания",
      "Все документы и фотографии, которыми преподаватель поделился на уроках.",
      "Открываю PDF…",
      "Не удалось открыть PDF",
      "Скачайте файл и откройте его на устройстве.",
      "Открываю документ…",
      "Этот формат нельзя показать в браузере",
      "Преподаватель пока не добавил документов.",
      "Новое сообщение",
      "Ученик отправил вам сообщение.",
      "Преподаватель отправил вам сообщение.",
      "Новое домашнее задание",
      "Преподаватель добавил или обновил домашнее задание к уроку.",
      "Добавлен материал к уроку",
      "Преподаватель поделился новым материалом.",
    ];

    for (const text of texts) expect(translateUiText(text)).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("covers messages and profile personalization", () => {
    const texts = [
      "Сообщения",
      "Написать ученику",
      "Короткие личные сообщения между учеником и преподавателем.",
      "Сообщений пока нет",
      "Введите сообщение",
      "Персонализация",
      "Фото профиля и цвет кружка с инициалами",
      "Цвет аватара",
      "Загрузить фотографию",
      "Использовать цвет ученика",
      "Фотография профиля должна быть не больше 2 МБ",
    ];

    for (const text of texts) expect(translateUiText(text)).not.toMatch(/[А-Яа-яЁё]/);
  });
});
