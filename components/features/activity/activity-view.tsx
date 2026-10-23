"use client";

import { useState } from "react";
import { Bell, CalendarDays, Clock3, History, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/common/app-shell";
import { CollapsibleSection } from "@/components/common/collapsible-section";
import { MessagesDialog } from "@/components/features/account";
import type { AppNotification, HistoryEvent, LessonRequest, Student } from "@/components/features/app/types";
import { HistoryPanel } from "@/components/features/history/history-panel";
import { NotificationsPanel } from "@/components/features/notifications/notifications-panel";
import { Button } from "@/components/ui/button";
import { saveAppData } from "@/lib/app-data-client";
import { russianPlural } from "@/lib/russian-plural";
import { getActivityAttentionCount, getActivityNotifications } from "./activity-model";

const filters = ["Все", "Отмена", "Перенос", "Новый урок"] as const;

function RequestsEmpty({ text }: { text: string }) {
  return <div className="grid min-h-36 place-items-center p-6 text-center text-ink-muted"><div><CalendarDays className="mx-auto mb-3 size-7 text-ink-faint" /><p>{text}</p></div></div>;
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
  const [filter, setFilter] = useState<(typeof filters)[number]>("Все");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [messageStudentId, setMessageStudentId] = useState<string | null>(null);
  const visibleRequests = requests.filter((request) => filter === "Все" || filter === "Отмена" && request.kind === "cancel" || filter === "Перенос" && request.kind === "reschedule" || filter === "Новый урок" && request.kind === "new_lesson");
  const activityNotifications = getActivityNotifications(notifications);

  const resolve = async (id: string, decision: "approved" | "declined") => {
    setPendingId(id);
    try {
      const result = await saveAppData({ action: "resolveRequest", requestId: id, decision });
      await onResolved();
      if (result.expired) toast.info("Запрос уже неактуален и закрыт");
      else toast.success(decision === "approved" ? "Запрос подтверждён" : "Запрос отклонён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать запрос");
    } finally {
      setPendingId(null);
    }
  };

  const openNotification = (notification: AppNotification) => {
    if (!notification.read) void onReadNotifications(notification.id);
    if (notification.type === "direct_message" && notification.studentId) {
      setMessageStudentId(notification.studentId);
      return;
    }
    if (notification.type === "new_request" && notification.requestId) {
      setFilter("Все");
      window.requestAnimationFrame(() => {
        const requestCard = document.getElementById(`request-${notification.requestId}`);
        requestCard?.scrollIntoView({ behavior: "smooth", block: "center" });
        requestCard?.focus({ preventScroll: true });
      });
    }
  };

  const attentionCount = getActivityAttentionCount(requests, notifications);

  return <AppShell title="События" eyebrow={russianPlural(attentionCount, "событие требует внимания", "события требуют внимания", "событий требуют внимания")}>
    <section aria-labelledby="activity-requests-title">
      <div className="mb-5">
        <h2 id="activity-requests-title" className="text-xl font-bold">Требуют решения</h2>
        <p className="mt-1 text-sm text-ink-muted">Запросы учеников, на которые нужно ответить.</p>
      </div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">{filters.map((item) => <Button key={item} type="button" size="control" variant={filter === item ? "default" : "outline"} className="whitespace-nowrap" onClick={() => setFilter(item)}>{item}</Button>)}</div>
      <div className="grid gap-4">{visibleRequests.map((request, index) => <article id={`request-${request.id}`} tabIndex={-1} key={request.id} className={`card p-5 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500 md:p-6 ${request.kind === "cancel" ? "border-amber-300 bg-warning-soft-40" : ""}`}><div className="flex flex-col gap-5 md:flex-row md:items-center"><span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${request.kind === "cancel" ? "bg-warning-soft-strong text-warning-ink" : "bg-brand-soft text-brand-text"}`}>{request.kind === "cancel" ? <Bell className="size-5" /> : index === 1 ? <Clock3 className="size-5" /> : <Plus className="size-5" />}</span><div className="min-w-0 flex-1"><p className={`text-sm font-bold ${request.kind === "cancel" ? "text-warning-ink" : "text-brand-text"}`}>{request.type}</p><h3 className="mt-1 text-xl font-bold">{request.name}</h3><p className="mt-1 text-ink-secondary">{request.detail}</p><p className="mt-2 text-sm text-ink-muted">{request.note}</p></div><div className="flex flex-col gap-2 sm:flex-row"><Button disabled={pendingId !== null} onClick={() => void resolve(request.id, "approved")}>{pendingId === request.id ? "Сохраняю…" : "Подтвердить"}</Button><Button disabled={pendingId !== null} onClick={() => void resolve(request.id, "declined")} variant="outline">Отклонить</Button></div></div></article>)}{visibleRequests.length === 0 && <RequestsEmpty text={requests.length === 0 ? "Все запросы обработаны" : "В этой категории запросов нет"} />}</div>
    </section>

    <NotificationsPanel notifications={activityNotifications} onRead={onReadNotifications} onOpenNotification={openNotification} />

    <CollapsibleSection scope={preferenceScope} id="activity-history" title="История" description="Уроки, оплаты и запросы" icon={History} badge={<span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-secondary">{historyEvents.length}</span>} className="mt-6">
      <HistoryPanel events={historyEvents} students={students} onReversePayment={onReversePayment} />
    </CollapsibleSection>
    <MessagesDialog initialPeerId={messageStudentId ?? undefined} open={Boolean(messageStudentId)} onOpenChange={(open) => { if (!open) setMessageStudentId(null); }} showTrigger={false} />
  </AppShell>;
}
