"use client";

import { useState } from "react";
import { Bell, CalendarDays, Clock3, History, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/common/app-shell";
import { CollapsibleSection } from "@/components/common/collapsible-section";
import type { HistoryEvent, LessonRequest, Student } from "@/components/features/app/types";
import { HistoryPanel } from "@/components/features/history/history-panel";
import { Button } from "@/components/ui/button";
import { saveAppData } from "@/lib/app-data-client";

const filters = ["Все", "Отмена", "Перенос", "Новый урок"] as const;

function RequestsEmpty({ text }: { text: string }) {
  return <div className="grid min-h-36 place-items-center p-6 text-center text-slate-500"><div><CalendarDays className="mx-auto mb-3 size-7 text-slate-300" /><p>{text}</p></div></div>;
}

export function RequestsView({ requests, historyEvents, students, preferenceScope, onResolved, onReversePayment }: {
  requests: LessonRequest[];
  historyEvents: HistoryEvent[];
  students: Student[];
  preferenceScope: string;
  onResolved: () => Promise<void>;
  onReversePayment: (id: string) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("Все");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const visibleRequests = requests.filter((request) => filter === "Все" || filter === "Отмена" && request.kind === "cancel" || filter === "Перенос" && request.kind === "reschedule" || filter === "Новый урок" && request.kind === "new_lesson");

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

  return <AppShell title="Запросы" eyebrow={`${requests.length} требуют ответа`}>
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1">{filters.map((item) => <Button key={item} type="button" size="control" variant={filter === item ? "default" : "outline"} className="whitespace-nowrap" onClick={() => setFilter(item)}>{item}</Button>)}</div>
    <div className="grid gap-4">{visibleRequests.map((request, index) => <article key={request.id} className={`card p-5 md:p-6 ${request.kind === "cancel" ? "border-amber-300 bg-amber-50/40" : ""}`}><div className="flex flex-col gap-5 md:flex-row md:items-center"><span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${request.kind === "cancel" ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}>{request.kind === "cancel" ? <Bell className="size-5" /> : index === 1 ? <Clock3 className="size-5" /> : <Plus className="size-5" />}</span><div className="min-w-0 flex-1"><p className={`text-sm font-bold ${request.kind === "cancel" ? "text-amber-700" : "text-indigo-600"}`}>{request.type}</p><h2 className="mt-1 text-xl font-bold">{request.name}</h2><p className="mt-1 text-slate-600">{request.detail}</p><p className="mt-2 text-sm text-slate-500">{request.note}</p></div><div className="flex flex-col gap-2 sm:flex-row"><Button disabled={pendingId !== null} onClick={() => void resolve(request.id, "approved")}>{pendingId === request.id ? "Сохраняю…" : "Подтвердить"}</Button><Button disabled={pendingId !== null} onClick={() => void resolve(request.id, "declined")} variant="outline">Отклонить</Button></div></div></article>)}{visibleRequests.length === 0 && <RequestsEmpty text={requests.length === 0 ? "Все запросы обработаны" : "В этой категории запросов нет"} />}</div>
    <CollapsibleSection scope={preferenceScope} id="requests-history" title="История" description="Уроки, оплаты и запросы" icon={History} badge={<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{historyEvents.length}</span>} className="mt-6">
      <HistoryPanel events={historyEvents} students={students} onReversePayment={onReversePayment} />
    </CollapsibleSection>
  </AppShell>;
}
