"use client";

import { useState, type ReactNode } from "react";
import { NotebookPen, Plus, Trash2, UserRound } from "lucide-react";
import { FormField } from "@/components/common/form-field";
import { SearchableSelect } from "@/components/common/searchable-select";
import { TimeField } from "@/components/common/time-field";
import type { Lesson, LessonDraft, Student } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { today } from "@/lib/date-time";

const studentItems = (students: Student[]) => students.map((student) => ({ value: student.id, label: student.name, description: student.archived ? "В архиве" : undefined }));

export function AddLessonDialog({ students, defaultDate, onAdd, compact = false, iconOnMobile = false, iconOnly = false }: { students: Student[]; defaultDate: string; onAdd: (lesson: LessonDraft) => Promise<boolean>; compact?: boolean; iconOnMobile?: boolean; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students.find((student) => !student.archived && student.trialEligible)?.id ?? students[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("17:00");
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");
  const [lessonCount, setLessonCount] = useState<1 | 2>(1);
  const [lessonType, setLessonType] = useState<"regular" | "trial">(() => students.length ? "regular" : "trial");
  const [trialTarget, setTrialTarget] = useState<"guest" | "student">("guest");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [pending, setPending] = useState(false);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDate(defaultDate < today() ? today() : defaultDate);
      setStudentId((current) => students.some((student) => student.id === current) ? current : (students[0]?.id ?? ""));
    }
  };
  const submit = async () => {
    setPending(true);
    const saved = await onAdd({ date, time, studentId: lessonType === "trial" && trialTarget === "guest" ? undefined : studentId, repeat, lessonCount, lessonType, trialGuestName: lessonType === "trial" && trialTarget === "guest" ? guestName.trim() : undefined, trialGuestEmail: guestEmail.trim() || undefined, trialGuestPhone: guestPhone.trim() || undefined, trialGuestNote: guestNote.trim() || undefined });
    setPending(false);
    if (saved) setOpen(false);
  };
  const trialStudents = students.filter((student) => !student.archived && student.trialEligible);
  const trigger = iconOnMobile || iconOnly
    ? <DialogTrigger asChild><Button disabled={!students.length && lessonType !== "trial"} aria-label="Добавить урок" className={`size-11 shrink-0 rounded-[var(--radius-control)] bg-brand-solid p-0 text-base hover:bg-brand-solid-hover ${iconOnly ? "" : "sm:w-auto sm:px-5"}`}><Plus className="size-5" /><span className={iconOnly ? "hidden" : "hidden sm:inline"}>Добавить урок</span></Button></DialogTrigger>
    : <DialogTrigger asChild><Button size={compact ? "default" : "lg"} disabled={!students.length && lessonType !== "trial"} className="h-11 rounded-xl bg-brand-solid px-5 text-base shadow-lg shadow-brand-glow hover:bg-brand-solid-hover"><Plus />Добавить урок</Button></DialogTrigger>;

  if (lessonType === "trial") return <Dialog open={open} onOpenChange={changeOpen}>{trigger}<LessonDialogFrame title="Пробное занятие" description="Бесплатное разовое занятие на один час." footer={<><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button className="bg-brand-solid" disabled={pending || !date || !time || trialTarget === "guest" && !guestName.trim() || trialTarget === "student" && !studentId} onClick={() => void submit()}>{pending ? "Сохраняю…" : "Сохранить пробное занятие"}</Button></>}>
    <FormField label="Тип занятия"><LessonTypeSelect value={lessonType} onChange={(value) => setLessonType(value)} /></FormField>
    <FormField label="Кому назначить"><Select value={trialTarget} onValueChange={(value) => setTrialTarget(value as "guest" | "student")}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="guest">Новому посетителю</SelectItem><SelectItem value="student" disabled={!trialStudents.length}>Существующему ученику без платных занятий</SelectItem></SelectContent></Select></FormField>
    {trialTarget === "guest" ? <><FormField label="Имя *"><Input value={guestName} onChange={(event) => setGuestName(event.target.value)} maxLength={80} placeholder="Имя посетителя" /></FormField><div className="grid gap-4 sm:grid-cols-2"><FormField label="Email"><Input value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} type="email" placeholder="Необязательно" /></FormField><FormField label="Телефон"><Input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="Необязательно" /></FormField></div><FormField label="Заметка"><Input value={guestNote} onChange={(event) => setGuestNote(event.target.value)} maxLength={300} placeholder="Необязательно" /></FormField></> : <StudentPicker students={trialStudents} value={studentId} onChange={setStudentId} />}
    <DateTimeFields date={date} time={time} onDateChange={setDate} onTimeChange={setTime} />
    <p className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-800">Посетитель не появится в списке учеников. После занятия его можно преобразовать в ученика из календаря.</p>
  </LessonDialogFrame></Dialog>;

  return <Dialog open={open} onOpenChange={changeOpen}>{trigger}<LessonDialogFrame title="Новый урок" description="Добавьте обычное или бесплатное пробное занятие." footer={<><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !studentId || !date || !time} onClick={() => void submit()} className="bg-brand-solid">{pending ? "Сохраняю…" : lessonCount === 2 ? "Сохранить двойной урок" : "Сохранить урок"}</Button></>}>
    <StudentPicker students={students} value={studentId} onChange={setStudentId} />
    <FormField label="Тип занятия"><LessonTypeSelect value={lessonType} onChange={(next) => { setLessonType(next); if (next === "trial") { setLessonCount(1); setRepeat("once"); } }} /></FormField>
    <DateTimeFields date={date} time={time} onDateChange={setDate} onTimeChange={setTime} />
    <FormField label="Продолжительность"><Select value={String(lessonCount)} onValueChange={(value) => setLessonCount(value === "2" ? 2 : 1)}><SelectTrigger aria-label="Продолжительность урока" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Обычный урок · 1 час</SelectItem><SelectItem value="2">Двойной урок · 2 часа</SelectItem></SelectContent></Select></FormField>
    <FormField label="Повторение"><Select value={repeat} onValueChange={(value) => setRepeat(value as "once" | "weekly")}><SelectTrigger aria-label="Повторение" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="once">Не повторять</SelectItem><SelectItem value="weekly">Каждую неделю</SelectItem></SelectContent></Select></FormField>
    {lessonCount === 2 && <p className="rounded-2xl bg-brand-soft p-4 text-sm text-brand-ink-strong">Будут созданы два связанных занятия подряд. Они переносятся и отменяются вместе, а после проведения с баланса списываются два занятия.</p>}
  </LessonDialogFrame></Dialog>;
}

function LessonDialogFrame({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer: ReactNode }) {
  return <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[22px] border-0 p-0 sm:max-w-xl"><DialogHeader className="border-b p-6 pr-14"><DialogTitle className="text-2xl">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="min-h-0 space-y-5 overflow-y-auto p-6">{children}</div><DialogFooter className="border-t bg-surface-subtle p-5">{footer}</DialogFooter></DialogContent>;
}

function StudentPicker({ students, value, onChange }: { students: Student[]; value: string; onChange: (value: string) => void }) {
  return <FormField label="Ученик"><SearchableSelect value={value} onValueChange={onChange} placeholder="Выберите ученика" searchPlaceholder="Найти ученика" emptyText="Ученики не найдены" items={studentItems(students)} /></FormField>;
}

function LessonTypeSelect({ value, onChange }: { value: "regular" | "trial"; onChange: (value: "regular" | "trial") => void }) {
  return <Select value={value} onValueChange={(next) => onChange(next as "regular" | "trial")}><SelectTrigger aria-label="Тип занятия" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Обычное занятие</SelectItem><SelectItem value="trial">Пробное занятие · бесплатно</SelectItem></SelectContent></Select>;
}

function DateTimeFields({ date, time, onDateChange, onTimeChange }: { date: string; time: string; onDateChange: (value: string) => void; onTimeChange: (value: string) => void }) {
  return <div className="grid min-w-0 gap-4 sm:grid-cols-2"><FormField label="Дата"><Input aria-label="Дата" type="date" min={today()} value={date} onChange={(event) => onDateChange(event.target.value)} className="mobile-date-input h-11 rounded-xl" /></FormField><FormField label="Время"><TimeField value={time} onChange={onTimeChange} /></FormField></div>;
}

export function EditLessonDialog({ lesson, onOpenChange, onUpdate, onDelete, onMaterials, onOpenStudent }: { lesson: Lesson | null; onOpenChange: (open: boolean) => void; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>; onMaterials: (lesson: Lesson) => void; onOpenStudent?: (studentId: string) => void }) {
  const [date, setDate] = useState(lesson?.date ?? today());
  const [time, setTime] = useState(lesson?.time ?? "17:00");
  const [pending, setPending] = useState(false);
  const update = async () => { if (!lesson) return; setPending(true); const saved = await onUpdate(lesson.id, date, time); setPending(false); if (saved) onOpenChange(false); };
  const remove = async () => { if (!lesson || !window.confirm(lesson.units === 2 ? "Отменить оба занятия без списания баланса?" : "Отменить урок без списания баланса?")) return; setPending(true); const saved = await onDelete(lesson.id); setPending(false); if (saved) onOpenChange(false); };
  return <Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">{lesson?.name}</DialogTitle><DialogDescription>{lesson?.units === 2 ? "Обе части двойного урока будут перенесены или отменены вместе." : "Перенесите урок, откройте материалы или отмените его без списания."}</DialogDescription></DialogHeader><div className="grid min-w-0 gap-4 sm:grid-cols-2"><FormField label="Новая дата"><Input className="mobile-date-input" type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} /></FormField><FormField label="Новое время"><TimeField value={time} onChange={setTime} /></FormField></div>{lesson && <div className={`grid gap-2 ${onOpenStudent ? "sm:grid-cols-2" : ""}`}><Button type="button" variant="outline" onClick={() => { onOpenChange(false); onMaterials(lesson); }}><NotebookPen />Материалы и домашка</Button>{onOpenStudent && <Button type="button" variant="outline" onClick={() => onOpenStudent(lesson.studentId)}><UserRound />Карточка ученика</Button>}</div>}<DialogFooter className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="w-full" disabled={pending} onClick={() => onOpenChange(false)}>Закрыть</Button><Button className="w-full bg-brand-solid" disabled={pending || !date || !time} onClick={() => void update()}>{lesson?.units === 2 ? "Перенести оба" : "Перенести"}</Button><Button className="w-full sm:col-span-2" variant="destructive" disabled={pending} onClick={() => void remove()}><Trash2 />{pending ? "Сохраняю…" : lesson?.units === 2 ? "Отменить оба без списания" : "Отменить без списания"}</Button></DialogFooter></DialogContent></Dialog>;
}
