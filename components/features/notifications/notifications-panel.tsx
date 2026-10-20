"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { ShowMoreButton } from "@/components/common/show-more-button";
import type { AppNotification } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { russianPlural } from "@/lib/russian-plural";

const INITIAL_VISIBLE_COUNT = 3;

const requestTypes: Record<string, string> = { cancel: "Отмена урока", reschedule: "Перенос урока", new_lesson: "Новое занятие" };
const requestStatuses: Record<string, string> = { pending: "Ожидает решения", approved: "Подтверждён", declined: "Отклонён", expired: "Истёк" };
const formatMoment = (value: number) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
const formatLesson = (startsAt: number, endsAt?: number) => `${formatMoment(startsAt)}${endsAt ? `–${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(endsAt))}` : ""}`;

function NotificationsEmpty() {
  return (
    <div className="card flex min-h-48 flex-col items-center justify-center gap-3 text-center text-muted">
      <CalendarDays className="h-10 w-10" />
      <p className="text-lg">Новых уведомлений нет</p>
    </div>
  );
}

export function NotificationsPanel({
  notifications,
  onRead,
}: {
  notifications: AppNotification[];
  onRead: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const unreadIds = notifications.filter((item) => !item.read).map((item) => item.id);
  const visibleNotifications = expanded
    ? notifications
    : notifications.slice(0, INITIAL_VISIBLE_COUNT);

  return (
    <section className="mt-6" aria-labelledby="activity-notifications-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="activity-notifications-title" className="text-xl font-semibold text-foreground">
            Уведомления
          </h2>
          <p className="mt-1 text-sm text-muted">
            {russianPlural(unreadIds.length, "непрочитанное", "непрочитанных", "непрочитанных")}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={unreadIds.length === 0}
          onClick={() => void onRead()}
        >
          Отметить всё прочитанным
        </Button>
      </div>

      {notifications.length === 0 ? (
        <NotificationsEmpty />
      ) : (
        <div className="grid gap-4">
          {visibleNotifications.map((item) => {
            const details = [
              item.studentName ? { label: "Ученик", value: item.studentName } : null,
              item.requestType ? { label: "Запрос", value: requestTypes[item.requestType] ?? item.requestType } : null,
              item.requestStatus ? { label: "Статус", value: requestStatuses[item.requestStatus] ?? item.requestStatus } : null,
              item.lessonStartsAt ? { label: "Урок", value: formatLesson(item.lessonStartsAt, item.lessonEndsAt) } : null,
              item.proposedStartsAt ? { label: item.requestType === "reschedule" ? "Предложенное время" : "Время занятия", value: formatLesson(item.proposedStartsAt, item.proposedEndsAt) } : null,
              item.requestType ? { label: "Комментарий", value: item.requestMessage ?? "Без комментария" } : null,
              item.lessonUnits !== undefined ? { label: "Изменение баланса", value: `${item.lessonUnits < 0 ? "−" : "+"}${russianPlural(Math.abs(item.lessonUnits), "занятие", "занятия", "занятий")}` } : null,
            ].filter((detail): detail is { label: string; value: string } => Boolean(detail));

            return <article key={item.id} className={`card p-5 md:p-6 ${item.read ? "opacity-70" : "border-indigo-200 bg-indigo-50/40 dark:border-indigo-700 dark:bg-indigo-950/40"}`}><div className="flex gap-4"><span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${item.read ? "bg-slate-300" : "bg-indigo-600"}`} /><div className="min-w-0 flex-1"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-lg font-bold">{item.title}</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.body}</p></div><time className="shrink-0 text-xs text-slate-400">{formatMoment(item.createdAt)}</time></div>{details.length > 0 && <dl className="mt-4 grid gap-x-8 gap-y-3 rounded-2xl border border-slate-200/80 bg-white/70 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/70">{details.map((detail) => <div key={detail.label} className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{detail.label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">{detail.value}</dd></div>)}</dl>}</div></div></article>;
          })}
        </div>
      )}

      {notifications.length > INITIAL_VISIBLE_COUNT && (
        <ShowMoreButton
          className="mt-3"
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          remaining={notifications.length - INITIAL_VISIBLE_COUNT}
        />
      )}
    </section>
  );
}
