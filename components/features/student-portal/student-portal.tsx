"use client";

import { useEffect, useState } from "react";
import { Bell, LayoutGrid, LogOut, NotebookPen, Rows3, WalletCards } from "lucide-react";
import { AppCard, AppCardDescription, AppCardTitle } from "@/components/common/app-card";
import { EmptyState } from "@/components/common/empty-state";
import { ShowMoreButton } from "@/components/common/show-more-button";
import { BrandIcon } from "@/components/brand-icon";
import { MemberAvatar, MessagesCard, ProfilePersonalizationCard } from "@/components/features/account";
import type { AppNotification, AvailableSlot, BalanceEntry, HistoryEvent, Lesson, LessonRequest, Student, StudentRequestDraft } from "@/components/features/app/types";
import { BalanceHistory, HistoryTimeline } from "@/components/features/history/history-lists";
import { lessonStatusStyles } from "@/components/features/lessons/status-styles";
import { StudentMaterialsCard } from "@/components/features/materials/student-materials-card";
import { StudentRequestDialog } from "@/components/features/requests/student-request-dialog";
import { TelegramNotificationsCard } from "@/components/features/telegram/telegram-notifications-card";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { preferenceKey, readPreference, writePreference } from "@/lib/client-preferences";
import { dateTitle, today } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";

type StudentPortalProps = {
  student: Student;
  teacherName: string;
  lessons: Lesson[];
  entries: BalanceEntry[];
  historyEvents: HistoryEvent[];
  requests: LessonRequest[];
  notifications: AppNotification[];
  availableSlots: AvailableSlot[];
  onReadNotifications: () => Promise<void>;
  onRequest: (body: StudentRequestDraft) => Promise<boolean>;
  onMaterials: (lesson: Lesson) => void;
  onBack: () => void;
  onReload: () => Promise<void>;
};

export function StudentPortal({ student, teacherName, lessons, entries, historyEvents, requests, notifications, availableSlots, onReadNotifications, onRequest, onMaterials, onBack, onReload }: StudentPortalProps) {
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [compactView, setCompactView] = useState(false);
  const futureLessons = lessons.filter((lesson) => lesson.date >= today()).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const recentLessons = lessons.filter((lesson) => lesson.past).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).slice(0, 10);
  const visibleRecentLessons = recentExpanded ? recentLessons : recentLessons.slice(0, 3);
  const visibleHistoryEvents = historyExpanded ? historyEvents : historyEvents.slice(0, 3);
  const nextLesson = futureLessons[0];
  const paymentEntries = entries.filter((entry) => entry.kind === "payment" || entry.kind === "refund" || entry.kind === "adjustment");

  useEffect(() => {
    const timer = window.setTimeout(() => setCompactView(readPreference(preferenceKey(student.id, "student-portal-view")) === "compact"), 0);
    return () => window.clearTimeout(timer);
  }, [student.id]);

  const changeView = (compact: boolean) => {
    setCompactView(compact);
    writePreference(preferenceKey(student.id, "student-portal-view"), compact ? "compact" : "dashboard");
  };

  return <main className="min-h-screen overflow-x-clip bg-background px-4 pb-24 pt-5 text-foreground"><div className={`mx-auto ${compactView ? "max-w-xl" : "max-w-7xl"}`}>
    <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500"><LogOut className="size-4" />Выйти</button>
    <div className="mb-4 flex justify-end"><Button type="button" size="sm" variant="outline" onClick={() => changeView(!compactView)}>{compactView ? <LayoutGrid /> : <Rows3 />}{compactView ? "Расширенный вид" : "Компактный вид"}</Button></div>
    <div className="mb-7 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><BrandIcon className="size-12" /><div className="min-w-0"><h1 className="truncate text-3xl font-bold">Привет, {student.name.split(" ")[0]}</h1><p className="mt-1 text-slate-500">Ваше расписание занятий</p></div></div><div className="flex items-center gap-2"><ThemeToggle compact /><MemberAvatar name={student.name} initials={student.initials.slice(0, 1)} color={student.ownAvatarColor} url={student.avatarUrl} className="size-12" /></div></div>
    <div className={`grid items-start gap-6 ${compactView ? "" : "lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,380px)]"}`}><div className="min-w-0">
      {notifications.some((item) => !item.read) && <button onClick={() => void onReadNotifications()} className="mb-4 flex w-full items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-left text-indigo-950 transition hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-950/55 dark:text-indigo-50 dark:hover:bg-indigo-950/75"><Bell className="mt-0.5 size-5 shrink-0 text-indigo-600 dark:text-indigo-300" /><span><strong className="block">{notifications.find((item) => !item.read)?.title}</strong><span className="mt-1 block text-sm text-indigo-800 dark:text-indigo-100">{notifications.find((item) => !item.read)?.body}</span></span></button>}
      {nextLesson ? <section className="card p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-500">Следующий урок</p><h2 className="mt-3 text-2xl font-bold capitalize">{dateTitle(nextLesson.date, { weekday: "long", day: "numeric", month: "long" })}</h2><p className="mt-2 text-3xl font-bold">{nextLesson.time}–{nextLesson.end}</p><p className="mt-2 text-slate-500">{teacherName}</p></div><span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${lessonStatusStyles[nextLesson.status]}`}>{nextLesson.label}</span></div><Button type="button" variant="outline" className="mt-5 w-full" onClick={() => onMaterials(nextLesson)}><NotebookPen />Материалы урока</Button><div className="mt-3 grid gap-3"><StudentRequestDialog type="reschedule" lesson={nextLesson} student={student} onRequest={onRequest} /><StudentRequestDialog type="cancel" lesson={nextLesson} student={student} onRequest={onRequest} /></div><p className="mt-3 text-center text-sm text-slate-500">Отмену можно запросить до 23:59 предыдущего дня</p></section> : <section className="card"><EmptyState text="Следующий урок пока не назначен" /></section>}
      {futureLessons.length > 1 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Дальнейшие занятия</h2><div className="card divide-y">{futureLessons.slice(1).map((lesson) => <article key={lesson.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><strong className="capitalize">{dateTitle(lesson.date, { weekday: "long", day: "numeric", month: "long" })}</strong><p className="mt-1 text-sm text-slate-500">{lesson.time}–{lesson.end}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${lessonStatusStyles[lesson.status]}`}>{lesson.label}</span></div><Button type="button" size="sm" variant="outline" className="mt-3 w-full" onClick={() => onMaterials(lesson)}><NotebookPen />Материалы урока</Button><div className="mt-2 grid gap-2"><StudentRequestDialog type="reschedule" lesson={lesson} student={student} onRequest={onRequest} /><StudentRequestDialog type="cancel" lesson={lesson} student={student} onRequest={onRequest} /></div></article>)}</div></section>}
      <StudentMaterialsCard />
      {recentLessons.length > 0 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Недавние уроки</h2><div className="card divide-y overflow-hidden">{visibleRecentLessons.map((lesson) => <button key={lesson.id} type="button" onClick={() => onMaterials(lesson)} className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800/80 dark:hover:text-white"><span><strong className="block capitalize">{dateTitle(lesson.date, { day: "numeric", month: "long" })}</strong><span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{lesson.time}–{lesson.end}</span></span><span className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400"><NotebookPen className="size-4" />Материалы</span></button>)}{recentLessons.length > 3 && <ShowMoreButton expanded={recentExpanded} remaining={recentLessons.length - 3} className="rounded-none border-x-0 border-b-0" onToggle={() => setRecentExpanded((value) => !value)} />}</div></section>}
      <section className="mt-5"><h2 className="mb-3 text-lg font-bold">История</h2><HistoryTimeline events={visibleHistoryEvents} showStudent={false} />{historyEvents.length > 3 && <ShowMoreButton expanded={historyExpanded} remaining={historyEvents.length - 3} className="mt-3" onToggle={() => setHistoryExpanded((value) => !value)} />}</section>
    </div><aside className={`${compactView ? "" : "order-first lg:order-none lg:sticky lg:top-5"} min-w-0 space-y-5`}>
      <ProfilePersonalizationCard name={student.name} initials={student.initials} avatarColor={student.ownAvatarColor} avatarUrl={student.avatarUrl} onChanged={onReload} />
      <MessagesCard />
      <section className={`rounded-3xl border p-6 ${student.balance < 0 ? "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-400/30 dark:bg-rose-950/45 dark:text-rose-50" : "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-50"}`}><div className="flex items-center gap-3"><WalletCards className={`size-6 ${student.balance < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`} /><div><p className="font-semibold opacity-80">Баланс</p><p className="text-2xl font-bold">{russianPlural(student.balance, "занятие", "занятия", "занятий")}</p></div></div>{student.balance < 0 && <p className="mt-3 text-rose-800 dark:text-rose-100">Необходимо оплатить {russianPlural(Math.abs(student.balance), "занятие", "занятия", "занятий")}</p>}</section>
      {(student.floating || student.canViewAvailability) && <AppCard><AppCardTitle>Свободные слоты</AppCardTitle><AppCardDescription>Выберите подходящее свободное время и отправьте запрос преподавателю.</AppCardDescription><div className="mt-4"><StudentRequestDialog type="new_lesson" student={student} availableSlots={student.canViewAvailability ? availableSlots : undefined} onRequest={onRequest} fullWidth /></div></AppCard>}
      {requests.length > 0 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Запросы на рассмотрении</h2><div className="card divide-y">{requests.map((request) => <div key={request.id} className="p-4"><strong>{request.type}</strong><p className="mt-1 text-sm text-slate-500">{request.detail}</p></div>)}</div></section>}
      <div className="mt-5"><TelegramNotificationsCard compact /></div>
      <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Оплаты</h2><BalanceHistory entries={paymentEntries} /></section>
    </aside></div>
  </div><Toaster position="top-center" richColors /></main>;
}
