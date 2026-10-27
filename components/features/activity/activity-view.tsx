"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, History } from "lucide-react";

import { AppShell } from "@/components/common/app-shell";
import { CollapsibleSection } from "@/components/common/collapsible-section";
import { FilterChips } from "@/components/common/filter-chips";
import { ShowMoreButton } from "@/components/common/show-more-button";
import { MessagesDialog } from "@/components/features/account";
import type { AppNotification, HistoryEvent, LessonRequest, Student } from "@/components/features/app/types";
import { HistoryPanel } from "@/components/features/history/history-panel";
import { notificationActionLabel, notificationDetails } from "@/components/features/notifications/notification-details";
import { Button } from "@/components/ui/button";
import { russianPlural } from "@/lib/russian-plural";
import { activityFilters, useActivityActions } from "./use-activity-actions";

const INITIAL_NOTIFICATIONS = 5;
const requestKindLabels: Record<string, string> = { cancel: "Отмена", reschedule: "Перенос", new_lesson: "Новый урок" };
const timeLabel = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const dayLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });
const dateKey = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(value));

// Short time for the notification row: time today, "вчера", otherwise the date.
function shortMoment(value: number) {
  const now = Date.now();
  if (dateKey(value) === dateKey(now)) return timeLabel.format(new Date(value));
  if (dateKey(value) === dateKey(now - 86_400_000)) return "вчера";
  return dayLabel.format(new Date(value));
}

function RequestCard({ request, pendingId, onResolve }: { request: LessonRequest; pendingId: string | null; onResolve: (id: string, decision: "approved" | "declined") => void }) {
  const cancel = request.kind === "cancel";
  const comment = request.note && request.note !== "Без комментария" ? request.note : "";
  return <article id={`request-${request.id}`} tabIndex={-1} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4 outline-none transition focus-visible:ring-2 focus-visible:ring-brand-solid">
    <div className="flex items-center justify-between gap-2">
      <h3 className="min-w-0 truncate text-base font-bold">{request.name}</h3>
      <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold ${cancel ? "bg-warning-soft-strong text-warning-ink" : "bg-status-request text-status-request-ink"}`}>{requestKindLabels[request.kind] ?? request.type}</span>
    </div>
    <p className="text-sm text-ink-secondary">{request.detail}</p>
    {comment && <p className="rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink-muted">«{comment}»</p>}
    <div className="mt-1 grid grid-cols-2 gap-2 md:ml-auto md:w-80">
      <Button disabled={pendingId !== null} onClick={() => onResolve(request.id, "approved")}>{pendingId === request.id ? "Сохраняю…" : "Подтвердить"}</Button>
      <Button disabled={pendingId !== null} variant="outline" onClick={() => onResolve(request.id, "declined")}>Отклонить</Button>
    </div>
  </article>;
}

function NotificationRow({ item, expanded, last, onToggle, onOpen }: { item: AppNotification; expanded: boolean; last: boolean; onToggle: () => void; onOpen: () => void }) {
  const actionLabel = notificationActionLabel(item);
  const details = notificationDetails(item);
  return <div className={`${last ? "" : "border-b border-line"} ${item.read ? "" : "bg-brand-soft/40"}`}>
    <button type="button" aria-expanded={details.length > 0 ? expanded : undefined} onClick={onToggle} className="flex w-full items-start gap-3 px-4 pb-2 pt-3 text-left">
      <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-attention-dot"}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-[15px] ${item.read ? "font-medium" : "font-bold"}`}>{item.title}</span>
        <span className={`text-sm text-ink-muted ${expanded ? "" : "truncate"}`}>{item.body}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1"><time className="text-xs text-ink-subtle">{shortMoment(item.createdAt)}</time>{details.length > 0 && <ChevronDown aria-hidden className={`size-4 text-ink-subtle transition-transform ${expanded ? "rotate-180" : ""}`} />}</span>
    </button>
    {(actionLabel || details.length > 0) && <div className="px-4 pb-3 pl-9">
      {expanded && details.length > 0 && <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2">{details.map((detail) => <div key={detail.label} className="min-w-0"><dt className="text-xs font-semibold text-ink-subtle">{detail.label}</dt><dd className="text-sm font-medium [overflow-wrap:anywhere]">{detail.value}</dd></div>)}</dl>}
      {actionLabel ? <Button type="button" variant="outline" size="sm" onClick={onOpen}>{actionLabel}<ArrowRight /></Button> : !expanded && <button type="button" onClick={onToggle} className="text-sm font-semibold text-brand-text hover:underline">Подробнее</button>}
    </div>}
  </div>;
}

export function ActivityView({ requests, notifications, historyEvents, students, preferenceScope, onResolved, onReadNotifications, onReversePayment }: {
  requests: LessonRequest[];
  notifications: AppNotification[];
  historyEvents: HistoryEvent[];
  students: Student[];
  preferenceScope: string;
  onResolved: () => Promise<void>;
  onReadNotifications: (notificationId?: string) => Promise<void>;
  onReversePayment: (id: string) => Promise<boolean>;
}) {
  const { filter, setFilter, pendingId, messageStudentId, setMessageStudentId, visibleRequests, activityNotifications, resolve, openNotification, attentionCount } = useActivityActions({ requests, notifications, onResolved, onReadNotifications });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const unreadCount = activityNotifications.filter((item) => !item.read).length;
  const shownNotifications = showAll ? activityNotifications : activityNotifications.slice(0, INITIAL_NOTIFICATIONS);

  const toggleNotification = (item: AppNotification) => {
    setExpandedId((current) => current === item.id ? null : item.id);
    if (!item.read) void onReadNotifications(item.id);
  };

  return <AppShell title="События" eyebrow={russianPlural(attentionCount, "событие требует внимания", "события требуют внимания", "событий требуют внимания")}>
    <div className="flex max-w-3xl flex-col gap-3.5">
      <section aria-labelledby="activity-requests-title" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="activity-requests-title" className="text-lg font-bold">Запросы{requests.length > 0 ? ` · ${requests.length}` : ""}</h2>
          {requests.length > 0 && <span className="text-sm text-ink-muted">ждут ответа</span>}
        </div>
        <FilterChips label="Тип запроса" items={activityFilters.map((item) => ({ value: item, label: item }))} value={filter} onChange={setFilter} />
        {visibleRequests.map((request) => <RequestCard key={request.id} request={request} pendingId={pendingId} onResolve={(id, decision) => void resolve(id, decision)} />)}
        {visibleRequests.length === 0 && <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-muted"><CalendarDays className="size-5 shrink-0 text-ink-faint" />{requests.length === 0 ? "Все запросы обработаны" : "В этой категории запросов нет"}</div>}
      </section>

      <section aria-labelledby="activity-notifications-title" className="mt-2 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="activity-notifications-title" className="text-lg font-bold">Уведомления</h2>
          <button type="button" disabled={unreadCount === 0} onClick={() => void onReadNotifications()} className="text-sm font-semibold text-brand-text hover:underline disabled:cursor-default disabled:text-ink-faint disabled:no-underline">Прочитать все</button>
        </div>
        {activityNotifications.length === 0
          ? <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-muted"><CalendarDays className="size-5 shrink-0 text-ink-faint" />Новых уведомлений нет</div>
          : <div className="overflow-hidden rounded-2xl border border-line bg-surface">{shownNotifications.map((item, index) => <NotificationRow key={item.id} item={item} expanded={expandedId === item.id} last={index === shownNotifications.length - 1} onToggle={() => toggleNotification(item)} onOpen={() => openNotification(item)} />)}</div>}
        {activityNotifications.length > INITIAL_NOTIFICATIONS && <ShowMoreButton expanded={showAll} onToggle={() => setShowAll((value) => !value)} remaining={activityNotifications.length - INITIAL_NOTIFICATIONS} />}
      </section>

      <CollapsibleSection scope={preferenceScope} id="activity-history" title="История" description="Уроки, оплаты и запросы" icon={History} badge={<span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-secondary">{historyEvents.length}</span>} className="mt-2">
        <HistoryPanel events={historyEvents} students={students} onReversePayment={onReversePayment} />
      </CollapsibleSection>
    </div>
    <MessagesDialog initialPeerId={messageStudentId ?? undefined} open={Boolean(messageStudentId)} onOpenChange={(open) => { if (!open) setMessageStudentId(null); }} showTrigger={false} />
  </AppShell>;
}
