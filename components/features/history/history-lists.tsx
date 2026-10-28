"use client";

import { useState } from "react";
import { Bell, CalendarDays, WalletCards } from "lucide-react";

import { AppCard } from "@/components/common/app-card";
import type { BalanceEntry, HistoryEvent } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { dateTitle } from "@/lib/date-time";
import { formatMoney } from "@/lib/money";

function HistoryEmpty() {
  return <div className="grid min-h-36 place-items-center p-6 text-center text-muted-foreground"><div><CalendarDays className="mx-auto mb-3 size-7 opacity-40" /><p>История пока пуста</p></div></div>;
}

function ReversePaymentButton({ paymentId, onReverse }: { paymentId: string; onReverse: (id: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const reverse = async () => {
    setPending(true);
    const saved = await onReverse(paymentId);
    setPending(false);
    if (saved) setOpen(false);
  };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">Отменить оплату</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle>Отменить ошибочную оплату?</DialogTitle><DialogDescription>Исходная запись останется в истории. Будет создана обратная операция, а баланс ученика уменьшится на то же количество занятий.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button variant="destructive" disabled={pending} onClick={() => void reverse()}>{pending ? "Отменяю…" : "Отменить оплату"}</Button></DialogFooter></DialogContent></Dialog>;
}

export function HistoryTimeline({ events, showStudent = true, onReversePayment }: { events: HistoryEvent[]; showStudent?: boolean; onReversePayment?: (id: string) => Promise<boolean> }) {
  const colors = { lesson: "bg-brand-soft text-brand-ink", payment: "bg-success-soft text-success-ink", request: "bg-warning-soft text-warning-ink" };
  const labels = { lesson: "Урок", payment: "Баланс", request: "Запрос" };
  const Icons = { lesson: CalendarDays, payment: WalletCards, request: Bell };
  const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  return <AppCard padding="none" className="divide-y overflow-hidden">{events.map((event) => { const Icon = Icons[event.category]; return <article key={event.id} className="flex gap-4 p-5 md:p-6"><span className={`grid size-11 shrink-0 place-items-center rounded-xl ${colors[event.category]}`}><Icon className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"><div><span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${colors[event.category]}`}>{labels[event.category]}</span><strong>{event.title}</strong></div><time className="shrink-0 text-xs text-ink-subtle">{dateTime.format(new Date(event.occurredAt))}</time></div>{showStudent && <p className="mt-1 font-medium text-ink-body">{event.studentName}</p>}{event.detail && <p className="mt-1 text-sm text-ink-muted">{event.detail}</p>}{event.actor && <p className="mt-2 text-xs text-ink-subtle">Кто: {event.actor}</p>}{event.canReverse && event.sourceId && onReversePayment && <div className="mt-3"><ReversePaymentButton paymentId={event.sourceId} onReverse={onReversePayment} /></div>}</div></article>; })}{!events.length && <HistoryEmpty />}</AppCard>;
}

export function BalanceHistory({ entries, onReversePayment, currency }: { entries: BalanceEntry[]; onReversePayment?: (id: string) => Promise<boolean>; currency?: string | null }) {
  return <AppCard padding="none" className="divide-y overflow-hidden">{entries.map((entry) => <div key={entry.id} className="flex items-center gap-4 p-5"><span className={`grid size-11 place-items-center rounded-xl font-bold ${entry.units > 0 ? "bg-success-soft text-success-ink" : "bg-danger-soft text-danger-ink"}`}>{entry.units > 0 ? "+" : ""}{entry.units}</span><span className="min-w-0 flex-1"><strong className="block">{entry.note}{entry.reversed ? " · отменена" : ""}</strong><span className="text-sm text-ink-muted">{dateTitle(entry.date, { day: "numeric", month: "long", year: "numeric" })}</span>{entry.kind === "payment" && !entry.reversed && onReversePayment && <span className="mt-2 block"><ReversePaymentButton paymentId={entry.id} onReverse={onReversePayment} /></span>}</span>{entry.amountCents !== undefined && entry.kind === "payment" && <strong className={`shrink-0 text-right ${entry.reversed ? "text-ink-subtle line-through" : ""}`}>{formatMoney(entry.amountCents, currency)}</strong>}</div>)}{!entries.length && <HistoryEmpty />}</AppCard>;
}
