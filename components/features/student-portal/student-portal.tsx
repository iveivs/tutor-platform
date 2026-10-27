"use client";

import { useState, useSyncExternalStore } from "react";
import { CalendarClock, ChevronRight, FolderOpen, History, LogOut, MessageCircle, NotebookPen, Palette, WalletCards } from "lucide-react";
import { useTheme } from "next-themes";
import { CollapsibleSection } from "@/components/common/collapsible-section";
import { ShowMoreButton } from "@/components/common/show-more-button";
import { BrandIcon } from "@/components/brand-icon";
import { MemberAvatar, MessagesDialog, ProfilePersonalizationCard } from "@/components/features/account";
import type { AppNotification, AvailableSlot, BalanceEntry, HistoryEvent, Lesson, LessonRequest, Student, StudentRequestDraft } from "@/components/features/app/types";
import { BalanceHistory, HistoryTimeline } from "@/components/features/history/history-lists";
import { LessonContentBadges } from "@/components/features/lessons/lesson-content-badges";
import { StudentMaterialsCard } from "@/components/features/materials/student-materials-card";
import { StudentRequestDialog } from "@/components/features/requests/student-request-dialog";
import { LessonStatusChip } from "@/components/features/schedule/lesson-card";
import { SettingsGroup, settingsRowClass } from "@/components/features/settings/settings-group";
import { TelegramNotificationsCard } from "@/components/features/telegram/telegram-notifications-card";
import { useLanguage, type Language } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { dateTitle } from "@/lib/date-time";
import { russianPlural } from "@/lib/russian-plural";
import { useCurrentDay } from "@/hooks/use-current-day";

const INITIAL_NOTIFICATIONS = 3;

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

const lessonDay = (lesson: Lesson) => dateTitle(lesson.date, { weekday: "long", day: "numeric", month: "long" });

export function StudentPortal({ student, teacherName, lessons, entries, historyEvents, requests, notifications, availableSlots, onReadNotifications, onRequest, onMaterials, onBack, onReload }: StudentPortalProps) {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const currentDay = useCurrentDay();
  const futureLessons = lessons.filter((lesson) => lesson.date >= currentDay && !lesson.past).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const recentLessons = lessons.filter((lesson) => lesson.past).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).slice(0, 10);
  const nextLesson = futureLessons[0];
  const unreadCount = notifications.filter((item) => !item.read).length;
  const shownNotifications = notificationsExpanded ? notifications : notifications.slice(0, INITIAL_NOTIFICATIONS);
  const paymentEntries = entries.filter((entry) => entry.kind === "payment" || entry.kind === "refund" || entry.kind === "adjustment");
  const selectTrigger = "h-9 w-auto min-w-0 gap-1.5 border-0 bg-transparent px-2 text-sm text-ink-muted shadow-none dark:bg-transparent";

  return <main className="min-h-screen overflow-x-clip bg-background px-4 pb-16 pt-5 text-foreground md:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <BrandIcon className="size-11 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">Привет, <span data-no-translate>{student.name.split(" ")[0]}</span></h1>
          <p className="truncate text-sm text-ink-muted">Преподаватель: <span data-no-translate>{teacherName}</span></p>
        </div>
        <MemberAvatar name={student.name} initials={student.initials.slice(0, 1)} color={student.ownAvatarColor} url={student.avatarUrl} className="size-11 shrink-0" />
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-5">
          {nextLesson ? <section aria-label="Следующий урок" className="rounded-[var(--radius-card)] bg-hero-start p-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-coral">Следующий урок</p>
              <LessonStatusChip lesson={nextLesson} />
            </div>
            <p className="mt-2 text-xl font-bold first-letter:uppercase">{lessonDay(nextLesson)}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">{nextLesson.time}–{nextLesson.end}</p>
            <LessonContentBadges lesson={nextLesson} />
            <Button type="button" variant="secondary" className="mt-4 h-11 w-full rounded-xl" onClick={() => onMaterials(nextLesson)}><NotebookPen />Материалы урока</Button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <StudentRequestDialog type="reschedule" lesson={nextLesson} student={student} onRequest={onRequest} compactTrigger={{ label: "Перенести", className: "h-10 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white dark:border-white/25 dark:bg-white/10" }} />
              <StudentRequestDialog type="cancel" lesson={nextLesson} student={student} onRequest={onRequest} compactTrigger={{ label: "Отменить", className: "h-10 rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white dark:border-white/25 dark:bg-white/10" }} />
            </div>
            <p className="mt-3 text-center text-xs text-hero-muted">Отмену можно запросить до 23:59 предыдущего дня</p>
          </section> : <section className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-muted"><CalendarClock className="size-5 shrink-0 text-ink-faint" />Следующий урок пока не назначен</section>}

          <div className="grid grid-cols-2 gap-3 lg:hidden">
            <BalanceTile balance={student.balance} />
            <button type="button" onClick={() => setMessagesOpen(true)} className="flex flex-col items-start gap-1 rounded-2xl border border-line bg-surface p-4 text-left transition hover:bg-surface-subtle"><MessageCircle className="size-5 text-brand-text" /><span className="mt-1 text-base font-bold">Сообщения</span><span className="text-xs text-ink-muted">Написать преподавателю</span></button>
          </div>

          <section aria-labelledby="student-notifications-title" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="student-notifications-title" className="text-lg font-bold">Уведомления</h2>
              {unreadCount > 0 && <button type="button" onClick={() => void onReadNotifications()} className="text-sm font-semibold text-brand-text hover:underline">Прочитать все</button>}
            </div>
            {notifications.length === 0
              ? <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-muted">Уведомлений пока нет</p>
              : <div className="overflow-hidden rounded-2xl border border-line bg-surface">{shownNotifications.map((item, index) => <div key={item.id} className={`flex items-start gap-3 px-4 py-3 ${index < shownNotifications.length - 1 ? "border-b border-line" : ""} ${item.read ? "" : "bg-brand-soft/40"}`}>
                <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-attention-dot"}`} />
                <span className="flex min-w-0 flex-col gap-0.5"><span className={`text-[15px] ${item.read ? "font-medium" : "font-bold"}`}>{item.title}</span><span className="text-sm text-ink-muted">{item.body}</span></span>
              </div>)}</div>}
            {notifications.length > INITIAL_NOTIFICATIONS && <ShowMoreButton expanded={notificationsExpanded} remaining={notifications.length - INITIAL_NOTIFICATIONS} onToggle={() => setNotificationsExpanded((value) => !value)} />}
          </section>

          {futureLessons.length > 1 && <section aria-labelledby="student-upcoming-title" className="flex flex-col gap-3">
            <h2 id="student-upcoming-title" className="text-lg font-bold">Дальнейшие занятия</h2>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">{futureLessons.slice(1).map((lesson, index, list) => <article key={lesson.id} className={`px-4 py-3 ${index < list.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><strong className="block first-letter:uppercase">{lessonDay(lesson)}</strong><span className="text-sm text-ink-muted">{lesson.time}–{lesson.end}</span><LessonContentBadges lesson={lesson} /></div>
                <LessonStatusChip lesson={lesson} />
              </div>
              <div className="-mx-2 mt-1 grid grid-cols-3 gap-1 sm:flex">
                <Button type="button" size="sm" variant="ghost" className="text-brand-text" onClick={() => onMaterials(lesson)}>Материалы</Button>
                <StudentRequestDialog type="reschedule" lesson={lesson} student={student} onRequest={onRequest} compactTrigger={{ label: "Перенести", variant: "ghost" }} />
                <StudentRequestDialog type="cancel" lesson={lesson} student={student} onRequest={onRequest} compactTrigger={{ label: "Отменить", variant: "ghost", className: "text-danger-text" }} />
              </div>
            </article>)}</div>
          </section>}

          <CollapsibleSection scope={student.id} id="materials" title="Материалы" description="Документы и фотографии со всех уроков" icon={FolderOpen}><StudentMaterialsCard embedded /></CollapsibleSection>
          {recentLessons.length > 0 && <CollapsibleSection scope={student.id} id="recent-lessons" title="Недавние уроки" description="Прошедшие занятия и их материалы" icon={CalendarClock}>
            <div className="overflow-hidden rounded-2xl border border-line">{(recentExpanded ? recentLessons : recentLessons.slice(0, 3)).map((lesson, index, list) => <button key={lesson.id} type="button" onClick={() => onMaterials(lesson)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-subtle ${index < list.length - 1 ? "border-b border-line" : ""}`}><span className="min-w-0"><strong className="block first-letter:uppercase">{dateTitle(lesson.date, { day: "numeric", month: "long" })}</strong><span className="text-sm text-ink-muted">{lesson.time}–{lesson.end}</span><LessonContentBadges lesson={lesson} /></span><span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-text">Материалы<ChevronRight className="size-4" /></span></button>)}</div>
            {recentLessons.length > 3 && <ShowMoreButton expanded={recentExpanded} remaining={recentLessons.length - 3} className="mt-3" onToggle={() => setRecentExpanded((value) => !value)} />}
          </CollapsibleSection>}
          <CollapsibleSection scope={student.id} id="history" title="История" description="События, оплаты и изменения занятий" icon={History}>
            <HistoryTimeline events={historyExpanded ? historyEvents : historyEvents.slice(0, 3)} showStudent={false} />
            {historyEvents.length > 3 && <ShowMoreButton expanded={historyExpanded} remaining={historyEvents.length - 3} className="mt-3" onToggle={() => setHistoryExpanded((value) => !value)} />}
          </CollapsibleSection>
        </div>

        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-5">
          <div className="hidden flex-col gap-3 lg:flex">
            <BalanceTile balance={student.balance} />
            <Button type="button" variant="outline" className="h-11 justify-start rounded-xl bg-surface" onClick={() => setMessagesOpen(true)}><MessageCircle />Написать преподавателю</Button>
          </div>

          {(student.floating || student.canViewAvailability) && <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="text-base font-bold">Свободное время</h2>
            <p className="mt-1 text-sm text-ink-muted">Выберите подходящее время и отправьте запрос преподавателю.</p>
            <div className="mt-3"><StudentRequestDialog type="new_lesson" student={student} availableSlots={student.canViewAvailability ? availableSlots : undefined} onRequest={onRequest} fullWidth /></div>
          </section>}

          {requests.length > 0 && <SettingsGroup title="Запросы на рассмотрении">
            {requests.map((request) => <div key={request.id} className={`${settingsRowClass} flex-col items-start gap-0.5`}><strong className="text-[15px]">{request.type}</strong><span className="text-sm text-ink-muted">{request.detail}</span></div>)}
          </SettingsGroup>}

          <section className="flex flex-col gap-2">
            <h2 className="px-1 pt-2 text-[13px] font-bold uppercase tracking-wide text-ink-muted">Оплаты</h2>
            <BalanceHistory entries={paymentEntries} />
          </section>

          <TelegramNotificationsCard />

          <SettingsGroup title="Оформление">
            <div className={settingsRowClass}>
              <span className="text-[15px]">Тема</span>
              <Select value={mounted ? theme ?? "system" : "system"} onValueChange={setTheme}><SelectTrigger size="sm" aria-label="Тема" className={selectTrigger}><SelectValue /></SelectTrigger><SelectContent align="end"><SelectItem value="system">Как в системе</SelectItem><SelectItem value="light">Светлая</SelectItem><SelectItem value="dark">Тёмная</SelectItem></SelectContent></Select>
            </div>
            <div className={settingsRowClass}>
              <span className="text-[15px]">Язык</span>
              <Select value={language} onValueChange={(value) => setLanguage(value as Language)}><SelectTrigger size="sm" aria-label="Язык" className={selectTrigger} data-no-translate><SelectValue /></SelectTrigger><SelectContent align="end" data-no-translate><SelectItem value="ru">Русский</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select>
            </div>
          </SettingsGroup>

          <CollapsibleSection scope={student.id} id="personalization" title="Персонализация" description="Фото профиля и цвет аватара" icon={Palette}><ProfilePersonalizationCard name={student.name} initials={student.initials} avatarColor={student.ownAvatarColor} avatarUrl={student.avatarUrl} onChanged={onReload} embedded /></CollapsibleSection>

          <Button type="button" variant="outline" onClick={onBack} className="mt-2 h-12 w-full rounded-xl bg-surface text-[15px] text-danger-text"><LogOut />Выйти</Button>
        </aside>
      </div>
    </div>
    <MessagesDialog open={messagesOpen} onOpenChange={setMessagesOpen} showTrigger={false} />
    <Toaster position="top-center" richColors />
  </main>;
}

function BalanceTile({ balance }: { balance: number }) {
  const debt = balance < 0;
  return <div className={`flex flex-col items-start gap-1 rounded-2xl border p-4 ${debt ? "border-danger-ring bg-danger-soft" : "border-line bg-surface"}`}>
    <WalletCards className={`size-5 ${debt ? "text-danger-text" : "text-success-text"}`} />
    <span className="mt-1 text-xs font-semibold text-ink-muted">Баланс</span>
    <span className={`text-base font-bold ${debt ? "text-danger-ink" : ""}`}>{debt ? `Долг ${Math.abs(balance)}` : russianPlural(balance, "занятие", "занятия", "занятий")}</span>
  </div>;
}
