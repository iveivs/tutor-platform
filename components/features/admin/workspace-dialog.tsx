"use client";

import { FormEvent, useState, type ReactNode } from "react";
import { Ban, CheckCircle2, CreditCard, Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { extendAccess } from "@/lib/workspace-access";
import {
  accessState, auditText, chipText, formatBytes, formatDate, formatDateTime, grantLabel, isoOf, methodLabel, rubles, stateChip, todayIso,
  type AdminAuditEvent, type AdminPayment, type AdminWorkspace,
} from "./admin-model";

export type AdminPost = (body: Record<string, unknown>, success: string) => Promise<boolean>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-2"><h3 className="px-1 text-[13px] font-bold uppercase tracking-wide text-ink-muted">{title}</h3>{children}</section>;
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-0.5 rounded-2xl border border-line bg-surface px-3.5 py-3"><span className="text-xs font-semibold text-ink-muted">{label}</span><span className="text-base font-bold">{value}</span></div>;
}

function PaymentForm({ workspace, priceCents, onPost, onDone }: { workspace: AdminWorkspace; priceCents: number | null; onPost: AdminPost; onDone: () => void }) {
  const [amount, setAmount] = useState(priceCents ? String(priceCents / 100) : "");
  const [months, setMonths] = useState("1");
  const [paidOn, setPaidOn] = useState(todayIso);
  const [method, setMethod] = useState<AdminPayment["method"]>("transfer");
  const [receiptRef, setReceiptRef] = useState("");
  const [pending, setPending] = useState(false);
  const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
  const valid = Number.isFinite(amountCents) && amountCents >= 0 && amount.trim() !== "";
  const until = extendAccess(workspace.accessExpiresAt, Number(months)).until;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const ok = await onPost({ action: "addSubscriptionPayment", workspaceId: workspace.id, amountCents, months: Number(months), paidOn, method, receiptRef: receiptRef.trim() }, "Платёж сохранён, доступ продлён");
    setPending(false);
    if (ok) onDone();
  };
  return <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-coral bg-surface p-4">
    <div className="grid grid-cols-2 gap-3">
      <FormField label="Сумма, ₽"><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-11 rounded-xl" required /></FormField>
      <FormField label="Период"><Select value={months} onValueChange={setMonths}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 6, 12].map((count) => <SelectItem key={count} value={String(count)}>{count === 1 ? "1 месяц" : count < 5 ? `${count} месяца` : `${count} месяцев`}</SelectItem>)}</SelectContent></Select></FormField>
      <FormField label="Дата оплаты"><Input type="date" value={paidOn} max={todayIso()} onChange={(event) => setPaidOn(event.target.value)} className="h-11 rounded-xl" required /></FormField>
      <FormField label="Способ"><Select value={method} onValueChange={(value) => setMethod(value as AdminPayment["method"])}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{(["transfer", "cash", "other"] as const).map((value) => <SelectItem key={value} value={value}>{methodLabel[value]}</SelectItem>)}</SelectContent></Select></FormField>
    </div>
    <FormField label="Номер чека в «Мой налог» (необязательно)"><Input value={receiptRef} maxLength={100} onChange={(event) => setReceiptRef(event.target.value)} className="h-11 rounded-xl" /></FormField>
    <p className="rounded-xl bg-success-soft px-3 py-2.5 text-[13px] font-semibold text-success-ink">{`Доступ продлится до ${formatDate(until.getTime())}`}</p>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || !valid} className="h-11 rounded-xl bg-brand-solid hover:bg-brand-solid-hover">{pending ? "Сохраняю…" : "Сохранить платёж"}</Button><Button type="button" variant="outline" className="h-11 rounded-xl" onClick={onDone}>Отмена</Button></div>
  </form>;
}

// cancelUnlimited: ends the «Бессрочный» plan; by default free access for 7 more days, then view-only.
function TermsForm({ workspace, isOwnWorkspace, cancelUnlimited = false, onPost, onDone }: { workspace: AdminWorkspace; isOwnWorkspace: boolean; cancelUnlimited?: boolean; onPost: AdminPost; onDone: () => void }) {
  const [grant, setGrant] = useState<AdminWorkspace["accessGrant"]>(cancelUnlimited ? "complimentary" : workspace.accessGrant);
  const [limited, setLimited] = useState(cancelUnlimited || Boolean(workspace.accessExpiresAt));
  const [until, setUntil] = useState(() => workspace.accessExpiresAt ? isoOf(workspace.accessExpiresAt) : isoOf(Date.now() + (cancelUnlimited ? 7 * 86400000 : 0)));
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const ok = await onPost({ action: "setAccessTerms", workspaceId: workspace.id, accessGrant: grant, accessUntil: limited && grant !== "unlimited" ? until : null }, cancelUnlimited ? "Бессрочный тариф отменён" : "Доступ изменён");
    setPending(false);
    if (ok) onDone();
  };
  return <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-coral bg-surface p-4">
    {cancelUnlimited && <p className="text-[13px] text-ink-muted">Отмена бессрочного тарифа: выберите, какой доступ будет дальше. С датой окончания после неё кабинет перейдёт в режим просмотра, а преподаватель получит напоминания за 7, 3 и 1 день.</p>}
    <FormField label={cancelUnlimited ? "Новый тип доступа" : "Тип доступа"}><Select value={grant} onValueChange={(value) => setGrant(value as AdminWorkspace["accessGrant"])}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{(cancelUnlimited ? ["complimentary", "trial", "paid", "legacy"] as const : ["unlimited", "trial", "paid", "complimentary", "legacy"] as const).map((value) => <SelectItem key={value} value={value}>{grantLabel[value]}</SelectItem>)}</SelectContent></Select></FormField>
    {grant === "unlimited" ? <p className="rounded-xl bg-brand-soft px-3 py-2.5 text-[13px] text-brand-ink">Бессрочный тариф: без даты окончания, назначается только вручную и не продаётся. Напоминаний о сроке не будет.</p> : <label className="flex items-center gap-2.5 text-[15px]"><input type="checkbox" className="size-5 accent-[var(--color-brand-solid)]" checked={limited} disabled={isOwnWorkspace} onChange={(event) => setLimited(event.target.checked)} />Ограничить по сроку</label>}
    {limited && grant !== "unlimited" && <FormField label="Доступ до (включительно)"><Input type="date" value={until} onChange={(event) => setUntil(event.target.value)} className="h-11 rounded-xl" required /></FormField>}
    {grant !== "unlimited" && <p className="text-[13px] text-ink-muted">{limited ? "После этой даты кабинет перейдёт в режим просмотра. За 7, 3 и 1 день преподаватель получит напоминание." : "Без срока кабинет работает без ограничений, пока вы не поставите дату."}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || limited && grant !== "unlimited" && !until} className="h-11 rounded-xl bg-brand-solid hover:bg-brand-solid-hover">{pending ? "Сохраняю…" : cancelUnlimited ? "Отменить бессрочный тариф" : "Сохранить"}</Button><Button type="button" variant="outline" className="h-11 rounded-xl" onClick={onDone}>{cancelUnlimited ? "Не отменять" : "Отмена"}</Button></div>
  </form>;
}

type WorkspaceDialogProps = {
  workspace: AdminWorkspace | null; payments: AdminPayment[]; audit: AdminAuditEvent[]; priceCents: number | null; isOwnWorkspace: boolean;
  onOpenChange: (open: boolean) => void; onPost: AdminPost; onToggleBlock: (workspace: AdminWorkspace) => void; deleteControl: ReactNode;
};

// Admin card of one teacher workspace: access, manual payments, journal, private note, blocking.
export function WorkspaceDialog({ workspace, payments, audit, priceCents, isOwnWorkspace, onOpenChange, onPost, onToggleBlock, deleteControl }: WorkspaceDialogProps) {
  const [form, setForm] = useState<"payment" | "terms" | "cancel" | null>(null);
  const [note, setNote] = useState(workspace?.adminNote ?? "");
  const [notePending, setNotePending] = useState(false);
  if (!workspace) return null;
  const state = accessState(workspace);
  const ownPayments = payments.filter((payment) => payment.workspaceId === workspace.id);
  const ownAudit = audit.filter((event) => event.workspaceId === workspace.id).slice(0, 20);
  const headline = workspace.accessExpiresAt
    ? state === "read_only" ? `Доступ закончился ${formatDate(workspace.accessExpiresAt)} · только просмотр` : `${grantLabel[workspace.accessGrant]} до ${formatDate(workspace.accessExpiresAt)}`
    : `${grantLabel[workspace.accessGrant]} · без срока`;
  const saveNote = async () => {
    setNotePending(true);
    await onPost({ action: "setAdminNote", workspaceId: workspace.id, note }, "Заметка сохранена");
    setNotePending(false);
  };
  const refund = async (payment: AdminPayment) => {
    if (!window.confirm(`Отметить возврат ${rubles(payment.amountCents)}? Срок доступа не изменится — при необходимости поправьте его через «Изменить доступ».`)) return;
    await onPost({ action: "refundSubscriptionPayment", paymentId: payment.id }, "Возврат отмечен");
  };

  return <Dialog open onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-3xl sm:max-w-xl">
      <DialogHeader className="pr-10 text-left">
        <DialogTitle className="text-2xl" data-no-translate>{workspace.ownerName}</DialogTitle>
        <DialogDescription data-no-translate>{[workspace.ownerTitle, workspace.ownerEmail].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3"><span className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">Доступ</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${stateChip[state].className}`}>{chipText(workspace, state)}</span></div>
          <strong className="text-lg">{headline}</strong>
          {!form && <div className="grid grid-cols-2 gap-2">
            {workspace.accessGrant === "unlimited"
              ? <Button type="button" variant="outline" className="h-11 rounded-xl text-danger-text hover:bg-danger-soft hover:text-danger-ink" onClick={() => setForm("cancel")}><XCircle />Отменить бессрочный</Button>
              : <Button type="button" className="h-11 rounded-xl bg-brand-solid hover:bg-brand-solid-hover" disabled={workspace.accessStatus === "blocked"} onClick={() => setForm("payment")}><CreditCard />Внести платёж</Button>}
            <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => setForm("terms")}><Pencil />Изменить доступ</Button>
          </div>}
        </section>
        {form === "payment" && <PaymentForm workspace={workspace} priceCents={priceCents} onPost={onPost} onDone={() => setForm(null)} />}
        {form === "terms" && <TermsForm workspace={workspace} isOwnWorkspace={isOwnWorkspace} onPost={onPost} onDone={() => setForm(null)} />}
        {form === "cancel" && <TermsForm workspace={workspace} isOwnWorkspace={isOwnWorkspace} cancelUnlimited onPost={onPost} onDone={() => setForm(null)} />}

        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="Учеников" value={workspace.groupCount ? `${workspace.studentCount} · групп: ${workspace.groupCount}` : String(workspace.studentCount)} />
          <Tile label="Последний вход" value={formatDateTime(workspace.lastActivityAt)} />
          <Tile label="Файлы" value={formatBytes(workspace.storageBytes)} />
          <Tile label="В Тьюттори с" value={formatDate(workspace.createdAt)} />
        </div>

        <Section title="Платежи">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {ownPayments.length ? ownPayments.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 px-4 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line">
              <span className="flex min-w-0 flex-col gap-0.5"><span className="text-[15px] font-semibold">{`${formatDate(Date.parse(`${payment.paidOn}T12:00:00Z`))} · ${methodLabel[payment.method]}`}</span><span className="text-[13px] text-ink-muted">{payment.status === "refunded" ? "Возврат отмечен" : `${payment.months} мес., доступ до ${formatDate(payment.accessUntil)}${payment.receiptRef ? ` · чек ${payment.receiptRef}` : ""}`}</span></span>
              <span className="flex shrink-0 flex-col items-end gap-1"><span className={`text-[15px] font-bold ${payment.status === "refunded" ? "text-ink-muted line-through" : ""}`}>{rubles(payment.amountCents)}</span>{payment.status === "paid" && <button type="button" className="text-xs font-semibold text-danger-text hover:underline" onClick={() => void refund(payment)}>Возврат</button>}</span>
            </div>) : <p className="px-4 py-4 text-center text-sm text-ink-muted">Платежей пока нет</p>}
          </div>
        </Section>

        <Section title="Журнал">
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-muted">
            {ownAudit.length ? ownAudit.map((event) => <span key={event.id}>{`${formatDate(event.createdAt)} · ${auditText(event)}`}</span>) : <span>Действий пока нет</span>}
          </div>
        </Section>

        <Section title="Заметка админа">
          <Textarea value={note} maxLength={2000} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="Например: платит переводом, обычно 10-го числа" className="rounded-xl" />
          {note !== workspace.adminNote && <Button type="button" variant="outline" className="self-start rounded-xl" disabled={notePending} onClick={() => void saveNote()}>{notePending ? "Сохраняю…" : "Сохранить заметку"}</Button>}
        </Section>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" disabled={isOwnWorkspace && workspace.accessStatus === "active"} onClick={() => onToggleBlock(workspace)} className={workspace.accessStatus === "active" ? "text-danger-text hover:bg-danger-soft hover:text-danger-ink" : ""}>{workspace.accessStatus === "active" ? <><Ban />Приостановить доступ</> : <><CheckCircle2 />Восстановить доступ</>}</Button>
          {workspace.accessStatus === "blocked" && !isOwnWorkspace && deleteControl}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
