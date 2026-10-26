import type { AppNotification } from "@/components/features/app/types";
import { russianPlural } from "@/lib/russian-plural";

// Detail rows and the follow-up action for an activity notification.
const requestTypes: Record<string, string> = { cancel: "Отмена урока", reschedule: "Перенос урока", new_lesson: "Новое занятие" };
const requestStatuses: Record<string, string> = { pending: "Ожидает решения", approved: "Подтверждён", declined: "Отклонён", expired: "Истёк" };
const formatMoment = (value: number) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
const formatLesson = (startsAt: number, endsAt?: number) => `${formatMoment(startsAt)}${endsAt ? `–${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(endsAt))}` : ""}`;

export function notificationActionLabel(item: AppNotification) {
  return item.type === "direct_message" && item.studentId
    ? "Открыть сообщение"
    : item.type === "new_request" && item.requestId && item.requestStatus === "pending"
      ? "Открыть запрос"
      : null;
}

export function notificationDetails(item: AppNotification) {
  return [
    item.studentName ? { label: "Ученик", value: item.studentName } : null,
    item.requestType ? { label: "Запрос", value: requestTypes[item.requestType] ?? item.requestType } : null,
    item.requestStatus ? { label: "Статус", value: requestStatuses[item.requestStatus] ?? item.requestStatus } : null,
    item.lessonStartsAt ? { label: "Урок", value: formatLesson(item.lessonStartsAt, item.lessonEndsAt) } : null,
    item.proposedStartsAt ? { label: item.requestType === "reschedule" ? "Предложенное время" : "Время занятия", value: formatLesson(item.proposedStartsAt, item.proposedEndsAt) } : null,
    item.requestType ? { label: "Комментарий", value: item.requestMessage ?? "Без комментария" } : null,
    item.lessonUnits !== undefined ? { label: "Изменение баланса", value: `${item.lessonUnits < 0 ? "−" : "+"}${russianPlural(Math.abs(item.lessonUnits), "занятие", "занятия", "занятий")}` } : null,
  ].filter((detail): detail is { label: string; value: string } => Boolean(detail));
}
