// Reminders about the end of a workspace's paid access, used by the worker. A reminder goes out
// 7, 3 and 1 day before the last day and once when access has ended (stage 0); each stage once.

/** Stage due for a workspace, or null. daysLeft counts calendar days to the last day (today = 0). */
export function accessReminderStage(daysLeft, ended) {
  if (ended) return 0;
  if (daysLeft <= 1) return 1;
  if (daysLeft <= 3) return 3;
  if (daysLeft <= 7) return 7;
  return null;
}

function daysWord(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "день";
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return "дня";
  return "дней";
}

/** Notification text (Russian, as all stored notifications) for one reminder. */
export function accessReminderText({ stage, daysLeft, accessGrant, endLabel }) {
  const where = "Продлить можно в Настройках → Подписка.";
  if (stage === 0) {
    return { title: "Кабинет в режиме просмотра", body: `Срок доступа закончился ${endLabel}. Данные сохранены. ${where}` };
  }
  const title = accessGrant === "trial" ? "Пробный период заканчивается" : "Доступ к Тьюттори заканчивается";
  const when = daysLeft <= 0 ? "Последний день — сегодня." : `${daysLeft === 1 ? "Остался" : "Осталось"} ${daysLeft} ${daysWord(daysLeft)}: доступ до ${endLabel} включительно.`;
  return { title, body: `${when} ${where}` };
}
