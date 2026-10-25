"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Clock3, UserRound } from "lucide-react";
import { AppShell } from "@/components/common/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import type { Lesson, LessonDraft, LessonRequest, Student, TeacherDayNote, View } from "@/components/features/app/types";
import { LessonCardV2 } from "@/components/features/schedule/lesson-card-v2";
import { AddLessonDialog, EditLessonDialog } from "@/components/features/schedule/lesson-dialogs";
import { TeacherDayNotePanel } from "@/components/features/schedule/schedule-views";
import { Button } from "@/components/ui/button";
import { dateAtNoon, dateTitle, shiftDate } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";
import { useCurrentDay } from "@/hooks/use-current-day";

type TodayViewProps = { lessons: Lesson[]; students: Student[]; requests: LessonRequest[]; dayNotes: TeacherDayNote[]; onSaveDayNote: (date: string, body: string) => Promise<boolean>; onAdd: (lesson: LessonDraft) => Promise<boolean>; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>; onMaterials: (lesson: Lesson) => void; setView: (view: View) => void; onOpenStudent: (id: string) => void };

const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const weekStart = (date: string) => shiftDate(date, -((dateAtNoon(date).getUTCDay() + 6) % 7));

// Redesign v2 of the "Today" screen. Same data and actions as TodayView, different presentation.
export function TodayViewV2({ lessons, students, requests, dayNotes, onSaveDayNote, onAdd, onUpdate, onDelete, onMaterials, setView, onOpenStudent }: TodayViewProps) {
  const currentDay = useCurrentDay();
  const previousDay = useRef(currentDay);
  const [selectedDate, setSelectedDate] = useState(currentDay);
  const [editing, setEditing] = useState<Lesson | null>(null);
  useEffect(() => {
    if (selectedDate === previousDay.current) setSelectedDate(currentDay);
    previousDay.current = currentDay;
  }, [currentDay, selectedDate]);

  const selectedLessons = lessons.filter((lesson) => lesson.date === selectedDate);
  const lessonDates = new Set(lessons.map((lesson) => lesson.date));
  const monday = weekStart(selectedDate);
  const week = weekdayLabels.map((label, index) => ({ label, date: shiftDate(monday, index) }));
  const debtCount = students.filter((student) => student.balance < 0).length;
  const withoutLessonCount = students.filter((student) => student.next === "Не назначен").length;
  const nowTime = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" });
  const nextLesson = lessons.filter((lesson) => `${lesson.date}T${lesson.time}` >= `${currentDay}T${nowTime}`).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  const relative = selectedDate === currentDay ? "Сегодня" : selectedDate === shiftDate(currentDay, 1) ? "Завтра" : selectedDate === shiftDate(currentDay, -1) ? "Вчера" : "Расписание";
  const units = selectedLessons.reduce((sum, lesson) => sum + lesson.units, 0);
  const dayNote = dayNotes.find((note) => note.date === selectedDate);

  const weekday = dateTitle(selectedDate, { weekday: "long" });
  return <AppShell actionsInline eyebrow={weekday.charAt(0).toUpperCase() + weekday.slice(1)} title={`${relative}, ${dateTitle(selectedDate)}`} actions={<AddLessonDialog iconOnMobile students={students} defaultDate={selectedDate} onAdd={onAdd} />}>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <section aria-label="Неделя" className="flex items-center gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-1.5">
          <Button type="button" variant="ghost" size="icon" aria-label="Предыдущая неделя" onClick={() => setSelectedDate((date) => shiftDate(date, -7))}><ChevronLeft /></Button>
          <div className="grid min-w-0 flex-1 grid-cols-7 gap-0.5">
            {week.map(({ label, date }) => {
              const selected = date === selectedDate;
              const past = date < currentDay;
              return <button key={date} type="button" aria-pressed={selected} aria-label={dateTitle(date, { weekday: "long", day: "numeric", month: "long" })} onClick={() => setSelectedDate(date)} className={`flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] transition ${selected ? "bg-brand-solid text-white" : past ? "text-ink-muted hover:bg-surface-subtle" : "text-ink-strong hover:bg-surface-subtle"}`}>
                <span className="text-xs font-medium">{label}</span>
                <span className={`text-base ${date === currentDay ? "font-extrabold" : "font-semibold"}`}>{dateAtNoon(date).getUTCDate()}</span>
                <span className={`size-1.5 rounded-full ${lessonDates.has(date) ? selected ? "bg-white" : "bg-[var(--calendar-lesson-upcoming)]" : "bg-transparent"}`} />
              </button>;
            })}
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Следующая неделя" onClick={() => setSelectedDate((date) => shiftDate(date, 7))}><ChevronRight /></Button>
        </section>
        {selectedDate !== currentDay && <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setSelectedDate(currentDay)}>Сегодня</Button>}

        <section aria-label="Расписание на день" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">{russianPlural(units, "занятие", "занятия", "занятий")}{selectedLessons.length > 0 && ` · ${selectedLessons[0].time}–${selectedLessons[selectedLessons.length - 1].end}`}</p>
            <div className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" className="hidden text-brand-text md:inline-flex" onClick={() => setView("calendar")}>Открыть календарь</Button><TeacherDayNotePanel compact key={`${selectedDate}:${dayNote?.id ?? "new"}`} date={selectedDate} note={dayNote} onSave={onSaveDayNote} /></div>
          </div>
          {selectedLessons.length ? selectedLessons.map((lesson) => <LessonCardV2 key={lesson.id} lesson={lesson} isNext={lesson.id === nextLesson?.id} onSelect={setEditing} onMaterials={onMaterials} />) : <EmptyState text="На этот день уроков нет" />}
        </section>
      </div>

      <aside className="space-y-4">
        <section aria-label="Требуют внимания" className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <h2 className="px-4 pb-1 pt-3.5 text-base font-bold">Требуют внимания</h2>
          {requests.length > 0 && <AttentionRow icon={Bell} tone="request" title={russianPlural(requests.length, "запрос", "запроса", "запросов")} text={requests.length % 10 === 1 && requests.length % 100 !== 11 ? "ждёт решения" : "ждут решения"} onClick={() => setView("activity")} />}
          {debtCount > 0 && <AttentionRow icon={UserRound} tone="debt" title={russianPlural(debtCount, "ученик", "ученика", "учеников")} text="с задолженностью" onClick={() => setView("students")} />}
          {withoutLessonCount > 0 && <AttentionRow icon={Clock3} tone="unpaid" title={russianPlural(withoutLessonCount, "ученик", "ученика", "учеников")} text="без следующего урока" onClick={() => setView("students")} />}
          {requests.length === 0 && debtCount === 0 && withoutLessonCount === 0 ? <p className="px-4 pb-4 pt-1 text-sm text-ink-muted">Всё в порядке — ничего срочного.</p> : <div className="h-1.5" />}
        </section>
        <section aria-label="Ближайший урок" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-hero-start p-4 text-white">
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-hero-muted">Ближайший урок</p>{nextLesson ? <><p className="mt-0.5 truncate text-lg font-bold"><span data-no-translate>{nextLesson.name}</span> · {nextLesson.time}</p><p className="text-sm text-hero-muted">{dateTitle(nextLesson.date, { weekday: "long", day: "numeric", month: "long" })}</p></> : <p className="mt-0.5 text-sm text-hero-muted">Будущих уроков пока нет</p>}</div>
          {nextLesson && <button type="button" onClick={() => onOpenStudent(nextLesson.studentId)} className="w-full rounded-[var(--radius-control)] bg-white/15 px-3 py-2.5 text-sm font-semibold hover:bg-white/20 sm:w-auto sm:shrink-0 xl:w-full">Открыть карточку</button>}
        </section>
      </aside>
    </div>
    <EditLessonDialog key={editing?.id ?? "today-no-lesson"} lesson={editing} onOpenChange={(open) => !open && setEditing(null)} onUpdate={onUpdate} onDelete={onDelete} onMaterials={onMaterials} onOpenStudent={(studentId) => { setEditing(null); onOpenStudent(studentId); }} />
  </AppShell>;
}

function AttentionRow({ icon: Icon, tone, title, text, onClick }: { icon: typeof Bell; tone: "request" | "debt" | "unpaid"; title: string; text: string; onClick: () => void }) {
  const toneClass = { request: "bg-status-request text-status-request-ink", debt: "bg-status-debt text-status-debt-ink", unpaid: "bg-status-unpaid text-status-unpaid-ink" }[tone];
  return <button type="button" onClick={onClick} className="flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-surface-subtle"><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${toneClass}`}><Icon className="size-4" /></span><span className="min-w-0 flex-1 text-sm"><span className="font-bold">{title}</span> <span className="text-ink-muted">{text}</span></span><ChevronRight className="size-4 shrink-0 text-ink-subtle" /></button>;
}
