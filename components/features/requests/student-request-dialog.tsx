"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { FormField } from "@/components/common/form-field";
import type { AvailableSlot, Lesson, Student, StudentRequestDraft } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dateTitle, moscowDate, moscowTime, shiftDate, today } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";

type StudentRequestDialogProps = {
  type: "cancel" | "reschedule" | "new_lesson";
  lesson?: Lesson;
  student: Student;
  availableSlots?: AvailableSlot[];
  onRequest: (body: StudentRequestDraft) => Promise<boolean>;
  fullWidth?: boolean;
};

export function StudentRequestDialog({ type, lesson, student, availableSlots, onRequest, fullWidth = false }: StudentRequestDialogProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(lesson?.date ?? shiftDate(today(), 1));
  const [time, setTime] = useState(lesson?.time ?? "17:00");
  const [lessonCount, setLessonCount] = useState<1 | 2>(1);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [expandedSlotDay, setExpandedSlotDay] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const cancellationExpired = type === "cancel" && Boolean(lesson && lesson.date <= today());
  const label = cancellationExpired ? "Срок отмены истёк" : type === "cancel" ? "Запросить отмену" : type === "reschedule" ? "Запросить перенос" : "Предложить время урока";
  const slotOnly = type === "new_lesson" && Boolean(availableSlots) && !student.floating;
  const visibleSlots = availableSlots?.filter((slot) => slot.maxUnits >= lessonCount) ?? [];
  const slotGroups = Object.entries(visibleSlots.reduce<Record<string, AvailableSlot[]>>((groups, slot) => { const day = moscowDate(slot.startsAt); (groups[day] ??= []).push(slot); return groups; }, {})).map(([day, slots]) => ({ day, slots }));
  const activeSlotDay = expandedSlotDay && slotGroups.some((group) => group.day === expandedSlotDay) ? expandedSlotDay : slotGroups[0]?.day ?? null;
  const chooseSlot = (slot: AvailableSlot) => { setSelectedSlot(slot.startsAt); setDate(moscowDate(slot.startsAt)); setTime(moscowTime(slot.startsAt)); };
  const submit = async () => {
    setPending(true);
    const saved = await onRequest({ requestType: type, lessonId: lesson?.id, proposedDate: type === "cancel" ? undefined : date, proposedTime: type === "cancel" ? undefined : time, lessonCount: type === "new_lesson" ? lessonCount : undefined, message, studentId: student.id });
    setPending(false);
    if (saved) setOpen(false);
  };

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setSelectedSlot(null); setExpandedSlotDay(null); } }}><DialogTrigger asChild><Button size="lg" disabled={cancellationExpired} variant={type === "cancel" ? "outline" : "default"} className={`${fullWidth ? "w-full" : ""} h-auto min-h-12 min-w-0 whitespace-normal rounded-xl px-4 text-center leading-snug ${type === "cancel" ? "" : "bg-indigo-600"}`}>{availableSlots ? "Выбрать свободное время" : label}</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{type === "cancel" ? "Преподаватель получит запрос. Своевременный запрос не будет списан, даже если останется без ответа." : availableSlots ? "Выберите свободное время. Оно появится в расписании только после подтверждения преподавателем." : "Предложите удобные дату и время. Урок появится в расписании после подтверждения преподавателем."}</DialogDescription></DialogHeader>
    {type === "new_lesson" && <><FormField label="Продолжительность"><Select value={String(lessonCount)} onValueChange={(value) => { setLessonCount(value === "2" ? 2 : 1); setSelectedSlot(null); setExpandedSlotDay(null); }}><SelectTrigger aria-label="Продолжительность урока" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Обычный урок · 1 час</SelectItem><SelectItem value="2">Двойной урок · 2 часа</SelectItem></SelectContent></Select></FormField>{lessonCount === 2 && <p className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-800">После подтверждения появится один двойной урок на два часа, а после проведения спишутся два занятия.</p>}{availableSlots && <FormField label="Свободные слоты"><div className="max-h-80 space-y-2 overflow-y-auto pr-1">{slotGroups.map((group) => <section key={group.day} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"><button type="button" aria-expanded={activeSlotDay === group.day} onClick={() => setExpandedSlotDay(group.day)} className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100 dark:bg-slate-800/70 dark:hover:bg-slate-800"><span><strong className="block capitalize">{dateTitle(group.day, { weekday: "long", day: "numeric", month: "long" })}</strong><span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{russianPlural(group.slots.length, "слот", "слота", "слотов")}</span></span><ChevronRight className={`size-4 shrink-0 text-slate-400 transition-transform ${activeSlotDay === group.day ? "rotate-90" : ""}`} /></button>{activeSlotDay === group.day && <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">{group.slots.map((slot) => <button key={slot.startsAt} type="button" onClick={() => chooseSlot(slot)} className={`rounded-xl border p-3 text-left text-sm transition ${selectedSlot === slot.startsAt ? "border-indigo-600 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-600 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-50 dark:ring-indigo-400" : "border-slate-200 hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-500"}`}><span>{moscowTime(slot.startsAt)}–{moscowTime(slot.startsAt + lessonCount * 60 * 60_000)}</span></button>)}</div>}</section>)}{!visibleSlots.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">Подходящих свободных слотов пока нет.</p>}</div></FormField>}</>}
    {type !== "cancel" && !slotOnly && <div className="grid gap-4 sm:grid-cols-2"><FormField label={availableSlots ? "Или другая дата" : "Дата"}><Input type="date" value={date} min={today()} onChange={(event) => { setDate(event.target.value); setSelectedSlot(null); }} /></FormField><FormField label="Время"><Input type="time" value={time} onChange={(event) => { setTime(event.target.value); setSelectedSlot(null); }} /></FormField></div>}
    <FormField label="Комментарий"><Input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Необязательно" /></FormField>
    <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button className="bg-indigo-600" disabled={pending || (type !== "cancel" && (!date || !time)) || (slotOnly && selectedSlot === null)} onClick={() => void submit()}>{pending ? "Отправляю…" : "Отправить запрос"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
