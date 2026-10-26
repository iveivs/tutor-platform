"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, StickyNote } from "lucide-react";
import { AppShell } from "@/components/common/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import type { Lesson, LessonDraft, Student, TeacherDayNote } from "@/components/features/app/types";
import { LessonContentBadges } from "@/components/features/lessons/lesson-content-badges";
import { lessonStatusStyle } from "@/components/features/lessons/status-styles";
import { LessonCard, LessonStatusChip } from "@/components/features/schedule/lesson-card";
import { AddLessonDialog, EditLessonDialog } from "@/components/features/schedule/lesson-dialogs";
import { TeacherDayNotePanel } from "@/components/features/schedule/teacher-day-note-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { preferenceKey, readPreference, writePreference } from "@/lib/client-preferences";
import { dateAtNoon, dateTitle, shiftDate, shiftMonth, toIsoDate } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";
import { useCurrentDay } from "@/hooks/use-current-day";

type Mode = "day" | "week" | "month";
type CalendarViewProps = { preferenceScope: string; lessons: Lesson[]; students: Student[]; dayNotes: TeacherDayNote[]; onSaveDayNote: (date: string, body: string) => Promise<boolean>; showPastLessons: boolean; pastLessonsLoading: boolean; onShowPastLessonsChange: (show: boolean) => Promise<void>; onAdd: (lesson: LessonDraft) => Promise<boolean>; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>; onMaterials: (lesson: Lesson) => void; onConvertTrial: (id: string) => Promise<boolean>; onOpenStudent: (id: string) => void };

const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const unitsLabel = (lessons: Lesson[]) => russianPlural(lessons.reduce((sum, lesson) => sum + lesson.units, 0), "занятие", "занятия", "занятий");

// Redesign v2 of the calendar. Same data and actions as CalendarView; the month grid only has the weeks the month needs.
export function CalendarView({ preferenceScope, lessons, students, dayNotes, onSaveDayNote, showPastLessons, pastLessonsLoading, onShowPastLessonsChange, onAdd, onUpdate, onDelete, onMaterials, onConvertTrial, onOpenStudent }: CalendarViewProps) {
  const currentDay = useCurrentDay();
  const [mode, setMode] = useState<Mode>(() => {
    const savedMode = readPreference(preferenceKey(preferenceScope, "calendar-mode"));
    return savedMode === "day" || savedMode === "week" || savedMode === "month" ? savedMode : "month";
  });
  const previousDay = useRef(currentDay);
  const [cursor, setCursor] = useState(currentDay);
  const [selectedDay, setSelectedDay] = useState(currentDay);
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lesson | null>(null);
  useEffect(() => {
    if (cursor === previousDay.current) setCursor(currentDay);
    if (selectedDay === previousDay.current) setSelectedDay(currentDay);
    previousDay.current = currentDay;
  }, [currentDay, cursor, selectedDay]);
  const changeMode = (nextMode: Mode) => { setMode(nextMode); writePreference(preferenceKey(preferenceScope, "calendar-mode"), nextMode); };

  const cursorDate = dateAtNoon(cursor);
  const monthStart = new Date(Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth(), 1, 12));
  const leadingDays = (monthStart.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() + 1, 0, 12)).getUTCDate();
  const gridStart = shiftDate(toIsoDate(monthStart), -leadingDays);
  const monthDays = Array.from({ length: Math.ceil((leadingDays + daysInMonth) / 7) * 7 }, (_, index) => shiftDate(gridStart, index));
  const weekStart = shiftDate(cursor, -((cursorDate.getUTCDay() + 6) % 7));
  const visibleDates = mode === "day" ? [cursor] : Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const move = (direction: number) => setCursor((date) => mode === "day" ? shiftDate(date, direction) : mode === "week" ? shiftDate(date, direction * 7) : shiftMonth(date, direction));
  const goToday = () => { setCursor(currentDay); setSelectedDay(currentDay); };
  const title = mode === "month" ? dateTitle(cursor, { month: "long", year: "numeric" }) : mode === "week" ? `${dateTitle(visibleDates[0])} — ${dateTitle(visibleDates[6], { day: "numeric", month: "long", year: "numeric" })}` : dateTitle(cursor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const visibleLessons = showPastLessons ? lessons : lessons.filter((lesson) => !lesson.past);
  const lessonsOn = (date: string) => visibleLessons.filter((lesson) => lesson.date === date);
  const noteOn = (date: string) => dayNotes.find((note) => note.date === date);
  const dayPanelProps = { students, onAdd, onSaveDayNote, onSelect: setEditing, onMaterials, onConvertTrial };

  return <AppShell actionsInline title="Календарь" actions={<AddLessonDialog iconOnMobile students={students} defaultDate={mode === "month" ? selectedDay : cursor} onAdd={onAdd} />}>
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
          <div role="tablist" aria-label="Режим календаря" className="grid grid-cols-3 gap-0.5 rounded-[var(--radius-control)] bg-surface-muted p-1 md:w-80">
            {(["day", "week", "month"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => changeMode(item)} className={`h-9 rounded-[calc(var(--radius-control)-2px)] text-sm transition ${mode === item ? "bg-surface font-semibold text-ink-strong shadow-sm" : "text-ink-muted hover:text-ink-strong"}`}>{item === "day" ? "День" : item === "week" ? "Неделя" : "Месяц"}</button>)}
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 px-1 text-sm font-medium text-ink-secondary md:justify-start"><span>{pastLessonsLoading ? "Загружаю прошедшие…" : "Показывать прошедшие уроки"}</span><Switch checked={showPastLessons} disabled={pastLessonsLoading} onCheckedChange={(checked) => void onShowPastLessonsChange(checked)} aria-label="Показывать прошедшие уроки" /></label>
        </div>
        <div className="flex items-center justify-between gap-2 md:justify-end">
          <Button type="button" variant="outline" size="icon" aria-label="Назад" onClick={() => move(-1)}><ChevronLeft /></Button>
          <button type="button" onClick={goToday} className="min-w-0 flex-1 truncate px-2 text-center text-base font-bold md:min-w-48 md:flex-none">{capitalize(title)}</button>
          <Button type="button" variant="outline" size="icon" aria-label="Вперёд" onClick={() => move(1)}><ChevronRight /></Button>
        </div>
      </div>

      {mode === "month"
        ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <MonthGrid dates={monthDays} cursor={cursor} currentDay={currentDay} selectedDay={selectedDay} lessonsOn={lessonsOn} noteOn={noteOn} onSelect={setSelectedDay} />
          <section aria-label="Выбранный день" className="space-y-3 xl:rounded-[var(--radius-card)] xl:border xl:border-line xl:bg-surface xl:p-4">
            <DayPanel date={selectedDay} lessons={lessonsOn(selectedDay)} note={noteOn(selectedDay)} {...dayPanelProps} />
          </section>
        </div>
        : <ScheduleColumns dates={visibleDates} currentDay={currentDay} lessonsOn={lessonsOn} noteOn={noteOn} onSelectDate={setDialogDate} onSelectLesson={setEditing} />}
    </div>

    <Dialog open={dialogDate !== null} onOpenChange={(open) => !open && setDialogDate(null)}><DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-2xl"><DialogHeader className="border-b p-5 pr-14 sm:p-6"><DialogTitle className="text-2xl capitalize">{dialogDate && dateTitle(dialogDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</DialogTitle><DialogDescription>{dialogDate ? unitsLabel(lessonsOn(dialogDate)) : ""}</DialogDescription></DialogHeader><div className="min-h-0 overflow-y-auto p-4 sm:p-6">{dialogDate && <DayPanel date={dialogDate} lessons={lessonsOn(dialogDate)} note={noteOn(dialogDate)} {...dayPanelProps} onSelect={(lesson) => { setDialogDate(null); setEditing(lesson); }} hideHeader />}</div><DialogFooter className="border-t bg-background p-4 sm:p-5"><DialogClose asChild><Button variant="outline">Закрыть</Button></DialogClose>{dialogDate && <AddLessonDialog students={students} defaultDate={dialogDate} onAdd={onAdd} compact />}</DialogFooter></DialogContent></Dialog>
    <EditLessonDialog key={editing?.id ?? "no-lesson"} lesson={editing} onOpenChange={(open) => !open && setEditing(null)} onUpdate={onUpdate} onDelete={onDelete} onMaterials={onMaterials} onOpenStudent={(studentId) => { setEditing(null); onOpenStudent(studentId); }} />
  </AppShell>;
}

function DayPanel({ date, lessons, note, students, onAdd, onSaveDayNote, onSelect, onMaterials, onConvertTrial, hideHeader = false }: { date: string; lessons: Lesson[]; note?: TeacherDayNote; students: Student[]; onAdd: (lesson: LessonDraft) => Promise<boolean>; onSaveDayNote: (date: string, body: string) => Promise<boolean>; onSelect: (lesson: Lesson) => void; onMaterials: (lesson: Lesson) => void; onConvertTrial: (id: string) => Promise<boolean>; hideHeader?: boolean }) {
  return <>
    {!hideHeader && <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-lg font-bold">{capitalize(dateTitle(date, { weekday: "long", day: "numeric", month: "long" }))}</h2><p className="text-sm text-ink-muted">{unitsLabel(lessons)}{lessons.length > 0 && ` · ${lessons[0].time}–${lessons[lessons.length - 1].end}`}</p></div>
      <AddLessonDialog iconOnly students={students} defaultDate={date} onAdd={onAdd} />
    </div>}
    <div className="flex flex-wrap items-center gap-2"><TeacherDayNotePanel compact key={`${date}:${note?.id ?? "new"}`} date={date} note={note} onSave={onSaveDayNote} /></div>
    {lessons.length ? <div className="space-y-2.5">{lessons.map((lesson) => <LessonCard key={lesson.id} compact lesson={lesson} onSelect={onSelect} onMaterials={onMaterials} onConvertTrial={onConvertTrial} />)}</div> : <EmptyState text="На этот день уроков нет" />}
  </>;
}

function MonthGrid({ dates, cursor, currentDay, selectedDay, lessonsOn, noteOn, onSelect }: { dates: string[]; cursor: string; currentDay: string; selectedDay: string; lessonsOn: (date: string) => Lesson[]; noteOn: (date: string) => TeacherDayNote | undefined; onSelect: (date: string) => void }) {
  const month = cursor.slice(0, 7);
  return <section aria-label="Месяц" className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
    <div className="grid grid-cols-7 border-b border-line">{weekdayLabels.map((day, index) => <div key={day} className={`py-2.5 text-center text-xs font-semibold text-ink-muted md:text-sm ${index > 4 ? "calendar-weekend-header" : ""}`}>{day}</div>)}</div>
    <div className="grid grid-cols-7">
      {dates.map((date) => {
        const dayLessons = lessonsOn(date);
        const currentMonth = date.startsWith(month);
        const weekend = [0, 6].includes(dateAtNoon(date).getUTCDay());
        const selected = date === selectedDay;
        const today = date === currentDay;
        return <button key={date} type="button" aria-pressed={selected} aria-label={`${dateTitle(date, { weekday: "long", day: "numeric", month: "long" })}, ${russianPlural(dayLessons.length, "урок", "урока", "уроков")}`} onClick={() => onSelect(date)} className={`relative flex min-h-16 flex-col items-center gap-1 border-b border-r border-line p-1.5 text-left transition md:min-h-28 md:items-stretch md:p-2 ${selected ? "bg-brand-soft shadow-[inset_0_0_0_2px_var(--brand-solid)]" : weekend ? "calendar-weekend hover:bg-surface-subtle" : "calendar-weekday hover:bg-surface-subtle"}`}>
          <span className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold md:self-start ${today ? "bg-brand-solid text-white" : currentMonth ? weekend ? "calendar-weekend-date" : "text-ink-body" : "text-ink-faint"}`}>{Number(date.slice(-2))}</span>
          {noteOn(date) && <StickyNote className="absolute right-0.5 top-0.5 size-3 text-warning-text md:right-1.5 md:top-1.5 md:size-3.5" aria-label="Есть личная заметка" />}
          {dayLessons.length > 0 && <span className={`calendar-lesson-count grid size-5 place-items-center rounded-full text-[11px] font-bold md:hidden ${date < currentDay ? "calendar-lesson-count-past" : "calendar-lesson-count-upcoming"}`}>{dayLessons.length}</span>}
          <span className="hidden w-full space-y-1 md:block">{dayLessons.slice(0, 2).map((lesson) => <span key={lesson.id} className={`flex items-center justify-between gap-1 overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${lessonStatusStyle(lesson)}`}><span data-no-translate className="truncate">{lesson.time} {lesson.name.split(" ")[0]}</span>{lesson.units === 2 && <span className="font-bold">×2</span>}</span>)}</span>
          {dayLessons.length > 2 && <span className="hidden text-[11px] font-medium text-ink-muted md:block">ещё {dayLessons.length - 2}</span>}
        </button>;
      })}
    </div>
  </section>;
}

function ScheduleColumns({ dates, currentDay, lessonsOn, noteOn, onSelectDate, onSelectLesson }: { dates: string[]; currentDay: string; lessonsOn: (date: string) => Lesson[]; noteOn: (date: string) => TeacherDayNote | undefined; onSelectDate: (date: string) => void; onSelectLesson: (lesson: Lesson) => void }) {
  return <div className={`overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface ${dates.length === 1 ? "" : "divide-y divide-line md:grid md:grid-cols-7 md:divide-x md:divide-y-0"}`}>{dates.map((date) => {
    const dayLessons = lessonsOn(date);
    const weekend = [0, 6].includes(dateAtNoon(date).getUTCDay());
    return <section key={date} className={`p-3 md:min-h-64 ${weekend ? "calendar-weekend" : ""}`}>
      <button type="button" onClick={() => onSelectDate(date)} className="mb-2 w-full rounded-[var(--radius-control)] p-2 text-center transition hover:bg-surface-subtle md:mb-3">
        <span className="block text-xs uppercase text-ink-muted">{dateTitle(date, { weekday: "short" })}</span>
        <strong className={date === currentDay ? "text-brand-text" : weekend ? "calendar-weekend-date" : ""}>{dateTitle(date)}</strong>
        {noteOn(date) && <span className="mt-1 flex items-center justify-center gap-1 text-xs font-medium text-warning-text"><StickyNote className="size-3" />Заметка</span>}
      </button>
      <div className="space-y-2">{dayLessons.map((lesson) => <button key={lesson.id} type="button" disabled={lesson.past} onClick={() => !lesson.past && onSelectLesson(lesson)} className={`w-full rounded-[var(--radius-control)] border border-line bg-surface p-3 text-left text-sm transition ${lesson.units === 2 ? "min-h-28" : ""} ${lesson.past ? "cursor-default opacity-70" : "hover:border-brand-line"}`}>
        <strong className="block">{lesson.time}–{lesson.end}</strong>
        <span data-no-translate className="block truncate">{lesson.name}</span>
        {lesson.units === 2 && <span className="mt-0.5 block text-xs text-ink-muted">Двойной урок · 2 часа</span>}
        <span className="mt-2 flex flex-wrap items-center gap-1.5"><LessonStatusChip lesson={lesson} /><LessonContentBadges lesson={lesson} compact className="contents" /></span>
      </button>)}{!dayLessons.length && <p className="py-2 text-center text-xs text-ink-subtle md:py-8">Нет уроков</p>}</div>
    </section>;
  })}</div>;
}
