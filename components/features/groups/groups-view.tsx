"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Archive, CalendarPlus, MessagesSquare, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { FormField } from "@/components/common/form-field";
import { MemberAvatar } from "@/components/features/account";
import type { GroupDraft, Lesson, Student, StudentGroup } from "@/components/features/app/types";
import { useGroupActions } from "@/components/features/groups/group-actions";
import { GroupChatDialog } from "@/components/features/group-chat/group-chat-dialog";
import { useGroupChatUnread } from "@/components/features/group-chat/use-group-chat-unread";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { dateTitle, today } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";

const weekdayShort = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const durations = [45, 60, 90, 120];
const slotsText = (group: StudentGroup) => group.slots.length ? group.slots.map((slot) => `${weekdayShort[slot.weekday]} ${slot.time}`).join(", ") : "Без постоянного расписания";
const balanceText = (balance: number) => balance < 0 ? `Долг ${Math.abs(balance)}` : russianPlural(balance, "занятие", "занятия", "занятий");

// Upcoming sessions of a group: one entry per date and time.
function upcomingSessions(lessons: Lesson[], groupId: string) {
  const seen = new Map<string, { date: string; time: string; end: string; count: number }>();
  for (const lesson of lessons) {
    if (lesson.classId !== groupId || lesson.past || lesson.date < today()) continue;
    const key = `${lesson.date} ${lesson.time}`;
    const session = seen.get(key) ?? { date: lesson.date, time: lesson.time, end: lesson.end, count: 0 };
    session.count += 1; seen.set(key, session);
  }
  return [...seen.values()].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

export function GroupEditorDialog({ group, students, trigger }: { group?: StudentGroup; students: Student[]; trigger: ReactNode }) {
  const { createGroup, updateGroup, setGroupMembers, setGroupSlots } = useGroupActions();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<GroupDraft>({ name: "", membersVisible: false, memberIds: [], slots: [] });
  const candidates = students.filter((student) => !student.archived);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) setDraft(group ? { name: group.name, membersVisible: group.membersVisible, memberIds: group.memberIds, slots: group.slots.map(({ weekday, time, durationMinutes }) => ({ weekday, time, durationMinutes })) } : { name: "", membersVisible: false, memberIds: [], slots: [{ weekday: 2, time: "18:00", durationMinutes: 60 }] });
  };
  const toggleMember = (id: string, checked: boolean) => setDraft((value) => ({ ...value, memberIds: checked ? [...value.memberIds, id] : value.memberIds.filter((memberId) => memberId !== id) }));
  const changeSlot = (index: number, patch: Partial<GroupDraft["slots"][number]>) => setDraft((value) => ({ ...value, slots: value.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot) }));
  const save = async () => {
    setPending(true);
    let saved = true;
    if (!group) saved = await createGroup({ ...draft, name: draft.name.trim() });
    else {
      if (draft.name.trim() !== group.name || draft.membersVisible !== group.membersVisible) saved = await updateGroup(group.id, draft.name.trim(), draft.membersVisible);
      const sameMembers = draft.memberIds.length === group.memberIds.length && draft.memberIds.every((id) => group.memberIds.includes(id));
      if (saved && !sameMembers) saved = await setGroupMembers(group.id, draft.memberIds);
      const sameSlots = JSON.stringify(draft.slots) === JSON.stringify(group.slots.map(({ weekday, time, durationMinutes }) => ({ weekday, time, durationMinutes })));
      if (saved && !sameSlots && (!group.slots.length || window.confirm("Будущие занятия по старому расписанию будут отменены и созданы заново по новому. Продолжить?"))) saved = await setGroupSlots(group.id, draft.slots);
    }
    setPending(false);
    if (saved) setOpen(false);
  };
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild>{trigger}</DialogTrigger><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>{group ? "Изменить группу" : "Новая группа"}</DialogTitle><DialogDescription>С каждого участника за проведённое занятие списывается одно занятие с его баланса.</DialogDescription></DialogHeader>
    <FormField label="Название"><Input value={draft.name} maxLength={80} placeholder="Например: Хор «Камертон»" onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="h-11 rounded-xl" /></FormField>
    <FormField label="Расписание">
      <div className="flex flex-col gap-2">{draft.slots.map((slot, index) => <div key={index} className="grid grid-cols-[4.25rem_minmax(0,1fr)_6.5rem_2.25rem] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem] sm:gap-2">
        <Select value={String(slot.weekday)} onValueChange={(value) => changeSlot(index, { weekday: Number(value) })}><SelectTrigger aria-label="День недели" className="h-11 w-full min-w-0 gap-1 px-2.5 sm:gap-2 sm:px-3"><SelectValue /></SelectTrigger><SelectContent>{weekdayShort.slice(1).map((label, dayIndex) => <SelectItem key={label} value={String(dayIndex + 1)}>{label}</SelectItem>)}</SelectContent></Select>
        <Input type="time" aria-label="Время" value={slot.time} onChange={(event) => changeSlot(index, { time: event.target.value })} className="h-11 min-w-0 rounded-xl" />
        <Select value={String(slot.durationMinutes)} onValueChange={(value) => changeSlot(index, { durationMinutes: Number(value) })}><SelectTrigger aria-label="Длительность" className="h-11 w-full min-w-0 gap-1 px-2.5 sm:gap-2 sm:px-3"><SelectValue /></SelectTrigger><SelectContent>{durations.map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{`${minutes} мин`}</SelectItem>)}</SelectContent></Select>
        <Button type="button" size="icon" variant="ghost" aria-label="Удалить время" className="size-9 sm:size-10" onClick={() => setDraft((value) => ({ ...value, slots: value.slots.filter((_, slotIndex) => slotIndex !== index) }))}><Trash2 /></Button>
      </div>)}
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={draft.slots.length >= 14} onClick={() => setDraft((value) => ({ ...value, slots: [...value.slots, { weekday: 4, time: value.slots.at(-1)?.time ?? "18:00", durationMinutes: value.slots.at(-1)?.durationMinutes ?? 60 }] }))}><Plus />Добавить время</Button></div>
    </FormField>
    <FormField label={`Участники · ${draft.memberIds.length}`}>
      <div className="max-h-56 overflow-y-auto rounded-xl border border-line">{candidates.map((student) => <label key={student.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0"><Checkbox checked={draft.memberIds.includes(student.id)} onCheckedChange={(checked) => toggleMember(student.id, checked === true)} /><span data-no-translate className="min-w-0 truncate text-[15px]">{student.name}</span></label>)}{!candidates.length && <p className="p-3 text-sm text-ink-muted">Сначала добавьте учеников.</p>}</div>
    </FormField>
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line p-3"><span className="flex min-w-0 flex-col"><span className="text-[15px]">Участники видят друг друга</span><span className="text-xs text-ink-muted">Имена группы в кабинете каждого участника</span></span><Switch checked={draft.membersVisible} onCheckedChange={(checked) => setDraft((value) => ({ ...value, membersVisible: checked }))} aria-label="Участники видят друг друга" /></label>
    <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !draft.name.trim() || draft.slots.some((slot) => !slot.time)} onClick={() => void save()}>{pending ? "Сохраняю…" : group ? "Сохранить" : "Создать группу"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function AddSessionDialog({ group }: { group: StudentGroup }) {
  const { addGroupSession } = useGroupActions();
  const [open, setOpen] = useState(false); const [pending, setPending] = useState(false);
  const [date, setDate] = useState(today()); const [time, setTime] = useState(group.slots[0]?.time ?? "18:00"); const [duration, setDuration] = useState(group.slots[0]?.durationMinutes ?? 60);
  const save = async () => { setPending(true); const saved = await addGroupSession(group.id, date, time, duration); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="lg" className="h-11 rounded-xl"><CalendarPlus />Занятие</Button></DialogTrigger><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Дополнительное занятие</DialogTitle><DialogDescription data-no-translate>{group.name}</DialogDescription></DialogHeader>
    <div className="grid grid-cols-2 gap-3"><FormField label="Дата"><Input type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} className="h-11 rounded-xl" /></FormField><FormField label="Время"><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-11 rounded-xl" /></FormField></div>
    <FormField label="Длительность"><Select value={String(duration)} onValueChange={(value) => setDuration(Number(value))}><SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{durations.map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{`${minutes} мин`}</SelectItem>)}</SelectContent></Select></FormField>
    <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !date || !time} onClick={() => void save()}>{pending ? "Сохраняю…" : "Добавить занятие"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function GroupsList({ students }: { students: Student[] }) {
  const { groups, openGroup } = useGroupActions();
  const [showArchived, setShowArchived] = useState(false);
  const shown = groups.filter((group) => group.archived === showArchived);
  return <div className="flex flex-col gap-3">
    {shown.length ? <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">{shown.map((group) => <button key={group.id} type="button" onClick={() => openGroup(group.id)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition last:border-b-0 hover:bg-surface-subtle">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-text"><UsersRound className="size-5" /></span>
      <span className="min-w-0 flex-1"><strong data-no-translate className="block truncate">{group.name}</strong><span className="block truncate text-sm text-ink-muted">{russianPlural(group.memberIds.length, "участник", "участника", "участников")} · {slotsText(group)}</span></span>
    </button>)}</div> : <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5"><p className="text-sm text-ink-muted">{showArchived ? "В архиве групп нет." : "Групп пока нет. Группа — постоянный состав учеников с общим расписанием, например хор или ансамбль."}</p>{!showArchived && <GroupEditorDialog students={students} trigger={<Button><Plus />Новая группа</Button>} />}</div>}
    {groups.some((group) => group.archived) && <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Активные группы" : "Архив групп"}</Button>}
  </div>;
}

export function GroupView({ group, students, lessons, onBack, onOpenStudent }: { group: StudentGroup; students: Student[]; lessons: Lesson[]; onBack: () => void; onOpenStudent: (id: string) => void }) {
  const { updateGroup, archiveGroup } = useGroupActions();
  const members = useMemo(() => students.filter((student) => group.memberIds.includes(student.id)), [students, group.memberIds]);
  const sessions = useMemo(() => upcomingSessions(lessons, group.id), [lessons, group.id]);
  const next = sessions[0];
  const [chatOpen, setChatOpen] = useState(false);
  const unread = useGroupChatUnread()[group.id] ?? 0;
  return <div className="mx-auto max-w-[1440px] px-4 py-5 md:px-8 md:py-8 xl:px-12">
    <GroupChatDialog groupId={group.id} open={chatOpen} onOpenChange={setChatOpen} />
    <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-brand-text"><ArrowLeft className="size-4" />Группы</button>
    <div className="mb-5 flex min-w-0 items-center gap-3.5">
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-text"><UsersRound className="size-7" /></span>
      <div className="min-w-0"><p className="text-sm font-semibold text-coral-text">{group.archived ? "Архив" : `Группа · ${russianPlural(members.length, "участник", "участника", "участников")}`}</p><h1 data-no-translate className="truncate text-2xl font-bold tracking-tight md:text-3xl">{group.name}</h1></div>
    </div>
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-card)] border border-line bg-surface p-4"><span className="text-sm font-semibold text-ink-muted">Расписание</span><span className="text-lg font-extrabold leading-snug">{slotsText(group)}</span>{group.slots[0] && <span className="text-xs text-ink-muted">{`по ${group.slots[0].durationMinutes} мин`}</span>}</div>
        <div className="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-card)] border border-line bg-surface p-4"><span className="text-sm font-semibold text-ink-muted">Следующее занятие</span><span className="text-lg font-extrabold leading-snug">{next ? `${dateTitle(next.date, { weekday: "short", day: "numeric", month: "short" })}, ${next.time}` : "Не назначено"}</span>{next && <span className="text-xs text-ink-muted">{`придут ${next.count} из ${members.length}`}</span>}</div>
      </div>
      {!group.archived && <div className="flex flex-wrap gap-2"><Button size="lg" variant="outline" className="h-11 rounded-xl" onClick={() => setChatOpen(true)}><MessagesSquare />Чат группы{unread ? <span className="ml-0.5 grid min-w-5 place-items-center rounded-full bg-coral px-1.5 text-xs font-bold text-white">{unread}</span> : null}</Button><AddSessionDialog group={group} /><GroupEditorDialog group={group} students={students} trigger={<Button variant="outline" size="lg" className="h-11 rounded-xl"><Pencil />Изменить</Button>} /><Button variant="outline" size="lg" className="h-11 rounded-xl text-danger-text" onClick={() => { if (window.confirm(`Перенести «${group.name}» в архив? Будущие занятия группы будут отменены.`)) void archiveGroup(group.id); }}><Archive />В архив</Button></div>}
      {!group.archived && <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4"><span className="flex min-w-0 flex-col"><span className="text-[15px]">Участники видят друг друга</span><span className="text-xs text-ink-muted">Имена группы в кабинете каждого участника</span></span><Switch checked={group.membersVisible} onCheckedChange={(checked) => void updateGroup(group.id, group.name, checked)} aria-label="Участники видят друг друга" /></label>}
      <section aria-labelledby="group-members-title" className="flex flex-col gap-2">
        <h2 id="group-members-title" className="px-1 pt-1 text-[13px] font-bold uppercase tracking-wide text-ink-muted">{`Участники · ${members.length}`}</h2>
        {members.length ? <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">{members.map((student) => <button key={student.id} type="button" onClick={() => onOpenStudent(student.id)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-surface-subtle">
          <MemberAvatar name={student.name} initials={student.initials} color={student.avatarColor} url={student.avatarUrl} className="size-9 text-sm" />
          <span data-no-translate className="min-w-0 flex-1 truncate font-semibold">{student.name}</span>
          <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold ${student.balance < 0 ? "bg-status-debt text-status-debt-ink" : "bg-status-paid text-status-paid-ink"}`}>{balanceText(student.balance)}</span>
        </button>)}</div> : <p className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-ink-muted">В группе пока нет участников — добавьте их через «Изменить».</p>}
      </section>
      {sessions.length > 0 && <section aria-labelledby="group-sessions-title" className="flex flex-col gap-2">
        <h2 id="group-sessions-title" className="px-1 pt-1 text-[13px] font-bold uppercase tracking-wide text-ink-muted">Ближайшие занятия</h2>
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">{sessions.slice(0, 6).map((session) => <div key={`${session.date}${session.time}`} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"><span className="font-semibold first-letter:uppercase">{dateTitle(session.date, { weekday: "long", day: "numeric", month: "long" })}</span><span className="flex shrink-0 flex-col items-end text-sm text-ink-muted"><span>{session.time}–{session.end}</span>{session.count < members.length && <span className="text-xs text-warning-ink">{`придут ${session.count} из ${members.length}`}</span>}</span></div>)}</div>
      </section>}
    </div>
  </div>;
}
