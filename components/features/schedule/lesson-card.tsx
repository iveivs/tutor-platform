"use client";

import { NotebookPen, UserRound } from "lucide-react";
import type { Lesson } from "@/components/features/app/types";
import { LessonContentBadges } from "@/components/features/lessons/lesson-content-badges";
import { lessonStatusLabel, lessonStatusStyle } from "@/components/features/lessons/status-styles";
import { Button } from "@/components/ui/button";
import { dateTitle } from "@/lib/date-time";

export const lessonMeta = (lesson: Lesson) => lesson.lessonType === "trial" ? "Пробное занятие · бесплатно" : lesson.units === 2 ? "Двойной урок · 2 занятия" : "Барабаны · Студия";

export function LessonStatusChip({ lesson }: { lesson: Lesson }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${lessonStatusStyle(lesson)}`}>{lessonStatusLabel(lesson)}</span>;
}

// Lesson row of the v2 "Today" screen and calendar day: the card opens the manage dialog, materials have their own button.
export function LessonCard({ lesson, isNext = false, compact = false, showDate = false, onSelect, onMaterials, onConvertTrial }: { lesson: Lesson; isNext?: boolean; compact?: boolean; showDate?: boolean; onSelect?: (lesson: Lesson) => void; onMaterials?: (lesson: Lesson) => void; onConvertTrial?: (studentId: string) => Promise<boolean> }) {
  const selectable = Boolean(onSelect) && !lesson.past;
  return <article className={`grid grid-cols-[44px_minmax(0,1fr)] gap-2.5 ${compact ? "" : "md:grid-cols-[56px_minmax(0,1fr)]"} ${lesson.past ? "opacity-70" : ""}`}>
    <div className="pt-3 text-right">{showDate && <span className="block text-xs font-semibold text-brand-text">{dateTitle(lesson.date, { day: "numeric", month: "short" })}</span>}<span className="block text-[15px] font-bold leading-5">{lesson.time}</span><span className="block text-xs text-ink-muted">{lesson.end}</span></div>
    <div className={`flex min-w-0 items-start gap-2 rounded-[var(--radius-card)] border bg-surface p-3 transition md:items-center md:p-4 ${isNext ? "border-attention ring-1 ring-attention" : `border-line ${selectable ? "hover:border-brand-line" : ""}`}`}>
      <button type="button" disabled={!selectable} onClick={() => selectable && onSelect?.(lesson)} className={`min-w-0 flex-1 text-left ${selectable ? "" : "cursor-default"}`}>
        {isNext && <span className="mb-1.5 inline-flex rounded-md bg-attention px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Следующий</span>}
        <span data-no-translate className="block truncate text-base font-bold">{lesson.name}</span>
        <span className="block truncate text-sm text-ink-muted">{lessonMeta(lesson)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5"><LessonStatusChip lesson={lesson} /><LessonContentBadges lesson={lesson} className="contents" /></span>
      </button>
      {lesson.trialContact && onConvertTrial && <Button type="button" variant="outline" size="sm" aria-label="Создать ученика" className="shrink-0" onClick={() => void onConvertTrial(lesson.studentId)}><UserRound /><span className={compact ? "hidden" : "hidden sm:inline"}>Создать ученика</span></Button>}
      {onMaterials && <Button type="button" variant="outline" aria-label="Материалы урока" className={compact ? "size-10 shrink-0 p-0" : "size-10 shrink-0 p-0 md:h-9 md:w-auto md:px-3"} onClick={() => onMaterials(lesson)}><NotebookPen /><span className={compact ? "hidden" : "hidden md:inline"}>Материалы</span></Button>}
    </div>
  </article>;
}
