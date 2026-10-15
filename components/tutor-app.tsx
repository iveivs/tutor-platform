"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Bell, CalendarDays, ChevronRight, Clock3, Copy,
  FolderOpen, History as HistoryIcon, Home, LogOut, Minus, Pencil, Plus, Search, Send, Settings, UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState as Empty } from "@/components/common/empty-state";
import { FormField as Field } from "@/components/common/form-field";
import { TimeField } from "@/components/common/time-field";
import { AppShell as Shell } from "@/components/common/app-shell";
import { StudentAvailabilityAccessCard } from "@/components/features/students/student-availability-access-card";
import { BalanceHistory, HistoryTimeline } from "@/components/features/history/history-lists";
import { HistoryView } from "@/components/features/history/history-view";
import { AddLessonDialog } from "@/components/features/schedule/lesson-dialogs";
import { CalendarView, LessonList, TodayView } from "@/components/features/schedule/schedule-views";
import { LessonMaterialsDialog } from "@/components/features/materials/lesson-materials-dialog";
import { TeacherMaterialsView } from "@/components/features/materials/teacher-materials-view";
import { NotificationsView } from "@/components/features/notifications/notifications-view";
import { RequestsView } from "@/components/features/requests/requests-view";
import { StudentPortal } from "@/components/features/student-portal/student-portal";
import { SettingsView } from "@/components/features/settings/settings-view";
import type { AppData, AppNotification, AvailabilityWindow, AvailableSlot, BalanceEntry, CurrentUser, HistoryEvent, Lesson, LessonDraft, LessonRequest, RecurringSlot, Student, StudentDraft, StudentRequestDraft, View } from "@/components/features/app/types";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { MemberAvatar, MessagesDialog, StudentAvatarPreferenceCard } from "@/components/features/account";
import { readAppData, saveAppData } from "@/lib/app-data-client";
import { preferenceKey, readPreference, writePreference } from "@/lib/client-preferences";
import { today } from "@/lib/date-time";
import { syncDelayForVisibility } from "@/lib/incremental-sync";
import { russianPlural as plural } from "@/lib/russian-plural";

export default function TutorApp({ role = "owner", user, onLogout }: { role?: "owner" | "teacher" | "student"; user?: CurrentUser; onLogout?: () => void }) {
  const preferenceScope = user?.email || role;
  const [view, setView] = useState<View>("today");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [recurringSlots, setRecurringSlots] = useState<RecurringSlot[]>([]);
  const [requests, setRequests] = useState<LessonRequest[]>([]);
  const [balanceEntries, setBalanceEntries] = useState<BalanceEntry[]>([]);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [availabilityWindows, setAvailabilityWindows] = useState<AvailabilityWindow[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [profile, setProfile] = useState<{ name: string; professionalTitle: string; email: string; avatarColor: string; avatarUrl?: string }>({ name: user?.name ?? "Преподаватель", professionalTitle: "Репетитор", email: user?.email ?? "", avatarColor: "indigo" });
  const [teacherName, setTeacherName] = useState(user?.name ?? "Преподаватель");
  const [selectedStudent, setSelectedStudent] = useState("101");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showPastLessons, setShowPastLessons] = useState(false);
  const [pastLessonsLoading, setPastLessonsLoading] = useState(false);
  const [materialsLesson, setMaterialsLesson] = useState<Lesson | null>(null);
  const syncCursorRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const requestIdsRef = useRef(new Set<string>());
  const notificationIdsRef = useRef(new Set<string>());

  const applyData = useCallback((data: AppData) => {
    if (data.lessons) setLessons(data.lessons);
    if (data.students) {
      setStudents(data.students);
      setSelectedStudent((current) => data.students?.some((student) => student.id === current) ? current : (data.students?.[0]?.id ?? current));
    }
    if (data.recurringSlots) setRecurringSlots(data.recurringSlots);
    if (data.requests) { setRequests(data.requests); requestIdsRef.current = new Set(data.requests.map((request) => request.id)); }
    if (data.balanceEntries) setBalanceEntries(data.balanceEntries);
    if (data.historyEvents) setHistoryEvents(data.historyEvents);
    if (data.notifications) { setNotifications(data.notifications); notificationIdsRef.current = new Set(data.notifications.map((notification) => notification.id)); }
    if (data.availabilityWindows) setAvailabilityWindows(data.availabilityWindows);
    if (data.availableSlots) setAvailableSlots(data.availableSlots);
    if (data.teacherName) setTeacherName(data.teacherName);
    if (data.profile) setProfile(data.profile);
    if (typeof data.syncCursor === "number") syncCursorRef.current = data.syncCursor;
  }, []);

  const reload = useCallback(async () => {
    const data = await readAppData(showPastLessons || role === "student"); applyData(data); setLoadError(false); setLoading(false);
  }, [applyData, role, showPastLessons]);

  const changePastLessonsVisibility = async (show: boolean) => {
    if (!show) { setShowPastLessons(false); writePreference(preferenceKey(preferenceScope, "show-past-lessons"), "false"); return; }
    setPastLessonsLoading(true);
    try { const data = await readAppData(true); applyData(data); setShowPastLessons(true); writePreference(preferenceKey(preferenceScope, "show-past-lessons"), "true"); }
    catch { toast.error("Не удалось загрузить прошедшие уроки"); }
    finally { setPastLessonsLoading(false); }
  };

  useEffect(() => {
    let active = true;
    const includePastLessons = role === "student" || readPreference(preferenceKey(preferenceScope, "show-past-lessons")) === "true";
    void readAppData(includePastLessons).then((data) => { if (active) { applyData(data); setShowPastLessons(includePastLessons); setLoadError(false); setLoading(false); } }).catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [applyData, preferenceScope, role]);

  const syncChanges = useCallback(async () => {
    if (syncInFlightRef.current || !navigator.onLine) return;
    syncInFlightRef.current = true;
    try {
      const data = await readAppData(showPastLessons || role === "student", syncCursorRef.current);
      const newRequest = data.requests?.find((request) => !requestIdsRef.current.has(request.id));
      const newNotification = data.notifications?.find((notification) => !notificationIdsRef.current.has(notification.id) && !notification.read);
      applyData(data);
      if (newRequest && role !== "student") toast.info(`Новый запрос: ${newRequest.name}`);
      else if (newNotification) toast.info(newNotification.title);
    } catch {
      // Фоновая синхронизация повторится по расписанию или при возвращении на вкладку.
    } finally {
      syncInFlightRef.current = false;
    }
  }, [applyData, role, showPastLessons]);

  useEffect(() => {
    if (loading) return;
    let active = true;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await syncChanges();
        if (active) schedule();
      }, syncDelayForVisibility(document.visibilityState === "visible"));
    };
    const syncNow = () => { if (document.visibilityState === "visible") void syncChanges(); };
    const syncAndReschedule = () => { syncNow(); schedule(); };
    schedule();
    window.addEventListener("focus", syncAndReschedule);
    window.addEventListener("online", syncAndReschedule);
    document.addEventListener("visibilitychange", syncAndReschedule);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", syncAndReschedule);
      window.removeEventListener("online", syncAndReschedule);
      document.removeEventListener("visibilitychange", syncAndReschedule);
    };
  }, [loading, syncChanges]);

  const addLesson = async (lesson: LessonDraft) => {
    try { await saveAppData({ action: "createLesson", studentId: lesson.studentId, trialGuestName: lesson.trialGuestName, trialGuestEmail: lesson.trialGuestEmail, trialGuestPhone: lesson.trialGuestPhone, trialGuestNote: lesson.trialGuestNote, date: lesson.date, time: lesson.time, repeat: lesson.repeat, lessonCount: lesson.lessonCount, lessonType: lesson.lessonType }); await reload(); toast.success(lesson.lessonType === "trial" ? "Пробное занятие добавлено в расписание" : lesson.lessonCount === 2 ? "Двойной урок добавлен в расписание" : "Урок добавлен в расписание"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить урок"); return false; }
  };
  const updateLesson = async (lessonId: string, date: string, time: string) => {
    try { await saveAppData({ action: "updateLesson", lessonId, date, time }); await reload(); toast.success("Урок перенесён"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось перенести урок"); return false; }
  };
  const deleteLesson = async (lessonId: string) => {
    try { await saveAppData({ action: "deleteLesson", lessonId }); await reload(); toast.success("Урок отменён без списания"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отменить урок"); return false; }
  };
  const stopLessonSeries = async (seriesId: string) => {
    try { await saveAppData({ action: "stopLessonSeries", seriesId }); await reload(); toast.success("Постоянное занятие остановлено"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось остановить расписание"); return false; }
  };
  const updateStudent = async (student: Pick<Student, "id" | "name" | "email" | "canViewAvailability">) => {
    try { await saveAppData({ action: "updateStudent", studentId: student.id, name: student.name, email: student.email, canViewAvailability: student.canViewAvailability }); await reload(); toast.success("Данные ученика сохранены"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить данные ученика"); return false; }
  };
  const convertTrialContact = async (studentId: string) => { try { await saveAppData({ action: "convertTrialContact", studentId }); await reload(); toast.success("Карточка ученика создана"); return true; } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось создать ученика"); return false; } };
  const restoreStudent = async (studentId: string) => { try { await saveAppData({ action: "restoreStudent", studentId }); await reload(); toast.success("Ученик восстановлен"); return true; } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось восстановить ученика"); return false; } };
  const deleteStudentPermanently = async (studentId: string) => { try { await saveAppData({ action: "deleteStudent", studentId }); await reload(); setView("students"); toast.success("Ученик и связанные данные удалены"); return true; } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось удалить ученика"); return false; } };
  const addStudent = async (student: StudentDraft) => {
    try {
      await saveAppData({ action: "createStudent", name: student.name, email: student.email, floating: student.floating, weekday: student.weekday, time: student.time });
      await reload();
      toast.success(student.email ? "Ученик создан. Пригласить его можно из карточки" : "Ученик создан");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать ученика");
      return false;
    }
  };
  const createStudentInvite = async (studentId: string) => {
    const result = await saveAppData({ action: "createStudentInvite", studentId });
    if (!result.inviteUrl) throw new Error("Ссылка не была создана");
    return result.inviteUrl;
  };
  const addPayment = async (studentId: string, count: number, paymentDate: string) => {
    try { await saveAppData({ action: "addPayment", studentId, count, paymentDate }); await reload(); toast.success(`Добавлено ${plural(count, "занятие", "занятия", "занятий")}`); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить оплату"); return false; }
  };
  const adjustBalance = async (studentId: string, units: number, note: string) => {
    try { await saveAppData({ action: "adjustBalance", studentId, units, note }); await reload(); toast.success("Баланс скорректирован"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось скорректировать баланс"); return false; }
  };
  const reversePayment = async (paymentId: string) => {
    try { await saveAppData({ action: "reversePayment", paymentId }); await reload(); toast.success("Оплата отменена, баланс пересчитан"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отменить оплату"); return false; }
  };
  const submitStudentRequest = async (body: StudentRequestDraft) => {
    try { await saveAppData({ action: "submitStudentRequest", ...body }); await reload(); toast.success("Запрос отправлен преподавателю"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос"); return false; }
  };
  const markNotificationsRead = async () => {
    try { await saveAppData({ action: "markNotificationsRead" }); await reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось обновить уведомления"); }
  };
  const updateProfile = async (name: string, professionalTitle: string) => {
    await saveAppData({ action: "updateProfile", name, professionalTitle });
    setProfile((current) => ({ ...current, name, professionalTitle }));
    setTeacherName(name);
    toast.success("Профиль сохранён");
  };
  const updateAvailability = async (windows: Array<{ weekday: number; start: string; end: string }>) => {
    await saveAppData({ action: "replaceAvailability", windows });
    await reload();
    toast.success("Рабочие часы сохранены");
  };

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Record<string, unknown>) => {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* Unsupported preview context. */ }
    };
    register({
      name: "read_day_schedule",
      title: "Расписание на день",
      description: "Показать занятия преподавателя на выбранную дату.",
      inputSchema: { type: "object", properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, required: ["date"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input: unknown) {
        const date = (input as { date?: unknown })?.date;
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Дата должна быть в формате ГГГГ-ММ-ДД");
        return { date, lessons: lessons.filter((lesson) => !lesson.past && lesson.date === date).map(({ time, end, name, label }) => ({ time, end, name, status: label })) };
      },
    });
    register({
      name: "create_lesson",
      title: "Добавить урок",
      description: "Создать новый разовый урок и добавить его в видимое расписание.",
      inputSchema: { type: "object", properties: { student: { type: "string", minLength: 2 }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, time: { type: "string", pattern: "^[0-2][0-9]:[0-5][0-9]$" } }, required: ["student", "date", "time"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        const { student, date, time } = input as { student?: unknown; date?: unknown; time?: unknown };
        if (typeof student !== "string" || student.trim().length < 2 || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Проверьте ученика, дату и время");
        const matches = students.filter((item) => item.name.toLocaleLowerCase("ru-RU") === student.trim().toLocaleLowerCase("ru-RU"));
        if (matches.length !== 1) throw new Error(matches.length ? "Уточните ученика: найдены тёзки" : "Ученик не найден");
        await saveAppData({ action: "createLesson", studentId: matches[0].id, date, time, repeat: "once" });
        await reload();
        return { status: "created", student: student.trim(), date, time };
      },
    });
    return () => lifecycle.abort();
  }, [lessons, reload, students]);

  if (loading) return <main className="grid min-h-screen place-items-center bg-background text-foreground"><div className="text-center"><BrandIcon className="mx-auto mb-3 size-12 animate-pulse" /><p className="font-semibold">Загружаю расписание…</p></div></main>;
  if (loadError) return <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Данные временно недоступны</h1><p className="mt-2 text-slate-500">Локальная база не ответила. Попробуйте ещё раз.</p><Button className="mt-5 bg-indigo-600" onClick={() => { setLoading(true); void reload().catch(() => { setLoadError(true); setLoading(false); }); }}>Повторить</Button></div></main>;
  const activeLessons = lessons.filter((lesson) => !lesson.past);
  const activeStudents = students.filter((student) => !student.archived);
  const portalStudent = students.find((student) => student.id === selectedStudent) ?? students[0];
  if (role === "student") return portalStudent
    ? <><StudentPortal student={portalStudent} teacherName={teacherName} lessons={lessons} entries={balanceEntries} historyEvents={historyEvents} requests={requests} notifications={notifications} availableSlots={availableSlots} onReadNotifications={markNotificationsRead} onRequest={submitStudentRequest} onMaterials={setMaterialsLesson} onBack={onLogout ?? (() => undefined)} onReload={reload} /><LessonMaterialsDialog key={materialsLesson?.id ?? "closed"} lesson={materialsLesson} role={role} onOpenChange={(open) => !open && setMaterialsLesson(null)} /></>
    : <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Кабинет ученика не найден</h1><p className="mt-2 text-slate-500">Аккаунт вошёл, но не связан с карточкой ученика. Попросите преподавателя создать новое приглашение.</p><Button className="mt-5" variant="outline" onClick={onLogout}>Выйти</Button></div></main>;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Sidebar view={view} setView={setView} name={profile.name} professionalTitle={profile.professionalTitle} onLogout={onLogout} requestCount={requests.length} notificationCount={notifications.filter((item) => !item.read).length} />
      <section className="min-h-screen pb-24 lg:ml-[272px] lg:pb-0">
        <MobileHeader name={profile.name} professionalTitle={profile.professionalTitle} notificationCount={notifications.filter((item) => !item.read).length} onNotifications={() => setView("notifications")} />
        {view === "today" && <TodayView lessons={activeLessons} students={activeStudents} requests={requests} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} onMaterials={setMaterialsLesson} setView={setView} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "calendar" && <CalendarView preferenceScope={preferenceScope} lessons={lessons} students={students.filter((student) => !student.archived)} showPastLessons={showPastLessons} pastLessonsLoading={pastLessonsLoading} onShowPastLessonsChange={changePastLessonsVisibility} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} onMaterials={setMaterialsLesson} onConvertTrial={convertTrialContact} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "students" && <StudentsView students={students} onAdd={addStudent} onOpen={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "student" && students.length > 0 && <StudentView student={students.find((student) => student.id === selectedStudent) ?? students[0]} lessons={activeLessons} recurringSlots={recurringSlots} balanceEntries={balanceEntries} historyEvents={historyEvents} onAdd={addLesson} onBack={() => setView("students")} onPay={addPayment} onAdjustBalance={adjustBalance} onReversePayment={reversePayment} onCreateInvite={createStudentInvite} onUpdate={updateStudent} onStopSeries={stopLessonSeries} onRestore={restoreStudent} onDeletePermanently={deleteStudentPermanently} onReload={reload} />}
        {view === "history" && <HistoryView events={historyEvents} students={students} onReversePayment={reversePayment} />}
        {view === "requests" && <RequestsView requests={requests} onResolved={reload} />}
        {view === "notifications" && <NotificationsView notifications={notifications} onRead={markNotificationsRead} onOpenRequests={() => setView("requests")} />}
        {view === "materials" && <TeacherMaterialsView />}
        {view === "settings" && <SettingsView profile={profile} availabilityWindows={availabilityWindows} onSave={updateProfile} onSaveAvailability={updateAvailability} onLogout={onLogout} isPlatformAdmin={Boolean(user?.isPlatformAdmin)} />}
      </section>
      <MobileNav view={view} setView={setView} />
      <LessonMaterialsDialog key={materialsLesson?.id ?? "closed"} lesson={materialsLesson} role={role} onOpenChange={(open) => !open && setMaterialsLesson(null)} />
      <Toaster position="top-right" richColors />
    </main>
  );
}
function Sidebar({ view, setView, name, professionalTitle, onLogout, requestCount, notificationCount }: { view: View; setView: (view: View) => void; name: string; professionalTitle: string; onLogout?: () => void; requestCount: number; notificationCount: number }) {
  const items = [
    { id: "today" as View, label: "Сегодня", icon: Home },
    { id: "calendar" as View, label: "Календарь", icon: CalendarDays },
    { id: "students" as View, label: "Ученики", icon: UsersRound },
    { id: "history" as View, label: "История", icon: HistoryIcon },
    { id: "requests" as View, label: "Запросы", icon: Bell, count: requestCount },
    { id: "notifications" as View, label: "Уведомления", icon: Bell, count: notificationCount },
    { id: "materials" as View, label: "Материалы", icon: FolderOpen },
    { id: "settings" as View, label: "Настройки", icon: Settings },
  ];
  return <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-slate-200 bg-white lg:flex">
    <div className="border-b border-slate-200 px-7 py-7"><div className="flex items-center gap-3"><BrandIcon className="size-11 shadow-lg" /><div className="min-w-0">{professionalTitle && <p className="truncate text-sm font-medium text-slate-500">{professionalTitle}</p>}<p className="truncate text-xl font-bold tracking-tight">{name}</p></div></div></div>
    <nav className="flex-1 space-y-2 p-5" aria-label="Основная навигация">{items.map(({ id, label, icon: Icon, count }) => <button key={label} onClick={() => setView(id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-base font-medium transition ${view === id || (id === "students" && view === "student") ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon className="size-5" /><span>{label}</span>{count ? <span className="ml-auto rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white">{count}</span> : null}</button>)}</nav>
    <div className="border-t border-slate-200 p-5"><ThemeToggle /><button onClick={onLogout} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm text-slate-600 hover:bg-slate-50"><LogOut className="size-5" />Выйти</button></div>
  </aside>;
}

function MobileHeader({ name, professionalTitle, notificationCount, onNotifications }: { name: string; professionalTitle: string; notificationCount: number; onNotifications: () => void }) {
  return <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden"><div className="flex min-w-0 items-center gap-2.5"><BrandIcon className="size-9" /><div className="min-w-0">{professionalTitle && <p className="truncate text-[11px] text-slate-500">{professionalTitle}</p>}<p className="truncate font-bold">{name}</p></div></div><div className="flex items-center gap-2"><ThemeToggle compact /><button onClick={onNotifications} aria-label="Уведомления" className="relative grid size-10 place-items-center rounded-xl border border-slate-200"><Bell className="size-5" />{notificationCount > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-rose-500" />}</button></div></header>;
}

function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  const items = [{ id: "today" as View, label: "Сегодня", icon: Home }, { id: "calendar" as View, label: "Календарь", icon: CalendarDays }, { id: "students" as View, label: "Ученики", icon: UsersRound }, { id: "history" as View, label: "История", icon: HistoryIcon }, { id: "requests" as View, label: "Запросы", icon: Bell }, { id: "materials" as View, label: "Материалы", icon: FolderOpen }, { id: "settings" as View, label: "Настройки", icon: Settings }];
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-slate-200 bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden" aria-label="Мобильная навигация">{items.map(({ id, label, icon: Icon }) => { const active = view === id || id === "students" && view === "student"; return <button key={label} onClick={() => setView(id)} aria-label={label} title={label} className={`flex min-h-14 items-center justify-center rounded-xl transition ${active ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"}`}><Icon className="size-5 sm:size-6" /><span className="sr-only">{label}</span></button>; })}</nav>;
}

function StudentsView({ students, onAdd, onOpen }: { students: Student[]; onAdd: (student: StudentDraft) => Promise<boolean>; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("Все");
  const filtered = useMemo(() => students.filter((student) => student.name.toLowerCase().includes(query.toLowerCase()) && (filter === "Архив" ? student.archived : !student.archived && (filter === "Все" || filter === "Плавающее" && student.floating || filter === "Постоянное" && !student.floating || filter === "Задолженность" && student.balance < 0 || filter === "Без урока" && student.next === "Не назначен"))), [students, query, filter]);
  return <Shell title="Ученики" actions={<AddStudentSheet onAdd={onAdd} />}><div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="relative max-w-md flex-1"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени" className="h-12 rounded-xl bg-white pl-11" /></div><div className="flex gap-2 overflow-x-auto pb-1">{["Все", "Постоянное", "Плавающее", "Задолженность", "Без урока", "Архив"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${filter === item ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>{item}</button>)}</div></div><div className="card overflow-hidden"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="px-5">Ученик</TableHead><TableHead>Расписание</TableHead><TableHead>Следующий урок</TableHead><TableHead>Баланс</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((student) => <TableRow key={student.id} onClick={() => onOpen(student.id)} className="student-table-row cursor-pointer"><TableCell className="px-5 py-5"><span className="flex items-center gap-3"><MemberAvatar name={student.name} initials={student.initials} color={student.avatarColor} url={student.avatarUrl} className="size-10 text-sm" /><span><strong className="block">{student.name}</strong>{student.archived && <span className="text-xs text-slate-500">В архиве</span>}</span></span></TableCell><TableCell><span className="text-slate-600">{student.schedule === "Постоянное расписание не задано" ? "Постоянное" : student.schedule}</span></TableCell><TableCell className={student.next === "Не назначен" ? "text-amber-700" : "text-slate-600"}>{student.next}</TableCell><TableCell><Balance balance={student.balance} /></TableCell><TableCell><ChevronRight className="size-5 text-slate-400" /></TableCell></TableRow>)}</TableBody></Table>{!filtered.length && <Empty text="Ученики не найдены" />}</div></Shell>;
}

function Balance({ balance }: { balance: number }) { return <span className={`inline-flex min-w-12 justify-center rounded-xl px-3 py-2 font-bold ${balance < 0 ? "bg-rose-50 text-rose-700" : balance <= 1 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{balance}</span>; }

function StudentView({ student, lessons, recurringSlots, balanceEntries, historyEvents, onAdd, onBack, onPay, onAdjustBalance, onReversePayment, onCreateInvite, onUpdate, onStopSeries, onRestore, onDeletePermanently, onReload }: { student: Student; lessons: Lesson[]; recurringSlots: RecurringSlot[]; balanceEntries: BalanceEntry[]; historyEvents: HistoryEvent[]; onAdd: (lesson: LessonDraft) => Promise<boolean>; onBack: () => void; onPay: (id: string, count: number, date: string) => Promise<boolean>; onAdjustBalance: (id: string, units: number, note: string) => Promise<boolean>; onReversePayment: (id: string) => Promise<boolean>; onCreateInvite: (id: string) => Promise<string>; onUpdate: (student: Pick<Student, "id" | "name" | "email" | "canViewAvailability">) => Promise<boolean>; onStopSeries: (id: string) => Promise<boolean>; onRestore: (id: string) => Promise<boolean>; onDeletePermanently: (id: string) => Promise<boolean>; onReload: () => Promise<void> }) {
  const history = balanceEntries.filter((entry) => entry.studentId === student.id);
  const studentHistory = historyEvents.filter((event) => event.studentId === student.id);
  const studentSlots = recurringSlots.filter((slot) => slot.studentId === student.id);
  const nextStudentLesson = lessons.find((lesson) => lesson.studentId === student.id && lesson.date >= today());
  if (student.archived) return <Shell title={student.name} eyebrow="Архив" actions={<StudentArchiveActions student={student} onRestore={onRestore} onDeletePermanently={onDeletePermanently} />}><button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600"><ArrowLeft className="size-4" />Назад к ученикам</button><div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900"><strong className="block">Ученик находится в архиве</strong><span className="mt-1 block text-sm">Новые уроки и оплаты недоступны, но история сохранена. Ученика можно восстановить.</span></div><div className={`mb-5 rounded-2xl border p-4 ${student.balance < 0 ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}><strong>Баланс на момент архивации: {plural(student.balance, "занятие", "занятия", "занятий")}</strong></div><Tabs defaultValue="history"><TabsList variant="line" className="mb-5 max-w-full overflow-x-auto"><TabsTrigger value="history">История</TabsTrigger><TabsTrigger value="payments">Оплаты</TabsTrigger></TabsList><TabsContent value="history"><HistoryTimeline events={studentHistory} showStudent={false} onReversePayment={onReversePayment} /></TabsContent><TabsContent value="payments"><BalanceHistory entries={history.filter((entry) => entry.kind === "payment" || entry.kind === "refund" || entry.kind === "adjustment")} onReversePayment={onReversePayment} /></TabsContent></Tabs></Shell>;
  return <Shell title={student.name} eyebrow={student.floating ? "Плавающее расписание" : "Постоянное расписание"} actions={<div className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap [&>button]:w-full sm:[&>button]:w-auto"><EditStudentDialog student={student} onUpdate={onUpdate} />{student.email && <InviteStudentDialog student={student} onCreateInvite={onCreateInvite} />}{student.accountStatus === "active" && <MessagesDialog initialPeerId={student.id} label="Написать ученику" />}<AddLessonDialog students={[student]} defaultDate={today()} onAdd={onAdd} compact /><PaymentDialog student={student} onPay={onPay} /><BalanceAdjustmentDialog student={student} onAdjust={onAdjustBalance} /></div>}><button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600"><ArrowLeft className="size-4" />Назад к ученикам</button><div className={`mb-5 rounded-2xl border p-4 ${student.balance < 0 ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}><strong>Баланс: {plural(student.balance, "занятие", "занятия", "занятий")}</strong>{student.balance < 0 && <span className="ml-2 text-sm">Необходимо оплатить {plural(Math.abs(student.balance), "занятие", "занятия", "занятий")}</span>}</div><Tabs defaultValue="overview"><TabsList variant="line" className="mb-5 max-w-full overflow-x-auto"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="lessons">Будущие уроки</TabsTrigger><TabsTrigger value="history">История</TabsTrigger><TabsTrigger value="payments">Оплаты</TabsTrigger></TabsList><TabsContent value="overview"><div className="grid gap-5 md:grid-cols-2"><InfoCard title="Следующий урок" icon={CalendarDays}><p className="text-2xl font-bold">{student.next}</p><p className="mt-1 text-slate-500">{nextStudentLesson?.units === 2 ? "Двойной урок: 2 часа" : "Продолжительность: 1 час"}</p></InfoCard><InfoCard title="Расписание" icon={Clock3}><p className="text-lg font-bold">{student.floating ? "Регулярного расписания нет" : student.schedule}</p>{studentSlots.length ? <div className="mt-4 space-y-2">{studentSlots.map((slot) => <div key={slot.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><span>{slot.label}{slot.durationMinutes === 120 ? " · двойной" : ""}</span><StopSeriesDialog slot={slot} onStop={onStopSeries} /></div>)}</div> : <p className="mt-1 text-slate-500">{student.floating ? "Следующий урок назначается отдельно" : "Постоянные занятия не заданы"}</p>}</InfoCard><StudentAvailabilityAccessCard student={student} onUpdate={onUpdate} /><StudentAvatarPreferenceCard studentId={student.id} name={student.name} initials={student.initials} avatarColor={student.avatarColor} ownAvatarColor={student.ownAvatarColor} avatarUrl={student.avatarUrl} onChanged={onReload} /></div></TabsContent><TabsContent value="lessons"><div className="card p-5"><LessonList lessons={lessons.filter((lesson) => lesson.studentId === student.id && lesson.date >= today())} /></div></TabsContent><TabsContent value="history"><HistoryTimeline events={studentHistory} showStudent={false} onReversePayment={onReversePayment} /></TabsContent><TabsContent value="payments"><BalanceHistory entries={history.filter((entry) => entry.kind === "payment" || entry.kind === "refund" || entry.kind === "adjustment")} onReversePayment={onReversePayment} /></TabsContent></Tabs></Shell>;
}

function StudentArchiveActions({ student, onRestore, onDeletePermanently }: { student: Student; onRestore: (id: string) => Promise<boolean>; onDeletePermanently: (id: string) => Promise<boolean> }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const restore = async () => { setPending(true); await onRestore(student.id); setPending(false); };
  const remove = async () => { setPending(true); const deleted = await onDeletePermanently(student.id); setPending(false); if (deleted) setDeleteOpen(false); };
  return <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row"><Button variant="outline" disabled={pending} onClick={() => void restore()}>Восстановить ученика</Button><Dialog open={deleteOpen} onOpenChange={(next) => { setDeleteOpen(next); if (!next) setConfirmation(""); }}><DialogTrigger asChild><Button variant="destructive">Удалить навсегда</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Окончательно удалить ученика?</DialogTitle><DialogDescription>Будут безвозвратно удалены уроки, оплаты, запросы, уведомления и история ученика. Для подтверждения введите его имя полностью.</DialogDescription></DialogHeader><Field label={`Введите: ${student.name}`}><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></Field><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setDeleteOpen(false)}>Отмена</Button><Button variant="destructive" disabled={pending || confirmation.trim() !== student.name} onClick={() => void remove()}>{pending ? "Удаляю…" : "Удалить безвозвратно"}</Button></DialogFooter></DialogContent></Dialog></div>;
}

function StopSeriesDialog({ slot, onStop }: { slot: RecurringSlot; onStop: (id: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [pending, setPending] = useState(false);
  const stop = async () => { setPending(true); const saved = await onStop(slot.id); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">Остановить</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle>Остановить постоянное занятие?</DialogTitle><DialogDescription>{slot.label}. Все будущие уроки этого времени будут отменены без списания. Уже проведённые занятия сохранятся в истории.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button variant="destructive" disabled={pending} onClick={() => void stop()}>{pending ? "Останавливаю…" : "Остановить расписание"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EditStudentDialog({ student, onUpdate }: { student: Student; onUpdate: (student: Pick<Student, "id" | "name" | "email" | "canViewAvailability">) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [firstName, ...surnameParts] = student.name.split(/\s+/);
  const [name, setName] = useState(firstName ?? "");
  const [surname, setSurname] = useState(surnameParts.join(" "));
  const [email, setEmail] = useState(student.email ?? "");
  const [canViewAvailability, setCanViewAvailability] = useState(student.canViewAvailability);
  const [pending, setPending] = useState(false);
  const changeOpen = (next: boolean) => { setOpen(next); if (next) { const [first, ...rest] = student.name.split(/\s+/); setName(first ?? ""); setSurname(rest.join(" ")); setEmail(student.email ?? ""); setCanViewAvailability(student.canViewAvailability); } };
  const submit = async () => {
    setPending(true);
    const saved = await onUpdate({ id: student.id, name: [name.trim(), surname.trim()].filter(Boolean).join(" "), email: email.trim() || undefined, canViewAvailability });
    setPending(false);
    if (saved) setOpen(false);
  };
  const archive = async () => {
    setPending(true);
    try {
      await saveAppData({ action: "archiveStudent", studentId: student.id });
      toast.success("Ученик перемещён в архив");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось архивировать ученика");
      setPending(false);
    }
  };
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button variant="outline" className="h-11 rounded-xl"><Pencil />Изменить данные</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Данные ученика</DialogTitle><DialogDescription>Имя обязательно. Email нужен только для личного кабинета ученика.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Имя *"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></Field><Field label="Фамилия"><Input value={surname} onChange={(event) => setSurname(event.target.value)} maxLength={80} /></Field></div><Field label="Email"><Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Необязательно" readOnly={student.accountStatus === "active"} /></Field>{student.accountStatus === "active" && <p className="text-sm text-slate-500">Email уже связан со входом ученика и здесь не изменяется.</p>}<label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4"><Checkbox checked={canViewAvailability} onCheckedChange={(checked) => setCanViewAvailability(checked === true)} /><span><strong className="block">Показывать свободные слоты</strong><span className="mt-1 block text-sm text-slate-500">Ученик сможет видеть рабочие свободные часы и отправлять запрос на выбранное время.</span></span></label><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><strong className="block text-amber-900">Архив</strong><p className="mt-1 text-sm text-amber-800">Будущие уроки будут отменены, а история и оплаты сохранятся. Ученика можно восстановить.</p><Button variant="outline" className="mt-3 border-amber-300 bg-white text-amber-900" disabled={pending} onClick={() => void archive()}>Переместить в архив</Button></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button className="bg-indigo-600" disabled={pending || !name.trim()} onClick={() => void submit()}>{pending ? "Сохраняю…" : "Сохранить"}</Button></DialogFooter></DialogContent></Dialog>;
}

function InviteStudentDialog({ student, onCreateInvite }: { student: Student; onCreateInvite: (id: string) => Promise<string> }) {
  const [open, setOpen] = useState(false); const [url, setUrl] = useState(""); const [pending, setPending] = useState(false);
  const active = student.accountStatus === "active";
  const prepare = async () => { setOpen(true); setPending(true); setUrl(""); try { setUrl(active ? window.location.origin : await onCreateInvite(student.id)); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось подготовить ссылку"); setOpen(false); } finally { setPending(false); } };
  const copy = async () => { await navigator.clipboard.writeText(url); toast.success("Ссылка скопирована — отправьте её ученику"); };
  const share = async () => { if (navigator.share) await navigator.share({ title: active ? `Кабинет ученика — ${student.name}` : `Приглашение для ${student.name}`, text: active ? "Ссылка для входа в кабинет ученика:" : "Войдите в кабинет ученика по ссылке:", url }); else await copy(); };
  return <Dialog open={open} onOpenChange={setOpen}><Button variant="outline" className="h-11 rounded-xl" onClick={() => void prepare()}><Send />{active ? "Отправить ссылку на кабинет" : "Пригласить ученика"}</Button><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>{active ? `Кабинет ученика — ${student.name}` : `Пригласить ${student.name}`}</DialogTitle><DialogDescription>{active ? "Отправьте ученику ссылку на вход. Он войдёт с уже созданными email и паролем." : "Отправьте эту персональную ссылку ученику в Telegram, WhatsApp, почте или другом удобном месте. По ней ученик задаст пароль и войдёт в свой кабинет."}</DialogDescription></DialogHeader>{pending ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">Готовим ссылку…</p> : <><Field label={active ? "Ссылка на кабинет" : "Персональная ссылка"}><Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></Field><p className="text-sm text-slate-500">{active ? "Это обычная ссылка на вход, она не меняет пароль и не создаёт новое приглашение." : "Ссылка действует 14 дней. Создание новой ссылки отключит предыдущую."}</p></>}<DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Закрыть</Button><Button variant="outline" disabled={!url} onClick={() => void copy()}><Copy />Скопировать ссылку</Button><Button disabled={!url} className="bg-indigo-600" onClick={() => void share()}><Send />Отправить</Button></DialogFooter></DialogContent></Dialog>;
}

function InfoCard({ title, icon: Icon, children }: { title: string; icon: typeof CalendarDays; children: React.ReactNode }) { return <section className="card p-6"><div className="mb-5 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="size-5" /></span><h2 className="text-lg font-bold">{title}</h2></div>{children}</section>; }

function AddStudentSheet({ onAdd }: { onAdd: (student: StudentDraft) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [email, setEmail] = useState(""); const [floating, setFloating] = useState("floating"); const [weekday, setWeekday] = useState("2"); const [time, setTime] = useState("17:00"); const [pending, setPending] = useState(false);
  const submit = async () => {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    if (!name) return;
    setPending(true);
    const saved = await onAdd({ name, email: email.trim() || undefined, floating: floating === "floating", weekday: floating === "fixed" ? Number(weekday) : undefined, time: floating === "fixed" ? time : undefined });
    setPending(false);
    if (saved) { setOpen(false); setFirstName(""); setLastName(""); setEmail(""); setFloating("floating"); setWeekday("2"); setTime("17:00"); }
  };
  const fixed = floating === "fixed";
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button size="lg" className="h-11 rounded-xl bg-indigo-600"><Plus />Добавить ученика</Button></SheetTrigger><SheetContent className="w-full gap-0 sm:max-w-lg"><SheetHeader className="border-b p-6"><SheetTitle className="text-2xl">Новый ученик</SheetTitle><SheetDescription>Создайте карточку ученика для расписания и учёта оплат.</SheetDescription></SheetHeader><div className="flex-1 space-y-5 overflow-y-auto p-6"><Field label="Имя *"><Input aria-label="Имя" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Имя ученика" required className="h-11 rounded-xl" /></Field><Field label="Фамилия"><Input aria-label="Фамилия" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Необязательно" className="h-11 rounded-xl" /></Field><Field label="Email"><Input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Необязательно" className="h-11 rounded-xl" /></Field><Field label="Тип расписания"><Select value={floating} onValueChange={setFloating}><SelectTrigger aria-label="Тип расписания" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Постоянное</SelectItem><SelectItem value="floating">Плавающее</SelectItem></SelectContent></Select></Field>{fixed && <div className="grid gap-4 sm:grid-cols-2"><Field label="День недели"><Select value={weekday} onValueChange={setWeekday}><SelectTrigger aria-label="День недели" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{[[1, "Понедельник"], [2, "Вторник"], [3, "Среда"], [4, "Четверг"], [5, "Пятница"], [6, "Суббота"], [7, "Воскресенье"]].map(([value, label]) => <SelectItem key={value} value={String(value)}>{label}</SelectItem>)}</SelectContent></Select></Field><Field label="Время"><TimeField value={time} onChange={setTime} /></Field></div>}<div className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-800">Email нужен только для личного кабинета ученика. Расписание, занятия и оплаты можно вести без него.</div></div><SheetFooter className="border-t p-5"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={!firstName.trim() || pending || (fixed && (!weekday || !time))} onClick={() => void submit()} className="bg-indigo-600">{pending ? "Создаю…" : "Создать ученика"}</Button></SheetFooter></SheetContent></Sheet>;
}

function PaymentDialog({ student, onPay }: { student: Student; onPay: (id: string, count: number, date: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [count, setCount] = useState(1); const [paymentDate, setPaymentDate] = useState(today); const [pending, setPending] = useState(false);
  const submit = async () => { setPending(true); const saved = await onPay(student.id, count, paymentDate); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="lg" className="h-11 rounded-xl bg-indigo-600"><Plus />Добавить оплату</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">Добавить оплату</DialogTitle><DialogDescription>{student.name}</DialogDescription></DialogHeader><div className={`rounded-2xl p-4 font-semibold ${student.balance < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-700"}`}>Текущий баланс: {plural(student.balance, "занятие", "занятия", "занятий")}</div><Field label="Количество занятий"><Input aria-label="Количество занятий" type="number" min="1" max="100" value={count} onChange={(event) => setCount(Number(event.target.value))} className="h-11 rounded-xl" /></Field><Field label="Дата оплаты"><Input aria-label="Дата оплаты" type="date" max={today()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="h-11 rounded-xl" /></Field><div className="rounded-2xl bg-emerald-50 p-4 text-emerald-800">После оплаты баланс составит <strong>{plural(student.balance + count, "занятие", "занятия", "занятий")}</strong></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !Number.isInteger(count) || count < 1 || !paymentDate} onClick={() => void submit()} className="bg-indigo-600">{pending ? "Сохраняю…" : "Добавить оплату"}</Button></DialogFooter></DialogContent></Dialog>;
}

function BalanceAdjustmentDialog({ student, onAdjust }: { student: Student; onAdjust: (id: string, units: number, note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [units, setUnits] = useState(-2); const [note, setNote] = useState("Долг до начала работы в приложении"); const [pending, setPending] = useState(false);
  const submit = async () => { setPending(true); const saved = await onAdjust(student.id, units, note.trim()); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="lg" variant="outline" className="h-11 rounded-xl"><Minus />Корректировать баланс</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">Корректировка баланса</DialogTitle><DialogDescription>{student.name}. Используйте отрицательное число для долга и положительное — для добавления занятий без оплаты.</DialogDescription></DialogHeader><div className={`rounded-2xl p-4 font-semibold ${student.balance < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-700"}`}>Текущий баланс: {plural(student.balance, "занятие", "занятия", "занятий")}</div><Field label="Изменение"><Input aria-label="Изменение баланса" type="number" min="-100" max="100" value={units} onChange={(event) => setUnits(Number(event.target.value))} className="h-11 rounded-xl" /></Field><Field label="Причина"><Input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="Например: долг до начала работы в приложении" /></Field><div className={`rounded-2xl p-4 ${student.balance + units < 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>После корректировки баланс составит <strong>{plural(student.balance + units, "занятие", "занятия", "занятий")}</strong></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !Number.isInteger(units) || units === 0 || units < -100 || units > 100 || note.trim().length < 3} onClick={() => void submit()} className="bg-indigo-600">{pending ? "Сохраняю…" : "Сохранить корректировку"}</Button></DialogFooter></DialogContent></Dialog>;
}
