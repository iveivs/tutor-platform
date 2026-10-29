"use client";

import { FilterChips } from "@/components/common/filter-chips";
import { GroupEditorDialog, GroupsList } from "@/components/features/groups/groups-view";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Clock3, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/common/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import { InfoCard } from "@/components/common/info-card";
import type { BalanceEntry, HistoryEvent, Lesson, LessonDraft, RecurringSlot, Student, StudentDraft, StudentPrices } from "@/components/features/app/types";
import { MemberAvatar, MessagesDialog, StudentAvatarPreferenceCard } from "@/components/features/account";
import { BalanceHistory, HistoryTimeline } from "@/components/features/history/history-lists";
import { LessonCard } from "@/components/features/schedule/lesson-card";
import { AddLessonDialog } from "@/components/features/schedule/lesson-dialogs";
import { StudentAvailabilityAccessCard } from "@/components/features/students/student-availability-access-card";
import { AddStudentSheet, BalanceAdjustmentDialog, EditStudentDialog, InviteStudentDialog, PaymentDialog, StopSeriesDialog, StudentArchiveActions, StudentPricesDialog } from "@/components/features/students/student-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { today } from "@/lib/date-time";
import { formatMoney } from "@/lib/money";
import { russianPlural } from "@/lib/russian-plural";
import { GuardianDialog, guardianSummary } from "@/components/features/students/guardian-dialog";

const filters = ["Все", "Постоянное", "Плавающее", "Задолженность", "Без урока", "Архив"];
const balanceText = (balance: number) => balance < 0 ? `Долг ${Math.abs(balance)}` : russianPlural(balance, "занятие", "занятия", "занятий");
const balanceTone = (balance: number) => balance < 0 ? "bg-status-debt text-status-debt-ink" : balance <= 1 ? "bg-status-unpaid text-status-unpaid-ink" : "bg-status-paid text-status-paid-ink";

function BalancePill({ balance }: { balance: number }) {
  return <span className={`inline-flex shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold ${balanceTone(balance)}`}>{balanceText(balance)}</span>;
}

// Redesign v2 of the students list: cards on phones, the table from md up. Same filters and search as StudentsView.
export function StudentsView({ students, onAdd, onOpen }: { students: Student[]; onAdd: (student: StudentDraft) => Promise<boolean>; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Все");
  const [section, setSection] = useState<"students" | "groups">("students");
  const filtered = useMemo(() => students.filter((student) => student.name.toLowerCase().includes(query.toLowerCase()) && (filter === "Архив" ? student.archived : !student.archived && (filter === "Все" || filter === "Плавающее" && student.floating || filter === "Постоянное" && !student.floating || filter === "Задолженность" && student.balance < 0 || filter === "Без урока" && student.next === "Не назначен"))), [students, query, filter]);
  const sectionSwitch = <FilterChips label="Раздел" items={[{ value: "students", label: "Ученики" }, { value: "groups", label: "Группы" }] as const} value={section} onChange={setSection} />;
  if (section === "groups") return <AppShell actionsInline title="Ученики" actions={<GroupEditorDialog students={students} trigger={<Button size="lg" className="h-11 rounded-xl"><Plus />Новая группа</Button>} />}>
    <div className="mb-4">{sectionSwitch}</div>
    <GroupsList students={students} />
  </AppShell>;
  return <AppShell actionsInline title="Ученики" actions={<AddStudentSheet onAdd={onAdd} />}>
    <div className="mb-4">{sectionSwitch}</div>
    <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="relative max-w-md flex-1"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-subtle" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени" className="h-12 rounded-[var(--radius-control)] bg-surface pl-11 dark:bg-surface" /></div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">{filters.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={`h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition ${filter === item ? "bg-brand-solid text-white" : "border border-line bg-surface text-ink-secondary hover:text-ink-strong"}`}>{item}</button>)}</div>
    </div>
    <p className="mb-2 text-sm text-ink-muted md:hidden">{russianPlural(filtered.length, "ученик", "ученика", "учеников")}</p>
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface md:hidden">
      {filtered.map((student) => <button key={student.id} type="button" onClick={() => onOpen(student.id)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition last:border-b-0 hover:bg-surface-subtle">
        <MemberAvatar name={student.name} initials={student.initials} color={student.avatarColor} url={student.avatarUrl} className="size-10 text-sm" />
        <span className="min-w-0 flex-1"><strong data-no-translate className="block truncate">{student.name}</strong><span className={`block truncate text-sm ${student.next === "Не назначен" ? "text-warning-ink" : "text-ink-muted"}`}>{student.archived ? "В архиве" : student.next}</span></span>
        <BalancePill balance={student.balance} />
      </button>)}
    </div>
    <div className="hidden overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface md:block"><Table><TableHeader><TableRow className="bg-surface-subtle"><TableHead className="px-5">Ученик</TableHead><TableHead>Расписание</TableHead><TableHead>Следующий урок</TableHead><TableHead>Баланс</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((student) => <TableRow key={student.id} onClick={() => onOpen(student.id)} className="student-table-row cursor-pointer"><TableCell className="px-5 py-4"><span className="flex items-center gap-3"><MemberAvatar name={student.name} initials={student.initials} color={student.avatarColor} url={student.avatarUrl} className="size-10 text-sm" /><span><strong data-no-translate className="block">{student.name}</strong>{student.archived && <span className="text-xs text-ink-muted">В архиве</span>}</span></span></TableCell><TableCell><span className="text-ink-secondary">{student.schedule === "Постоянное расписание не задано" ? "Постоянное" : student.schedule}</span></TableCell><TableCell className={student.next === "Не назначен" ? "text-warning-ink" : "text-ink-secondary"}>{student.next}</TableCell><TableCell><BalancePill balance={student.balance} /></TableCell><TableCell><ChevronRight className="size-5 text-ink-subtle" /></TableCell></TableRow>)}</TableBody></Table></div>
    {!filtered.length && <EmptyState text="Ученики не найдены" />}
  </AppShell>;
}

type StudentViewProps = { student: Student; lessons: Lesson[]; recurringSlots: RecurringSlot[]; balanceEntries: BalanceEntry[]; historyEvents: HistoryEvent[]; onAdd: (lesson: LessonDraft) => Promise<boolean>; onBack: () => void; onPay: (id: string, count: number, date: string, amountCents?: number | null) => Promise<boolean>; onUpdatePrices: (id: string, prices: StudentPrices) => Promise<boolean>; onAdjustBalance: (id: string, units: number, note: string) => Promise<boolean>; onReversePayment: (id: string) => Promise<boolean>; onCreateInvite: (id: string) => Promise<string>; onUpdate: (student: Pick<Student, "id" | "name" | "email" | "canViewAvailability">) => Promise<boolean>; onStopSeries: (id: string) => Promise<boolean>; onRestore: (id: string) => Promise<boolean>; onDeletePermanently: (id: string) => Promise<boolean>; onReload: () => Promise<void> };

// Archived student: read-only history and payments, restore or delete permanently.
function ArchivedStudentView({ student, balanceEntries, historyEvents, onBack, onReversePayment, onRestore, onDeletePermanently }: StudentViewProps) {
  const payments = balanceEntries.filter((entry) => entry.studentId === student.id && (entry.kind === "payment" || entry.kind === "refund" || entry.kind === "adjustment"));
  const studentHistory = historyEvents.filter((event) => event.studentId === student.id);
  return <div className="mx-auto max-w-[1440px] px-4 py-5 md:px-8 md:py-8 xl:px-12">
    <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-brand-text"><ArrowLeft className="size-4" />Ученики</button>
    <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-center gap-3.5">
        <MemberAvatar name={student.name} initials={student.initials} color={student.avatarColor} url={student.avatarUrl} className="size-14 shrink-0 text-xl opacity-70" />
        <div className="min-w-0"><p className="text-sm font-semibold text-ink-muted">Архив</p><h1 data-no-translate className="truncate text-2xl font-bold tracking-tight md:text-3xl">{student.name}</h1></div>
      </div>
      <StudentArchiveActions student={student} onRestore={onRestore} onDeletePermanently={onDeletePermanently} />
    </div>
    <div className="mb-5 grid max-w-3xl gap-3">
      <div className="rounded-2xl border border-warning-ring bg-warning-soft p-4 text-warning-ink"><strong className="block">Ученик находится в архиве</strong><span className="mt-1 block text-sm">Новые уроки и оплаты недоступны, но история сохранена. Ученика можно восстановить.</span></div>
      <div className={`rounded-2xl border p-4 ${student.balance < 0 ? "border-danger-ring bg-danger-soft text-danger-ink" : "border-line bg-surface"}`}><strong>Баланс на момент архивации: {russianPlural(student.balance, "занятие", "занятия", "занятий")}</strong></div>
    </div>
    <Tabs defaultValue="history" className="max-w-3xl"><TabsList variant="line" className="mb-5 max-w-full justify-start overflow-x-auto"><TabsTrigger value="history">История</TabsTrigger><TabsTrigger value="payments">Оплаты</TabsTrigger></TabsList><TabsContent value="history"><HistoryTimeline events={studentHistory} showStudent={false} onReversePayment={onReversePayment} /></TabsContent><TabsContent value="payments"><BalanceHistory entries={payments} onReversePayment={onReversePayment} /></TabsContent></Tabs>
  </div>;
}

// Student card.
export function StudentView(props: StudentViewProps) {
  const { student, lessons, recurringSlots, balanceEntries, historyEvents, onAdd, onBack, onPay, onUpdatePrices, onAdjustBalance, onReversePayment, onCreateInvite, onUpdate, onStopSeries, onReload } = props;
  const [moreOpen, setMoreOpen] = useState(false);
  if (student.archived) return <ArchivedStudentView {...props} />;
  const history = balanceEntries.filter((entry) => entry.studentId === student.id);
  const studentHistory = historyEvents.filter((event) => event.studentId === student.id);
  const studentSlots = recurringSlots.filter((slot) => slot.studentId === student.id);
  const upcoming = lessons.filter((lesson) => lesson.studentId === student.id && lesson.date >= today());
  const nextStudentLesson = upcoming[0];
  const lessonPrice = student.prices?.lessonCents ?? null;
  const currency = student.prices?.currency ?? null;
  const priceDetails = [student.prices?.doubleLessonCents != null ? `двойное ${formatMoney(student.prices.doubleLessonCents, currency)}` : null, lessonPrice !== null || student.prices?.trialLessonCents != null ? `пробное ${student.prices?.trialLessonCents != null ? formatMoney(student.prices.trialLessonCents, currency) : "бесплатно"}` : null].filter(Boolean).join(" · ");
  const paidAmounts = history.filter((entry) => entry.kind === "payment" && !entry.reversed && entry.amountCents !== undefined);
  const paidTotal = paidAmounts.length ? paidAmounts.reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0) : null;
  const message = student.accountStatus === "active" && <MessagesDialog initialPeerId={student.id} label="Написать" />;
  const secondary = <><EditStudentDialog student={student} onUpdate={onUpdate} />{student.email && <InviteStudentDialog student={student} onCreateInvite={onCreateInvite} />}<BalanceAdjustmentDialog student={student} onAdjust={onAdjustBalance} /></>;

  return <div className="mx-auto max-w-[1440px] px-4 py-5 md:px-8 md:py-8 xl:px-12">
    <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-brand-text"><ArrowLeft className="size-4" />Ученики</button>
    <div className="mb-5 flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <MemberAvatar name={student.name} initials={student.initials} color={student.avatarColor} url={student.avatarUrl} className="size-14 shrink-0 text-xl" />
        <div className="min-w-0"><p className="text-sm font-semibold text-brand-text">{student.floating ? "Плавающее расписание" : "Постоянное расписание"}</p><h1 data-no-translate className="truncate text-2xl font-bold tracking-tight md:text-3xl">{student.name}</h1></div>
      </div>
      <div className="hidden flex-wrap gap-2 lg:flex"><PaymentDialog student={student} onPay={onPay} triggerLabel="Оплата" /><AddLessonDialog compact triggerLabel="Урок" students={[student]} defaultDate={today()} onAdd={onAdd} />{message}{secondary}</div>
    </div>

    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className={`flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-card)] p-4 ${student.balance < 0 ? "bg-status-debt text-status-debt-ink" : student.balance <= 1 ? "bg-status-unpaid text-status-unpaid-ink" : "bg-status-paid text-status-paid-ink"}`}>
        <span className="text-sm font-semibold">Баланс</span>
        <span className="text-2xl font-extrabold">{balanceText(student.balance)}</span>
        {student.balance < 0 && <span className="text-xs">Необходимо оплатить {russianPlural(Math.abs(student.balance), "занятие", "занятия", "занятий")}{lessonPrice !== null ? ` · ${formatMoney(Math.abs(student.balance) * lessonPrice, currency)}` : ""}</span>}
        {student.balance > 0 && lessonPrice !== null && <span className="text-xs">≈ {formatMoney(student.balance * lessonPrice, currency)}</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <span className="text-sm font-semibold text-ink-muted">Следующий урок</span>
        <span className="text-lg font-extrabold leading-snug md:text-2xl">{student.next}</span>
        <span className="text-xs text-ink-muted">{nextStudentLesson?.units === 2 ? "Двойной урок: 2 часа" : "Продолжительность: 1 час"}</span>
      </div>
      <StudentPricesDialog student={student} onSave={onUpdatePrices} trigger={<button type="button" className="col-span-2 flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left transition hover:bg-surface-subtle lg:col-span-1 lg:flex-col lg:items-start lg:justify-start lg:gap-0.5">
        <span className="flex min-w-0 flex-col gap-0.5"><span className="text-sm font-semibold text-ink-muted">Стоимость занятия</span><span className="text-lg font-extrabold leading-snug md:text-2xl">{lessonPrice !== null ? formatMoney(lessonPrice, currency) : "Не указана"}</span>{priceDetails && <span className="text-xs text-ink-muted">{priceDetails}</span>}</span>
        <span className="shrink-0 text-xs font-semibold text-brand-text">{lessonPrice !== null ? "Изменить" : "Указать"}</span>
      </button>} />
      <div className="hidden min-w-0 flex-col gap-0.5 rounded-[var(--radius-card)] border border-line bg-surface p-4 lg:flex">
        <span className="text-sm font-semibold text-ink-muted">Расписание</span>
        <span className="text-lg font-extrabold leading-snug md:text-2xl">{student.floating ? "Плавающее" : student.schedule}</span>
      </div>
      <GuardianDialog studentId={student.id} guardian={student.guardian} onSaved={onReload} trigger={<button type="button" className="col-span-2 flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-left transition hover:bg-surface-subtle lg:col-span-3">
        <span className="flex min-w-0 flex-col gap-0.5"><span className="text-sm font-semibold text-ink-muted">Кабинет ведёт</span><span className="truncate text-[15px] font-semibold" data-no-translate={student.guardian ? "" : undefined}>{guardianSummary(student.guardian)}</span></span>
        <span className="shrink-0 text-xs font-semibold text-brand-text">{student.guardian ? "Изменить" : "Указать взрослого"}</span>
      </button>} />
    </div>

    <div className="mb-5 space-y-2 lg:hidden">
      <div className="grid grid-cols-3 gap-2 [&_button]:h-11 [&_button]:w-full [&_button]:rounded-[var(--radius-control)] [&_button]:px-2">
        <PaymentDialog student={student} onPay={onPay} triggerLabel="Оплата" />
        <AddLessonDialog compact triggerLabel="Урок" students={[student]} defaultDate={today()} onAdd={onAdd} />
        {message || <span />}
      </div>
      <Button type="button" variant="ghost" className="w-full border border-dashed border-line text-ink-muted" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>{moreOpen ? "Скрыть" : "Ещё"}<ChevronDown className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} /></Button>
      {moreOpen && <div className="grid gap-2 [&_button]:w-full">{secondary}</div>}
    </div>

    <Tabs defaultValue="overview"><TabsList variant="line" className="mb-5 max-w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="lessons">Будущие уроки</TabsTrigger><TabsTrigger value="history">История</TabsTrigger><TabsTrigger value="payments">Оплаты</TabsTrigger></TabsList>
      <TabsContent value="overview"><div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="Расписание" icon={Clock3}><p className="text-lg font-bold">{student.floating ? "Регулярного расписания нет" : student.schedule}</p>{studentSlots.length ? <div className="mt-4 space-y-2">{studentSlots.map((slot) => <div key={slot.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line p-3"><span>{slot.label}{slot.durationMinutes === 120 ? " · двойной" : ""}</span><StopSeriesDialog slot={slot} onStop={onStopSeries} /></div>)}</div> : <p className="mt-1 text-ink-muted">{student.floating ? "Следующий урок назначается отдельно" : "Постоянные занятия не заданы"}</p>}</InfoCard>
        <StudentAvailabilityAccessCard student={student} onUpdate={onUpdate} />
        <StudentAvatarPreferenceCard studentId={student.id} name={student.name} initials={student.initials} avatarColor={student.avatarColor} ownAvatarColor={student.ownAvatarColor} avatarUrl={student.avatarUrl} onChanged={onReload} />
      </div></TabsContent>
      <TabsContent value="lessons">{upcoming.length ? <div className="space-y-2.5">{upcoming.map((lesson) => <LessonCard key={lesson.id} showDate lesson={lesson} />)}</div> : <EmptyState text="Будущих уроков нет" />}</TabsContent>
      <TabsContent value="history"><HistoryTimeline events={studentHistory} showStudent={false} onReversePayment={onReversePayment} /></TabsContent>
      <TabsContent value="payments">{paidTotal !== null && <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4"><span className="text-sm text-ink-muted">Всего оплачено</span><strong className="text-lg">{formatMoney(paidTotal, currency)}</strong></div>}<BalanceHistory entries={history.filter((entry) => entry.kind === "payment" || entry.kind === "refund" || entry.kind === "adjustment")} onReversePayment={onReversePayment} currency={currency} /></TabsContent>
    </Tabs>
  </div>;
}
