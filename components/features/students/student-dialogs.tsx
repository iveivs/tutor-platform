"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Minus, Pencil, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/common/form-field";
import { TimeField } from "@/components/common/time-field";
import type { RecurringSlot, Student, StudentDraft } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { saveAppData } from "@/lib/app-data-client";
import { shiftDate, today } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";

export function StudentArchiveActions({ student, onRestore, onDeletePermanently }: { student: Student; onRestore: (id: string) => Promise<boolean>; onDeletePermanently: (id: string) => Promise<boolean> }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const restore = async () => { setPending(true); await onRestore(student.id); setPending(false); };
  const remove = async () => { setPending(true); const deleted = await onDeletePermanently(student.id); setPending(false); if (deleted) setDeleteOpen(false); };
  return <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row"><Button variant="outline" disabled={pending} onClick={() => void restore()}>Восстановить ученика</Button><Dialog open={deleteOpen} onOpenChange={(next) => { setDeleteOpen(next); if (!next) setConfirmation(""); }}><DialogTrigger asChild><Button variant="destructive">Удалить навсегда</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Окончательно удалить ученика?</DialogTitle><DialogDescription>Будут безвозвратно удалены уроки, оплаты, запросы, уведомления и история ученика. Для подтверждения введите его имя полностью.</DialogDescription></DialogHeader><FormField label={`Введите: ${student.name}`}><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></FormField><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setDeleteOpen(false)}>Отмена</Button><Button variant="destructive" disabled={pending || confirmation.trim() !== student.name} onClick={() => void remove()}>{pending ? "Удаляю…" : "Удалить безвозвратно"}</Button></DialogFooter></DialogContent></Dialog></div>;
}

export function StopSeriesDialog({ slot, onStop }: { slot: RecurringSlot; onStop: (id: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [pending, setPending] = useState(false);
  const stop = async () => { setPending(true); const saved = await onStop(slot.id); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">Остановить</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle>Остановить постоянное занятие?</DialogTitle><DialogDescription>{slot.label}. Все будущие уроки этого времени будут отменены без списания. Уже проведённые занятия сохранятся в истории.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button variant="destructive" disabled={pending} onClick={() => void stop()}>{pending ? "Останавливаю…" : "Остановить расписание"}</Button></DialogFooter></DialogContent></Dialog>;
}

export function EditStudentDialog({ student, onUpdate }: { student: Student; onUpdate: (student: Pick<Student, "id" | "name" | "email" | "canViewAvailability">) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [firstName, ...surnameParts] = student.name.split(/\s+/);
  const [name, setName] = useState(firstName ?? "");
  const [surname, setSurname] = useState(surnameParts.join(" "));
  const [email, setEmail] = useState(student.email ?? "");
  const [canViewAvailability, setCanViewAvailability] = useState(student.canViewAvailability);
  const [pending, setPending] = useState(false);
  const changeOpen = (next: boolean) => { setOpen(next); if (next) { const [first, ...rest] = student.name.split(/\s+/); setName(first ?? ""); setSurname(rest.join(" ")); setEmail(student.email ?? ""); setCanViewAvailability(student.canViewAvailability); } };
  const submit = async () => {
    setPending(true);
    const saved = await onUpdate({ id: student.id, name: [name.trim(), surname.trim()].filter(Boolean).join(" "), email: email.trim() || undefined, canViewAvailability });
    setPending(false);
    if (saved) setOpen(false);
  };
  const archive = async () => {
    setPending(true);
    try {
      await saveAppData({ action: "archiveStudent", studentId: student.id });
      toast.success("Ученик перемещён в архив");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось архивировать ученика");
      setPending(false);
    }
  };
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button variant="outline" className="h-11 rounded-xl"><Pencil />Изменить данные</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Данные ученика</DialogTitle><DialogDescription>Имя обязательно. Email нужен только для личного кабинета ученика.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><FormField label="Имя *"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></FormField><FormField label="Фамилия"><Input value={surname} onChange={(event) => setSurname(event.target.value)} maxLength={80} /></FormField></div><FormField label="Email"><Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Необязательно" readOnly={student.accountStatus === "active"} /></FormField>{student.accountStatus === "active" && <p className="text-sm text-ink-muted">Email уже связан со входом ученика и здесь не изменяется.</p>}<label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-4"><Checkbox checked={canViewAvailability} onCheckedChange={(checked) => setCanViewAvailability(checked === true)} /><span><strong className="block">Показывать свободные слоты</strong><span className="mt-1 block text-sm text-ink-muted">Ученик сможет видеть рабочие свободные часы и отправлять запрос на выбранное время.</span></span></label><div className="rounded-2xl border border-warning-ring bg-warning-soft p-4"><strong className="block text-warning-ink">Архив</strong><p className="mt-1 text-sm text-warning-ink">Будущие уроки будут отменены, а история и оплаты сохранятся. Ученика можно восстановить.</p><Button variant="outline" className="mt-3 border-warning-ring bg-surface text-warning-ink hover:bg-warning-soft-strong hover:text-warning-ink dark:bg-surface" disabled={pending} onClick={() => void archive()}>Переместить в архив</Button></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button className="bg-brand-solid" disabled={pending || !name.trim()} onClick={() => void submit()}>{pending ? "Сохраняю…" : "Сохранить"}</Button></DialogFooter></DialogContent></Dialog>;
}

export function InviteStudentDialog({ student, onCreateInvite }: { student: Student; onCreateInvite: (id: string) => Promise<string> }) {
  const [open, setOpen] = useState(false); const [url, setUrl] = useState(""); const [pending, setPending] = useState(false);
  const active = student.accountStatus === "active";
  const prepare = async () => { setOpen(true); setPending(true); setUrl(""); try { setUrl(active ? window.location.origin : await onCreateInvite(student.id)); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось подготовить ссылку"); setOpen(false); } finally { setPending(false); } };
  const copy = async () => { await navigator.clipboard.writeText(url); toast.success("Ссылка скопирована — отправьте её ученику"); };
  const share = async () => { if (navigator.share) await navigator.share({ title: active ? `Кабинет ученика — ${student.name}` : `Приглашение для ${student.name}`, text: active ? "Ссылка для входа в кабинет ученика:" : "Войдите в кабинет ученика по ссылке:", url }); else await copy(); };
  return <Dialog open={open} onOpenChange={setOpen}><Button variant="outline" className="h-11 rounded-xl" onClick={() => void prepare()}><Send />{active ? "Отправить ссылку на кабинет" : "Пригласить ученика"}</Button><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>{active ? `Кабинет ученика — ${student.name}` : `Пригласить ${student.name}`}</DialogTitle><DialogDescription>{active ? "Отправьте ученику ссылку на вход. Он войдёт с уже созданными email и паролем." : "Отправьте эту персональную ссылку ученику в Telegram, WhatsApp, почте или другом удобном месте. По ней ученик задаст пароль и войдёт в свой кабинет."}</DialogDescription></DialogHeader>{pending ? <p className="rounded-2xl bg-surface-subtle p-4 text-ink-muted">Готовим ссылку…</p> : <><FormField label={active ? "Ссылка на кабинет" : "Персональная ссылка"}><Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></FormField><p className="text-sm text-ink-muted">{active ? "Это обычная ссылка на вход, она не меняет пароль и не создаёт новое приглашение." : "Ссылка действует 14 дней. Создание новой ссылки отключит предыдущую."}</p></>}<DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Закрыть</Button><Button variant="outline" disabled={!url} onClick={() => void copy()}><Copy />Скопировать ссылку</Button><Button disabled={!url} className="bg-brand-solid" onClick={() => void share()}><Send />Отправить</Button></DialogFooter></DialogContent></Dialog>;
}

export function AddStudentSheet({ onAdd }: { onAdd: (student: StudentDraft) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [email, setEmail] = useState(""); const [floating, setFloating] = useState("floating"); const [weekday, setWeekday] = useState("2"); const [time, setTime] = useState("17:00"); const [pending, setPending] = useState(false);
  const submit = async () => {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    if (!name) return;
    setPending(true);
    const saved = await onAdd({ name, email: email.trim() || undefined, floating: floating === "floating", weekday: floating === "fixed" ? Number(weekday) : undefined, time: floating === "fixed" ? time : undefined });
    setPending(false);
    if (saved) { setOpen(false); setFirstName(""); setLastName(""); setEmail(""); setFloating("floating"); setWeekday("2"); setTime("17:00"); }
  };
  const fixed = floating === "fixed";
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button size="lg" className="h-11 rounded-xl bg-brand-solid"><Plus />Добавить ученика</Button></SheetTrigger><SheetContent className="w-full gap-0 sm:max-w-lg"><SheetHeader className="border-b p-6"><SheetTitle className="text-2xl">Новый ученик</SheetTitle><SheetDescription>Создайте карточку ученика для расписания и учёта оплат.</SheetDescription></SheetHeader><div className="flex-1 space-y-5 overflow-y-auto p-6"><FormField label="Имя *"><Input aria-label="Имя" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Имя ученика" required className="h-11 rounded-xl" /></FormField><FormField label="Фамилия"><Input aria-label="Фамилия" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Необязательно" className="h-11 rounded-xl" /></FormField><FormField label="Email"><Input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Необязательно" className="h-11 rounded-xl" /></FormField><FormField label="Тип расписания"><Select value={floating} onValueChange={setFloating}><SelectTrigger aria-label="Тип расписания" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Постоянное</SelectItem><SelectItem value="floating">Плавающее</SelectItem></SelectContent></Select></FormField>{fixed && <div className="grid gap-4 sm:grid-cols-2"><FormField label="День недели"><Select value={weekday} onValueChange={setWeekday}><SelectTrigger aria-label="День недели" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{[[1, "Понедельник"], [2, "Вторник"], [3, "Среда"], [4, "Четверг"], [5, "Пятница"], [6, "Суббота"], [7, "Воскресенье"]].map(([value, label]) => <SelectItem key={value} value={String(value)}>{label}</SelectItem>)}</SelectContent></Select></FormField><FormField label="Время"><TimeField value={time} onChange={setTime} /></FormField></div>}<div className="rounded-2xl bg-brand-soft p-4 text-sm text-brand-ink-strong">Email нужен только для личного кабинета ученика. Расписание, занятия и оплаты можно вести без него.</div></div><SheetFooter className="border-t p-5"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={!firstName.trim() || pending || (fixed && (!weekday || !time))} onClick={() => void submit()} className="bg-brand-solid">{pending ? "Создаю…" : "Создать ученика"}</Button></SheetFooter></SheetContent></Sheet>;
}

export function PaymentDialog({ student, onPay, triggerLabel = "Добавить оплату" }: { student: Student; onPay: (id: string, count: number, date: string) => Promise<boolean>; triggerLabel?: string }) {
  const [open, setOpen] = useState(false); const [count, setCount] = useState(1); const [paymentDate, setPaymentDate] = useState(today); const [pending, setPending] = useState(false);
  const submit = async () => { setPending(true); const saved = await onPay(student.id, count, paymentDate); setPending(false); if (saved) setOpen(false); };
  const currentDay = today();
  const changeOpen = (next: boolean) => { setOpen(next); if (next) { setCount(1); setPaymentDate(today()); } };
  const changeCount = (value: number) => setCount(Math.max(1, Math.min(100, Number.isFinite(value) ? value : 1)));
  const moveDate = (days: number) => setPaymentDate((current) => { const next = shiftDate(current || currentDay, days); return next > currentDay ? currentDay : next; });
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button size="lg" className="h-11 rounded-xl bg-brand-solid"><Plus />{triggerLabel}</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">Добавить оплату</DialogTitle><DialogDescription>{student.name}</DialogDescription></DialogHeader><div className={`rounded-2xl p-4 font-semibold ${student.balance < 0 ? "bg-danger-soft text-danger-ink" : "bg-surface-subtle text-ink-body"}`}>Текущий баланс: {russianPlural(student.balance, "занятие", "занятия", "занятий")}</div><FormField label="Количество занятий"><div className="flex items-center justify-center gap-2"><Button type="button" size="icon-control" variant="outline" aria-label="Уменьшить количество занятий" disabled={count <= 1} onClick={() => changeCount(count - 1)}><Minus /></Button><Input aria-label="Количество занятий" type="number" min="1" max="100" value={count} onChange={(event) => changeCount(Number(event.target.value))} className="h-11 w-24 rounded-xl text-center" /><Button type="button" size="icon-control" variant="outline" aria-label="Увеличить количество занятий" disabled={count >= 100} onClick={() => changeCount(count + 1)}><Plus /></Button></div></FormField><FormField label="Дата оплаты"><div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2"><Button type="button" size="icon-control" variant="outline" aria-label="Предыдущий день" onClick={() => moveDate(-1)}><ChevronLeft /></Button><Input aria-label="Дата оплаты" type="date" max={currentDay} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="h-11 min-w-0 rounded-xl" /><Button type="button" size="icon-control" variant="outline" aria-label="Следующий день" disabled={!paymentDate || paymentDate >= currentDay} onClick={() => moveDate(1)}><ChevronRight /></Button></div><Button type="button" size="sm" variant="ghost" className="mt-2" disabled={paymentDate === currentDay} onClick={() => setPaymentDate(currentDay)}>Сегодня</Button></FormField><div className="rounded-2xl bg-success-soft p-4 text-success-ink-strong">После оплаты баланс составит <strong>{russianPlural(student.balance + count, "занятие", "занятия", "занятий")}</strong></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !Number.isInteger(count) || count < 1 || !paymentDate || paymentDate > currentDay} onClick={() => void submit()} className="bg-brand-solid">{pending ? "Сохраняю…" : "Добавить оплату"}</Button></DialogFooter></DialogContent></Dialog>;
}

export function BalanceAdjustmentDialog({ student, onAdjust }: { student: Student; onAdjust: (id: string, units: number, note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [units, setUnits] = useState(0); const [note, setNote] = useState(""); const [pending, setPending] = useState(false);
  const submit = async () => { setPending(true); const saved = await onAdjust(student.id, units, note.trim()); setPending(false); if (saved) setOpen(false); };
  const changeOpen = (next: boolean) => { setOpen(next); if (next) { setUnits(0); setNote(""); } };
  const changeUnits = (value: number) => setUnits(Math.max(-100, Math.min(100, value)));
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button size="lg" variant="outline" className="h-11 rounded-xl"><Minus />Корректировать баланс</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">Корректировка баланса</DialogTitle><DialogDescription>{student.name}. Используйте отрицательное число для долга и положительное — для добавления занятий без оплаты.</DialogDescription></DialogHeader><div className={`rounded-2xl p-4 font-semibold ${student.balance < 0 ? "bg-danger-soft text-danger-ink" : "bg-surface-subtle text-ink-body"}`}>Текущий баланс: {russianPlural(student.balance, "занятие", "занятия", "занятий")}</div><FormField label="Изменение"><div className="flex items-center justify-center gap-2"><Button type="button" size="icon-control" variant="outline" aria-label="Уменьшить баланс" onClick={() => changeUnits(units - 1)}><Minus /></Button><Input aria-label="Изменение баланса" type="number" min="-100" max="100" value={units} onChange={(event) => changeUnits(Number(event.target.value))} className="h-11 w-24 rounded-xl text-center" /><Button type="button" size="icon-control" variant="outline" aria-label="Увеличить баланс" onClick={() => changeUnits(units + 1)}><Plus /></Button></div></FormField><FormField label="Причина"><Input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="Например: перенос остатка или исправление" /></FormField><div className={`rounded-2xl p-4 ${student.balance + units < 0 ? "bg-danger-soft text-danger-ink-strong" : "bg-success-soft text-success-ink-strong"}`}>После корректировки баланс составит <strong>{russianPlural(student.balance + units, "занятие", "занятия", "занятий")}</strong></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !Number.isInteger(units) || units === 0 || units < -100 || units > 100 || note.trim().length < 3} onClick={() => void submit()} className="bg-brand-solid">{pending ? "Сохраняю…" : "Сохранить корректировку"}</Button></DialogFooter></DialogContent></Dialog>;
}

