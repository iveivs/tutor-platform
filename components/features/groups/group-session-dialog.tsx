"use client";

import { useState } from "react";
import { CalendarClock, NotebookPen, Trash2, UserX } from "lucide-react";
import { FormField } from "@/components/common/form-field";
import type { Lesson } from "@/components/features/app/types";
import { useGroupActions } from "@/components/features/groups/group-actions";
import { lessonStatusLabel, lessonStatusStyle } from "@/components/features/lessons/status-styles";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { dateTitle } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";

// Manage one group session: who comes, cancel for one member or for everyone, move the whole session.
export function GroupSessionDialog({ lesson, onOpenChange, onMaterials, onOpenStudent }: { lesson: Lesson | null; onOpenChange: (open: boolean) => void; onMaterials: (lesson: Lesson) => void; onOpenStudent: (studentId: string) => void }) {
  const { cancelGroupSession, rescheduleGroupSession, cancelMemberLesson, openGroup } = useGroupActions();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(lesson?.date ?? "");
  const [time, setTime] = useState(lesson?.time ?? "");
  const [pending, setPending] = useState(false);
  const participants = lesson?.participants ?? [];
  const absentees = lesson?.absentees ?? [];
  const run = async (action: () => Promise<boolean>, close = true) => { setPending(true); const done = await action(); setPending(false); if (done && close) onOpenChange(false); return done; };

  return <Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    {lesson && <>
      <DialogHeader>
        <DialogTitle data-no-translate>{lesson.className ?? lesson.name}</DialogTitle>
        <DialogDescription>{dateTitle(lesson.date, { weekday: "short", day: "numeric", month: "long" })} · {lesson.time}–{lesson.end} · {russianPlural(participants.length, "участник", "участника", "участников")}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => onMaterials(lesson)}><NotebookPen />Материалы</Button>
        <Button type="button" variant="outline" aria-expanded={moving} onClick={() => setMoving((value) => !value)}><CalendarClock />Перенести</Button>
      </div>
      {moving && <div className="grid gap-3 rounded-2xl border border-line bg-surface-subtle p-3">
        <div className="grid grid-cols-2 gap-2"><FormField label="Новая дата"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 rounded-xl" /></FormField><FormField label="Новое время"><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-11 rounded-xl" /></FormField></div>
        <Button type="button" disabled={pending || !date || !time} onClick={() => void run(() => rescheduleGroupSession(lesson.id, date, time))}>{pending ? "Сохраняю…" : "Перенести для всей группы"}</Button>
      </div>}
      <section aria-labelledby="group-session-members" className="flex flex-col gap-1">
        <h3 id="group-session-members" className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">Участники</h3>
        {participants.map((participant) => <div key={participant.lessonId} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-b-0">
          <button type="button" data-no-translate className="min-w-0 truncate text-left text-[15px] font-semibold hover:underline" onClick={() => { onOpenChange(false); onOpenStudent(participant.studentId); }}>{participant.name}</button>
          <span className="flex shrink-0 items-center gap-1.5"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${lessonStatusStyle({ status: participant.status, past: false })}`}>{lessonStatusLabel({ label: participant.label })}</span>
            <Button type="button" size="icon" variant="ghost" aria-label={`Отменить занятие для ${participant.name}`} title="Отменить только для этого ученика" disabled={pending} onClick={() => { if (window.confirm(`Отменить занятие только для ${participant.name}? У остальных оно останется.`)) void run(() => cancelMemberLesson(participant.lessonId), participants.length <= 1); }}><UserX /></Button></span>
        </div>)}
        {absentees.map((absence) => <div key={absence.lessonId} className="flex items-center justify-between gap-2 border-b border-line py-2 opacity-70 last:border-b-0"><span data-no-translate className="min-w-0 truncate text-[15px]">{absence.studentName}</span><span className="shrink-0 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-ink">Не придёт</span></div>)}
      </section>
      <DialogFooter className="flex-col gap-2 sm:flex-col">
        <Button type="button" variant="outline" onClick={() => { if (lesson.classId) { onOpenChange(false); openGroup(lesson.classId); } }}>Карточка группы</Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={() => { if (window.confirm("Отменить занятие для всей группы? Списания не будет.")) void run(() => cancelGroupSession(lesson.id)); }}><Trash2 />Отменить занятие для всех</Button>
      </DialogFooter>
    </>}
  </DialogContent></Dialog>;
}
