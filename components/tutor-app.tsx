"use client";
/* eslint-disable @next/next/no-img-element -- protected lesson photos are already resized server-side and require the viewer's session cookie. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Bell, CalendarDays, Camera, ChevronLeft, ChevronRight, Clock3, Copy,
  Download, FileText, FolderOpen, History as HistoryIcon, Home, LayoutGrid, Link2, LogOut, Minus, NotebookPen, Pencil, Plus, RefreshCw, Rows3, Search, Send, Settings, ShieldCheck, Tag, Trash2, Unlink, Upload, UserRound, UsersRound, WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { AppCard, AppCardDescription, AppCardTitle } from "@/components/common/app-card";
import { AppShell as Shell } from "@/components/common/app-shell";
import { ShowMoreButton } from "@/components/common/show-more-button";
import { StudentAvailabilityAccessCard } from "@/components/features/students/student-availability-access-card";
import { BalanceHistory, HistoryTimeline } from "@/components/features/history/history-lists";
import { HistoryView } from "@/components/features/history/history-view";
import { NotificationsView } from "@/components/features/notifications/notifications-view";
import { RequestsView } from "@/components/features/requests/requests-view";
import type { AppData, AppNotification, AvailabilityWindow, AvailableSlot, BalanceEntry, CurrentUser, HistoryEvent, Lesson, LessonDraft, LessonMaterialsData, LessonRequest, RecurringSlot, Student, StudentDraft, StudentRequestDraft, TeacherMaterial, TeacherMaterialsData, TelegramStatus, View } from "@/components/features/app/types";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { MemberAvatar, MessagesCard, MessagesDialog, ProfilePersonalizationCard, StudentAvatarPreferenceCard } from "@/components/features/account";
import { minutesToInputTime } from "@/lib/availability";
import { readAppData, saveAppData } from "@/lib/app-data-client";
import { appFetch } from "@/lib/client-fetch";
import { dateAtNoon, dateTitle, moscowDate, moscowTime, shiftDate, shiftMonth, today, toIsoDate } from "@/lib/date-time";
import { syncDelayForVisibility } from "@/lib/incremental-sync";
import { russianPlural as plural } from "@/lib/russian-plural";

async function readLessonMaterials(lessonId: string) {
  const response = await appFetch(`/api/lesson-materials?lessonId=${encodeURIComponent(lessonId)}`, { cache: "no-store" });
  const result = await response.json() as LessonMaterialsData & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить материалы урока");
  return result;
}

async function saveLessonMaterial(body: Record<string, unknown>) {
  const response = await appFetch("/api/lesson-materials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить материалы урока");
}

async function readTeacherMaterials() {
  const response = await appFetch("/api/teacher-materials", { cache: "no-store" });
  const result = await response.json() as TeacherMaterialsData & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить библиотеку");
  return result;
}

const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ` : `${Math.max(0, Math.round(bytes / 1024))} КБ`;

const statusStyles = {
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  low: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  debt: "bg-rose-50 text-rose-700 ring-rose-100",
  request: "bg-amber-50 text-amber-700 ring-amber-100",
  trial: "bg-sky-50 text-sky-700 ring-sky-100",
};

const preferenceKey = (scope: string, name: string) => `tutor-platform:${scope}:${name}`;
const readPreference = (key: string) => typeof window === "undefined" ? null : window.localStorage.getItem(key);
const writePreference = (key: string, value: string) => { if (typeof window !== "undefined") window.localStorage.setItem(key, value); };

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

function TodayView({ lessons, students, requests, onAdd, onUpdate, onDelete, onMaterials, setView, onOpenStudent }: { lessons: Lesson[]; students: Student[]; requests: LessonRequest[]; onAdd: (lesson: LessonDraft) => Promise<boolean>; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>; onMaterials: (lesson: Lesson) => void; setView: (view: View) => void; onOpenStudent: (id: string) => void }) {
  const [selectedDate, setSelectedDate] = useState(today);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const selectedLessons = lessons.filter((lesson) => lesson.date === selectedDate);
  const todayDate = today();
  const debtCount = students.filter((student) => student.balance < 0).length;
  const withoutLessonCount = students.filter((student) => student.next === "Не назначен").length;
  const nextLesson = lessons.filter((lesson) => `${lesson.date}T${lesson.time}` >= `${todayDate}T${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" })}`).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  const relative = selectedDate === todayDate ? "Сегодня" : selectedDate === shiftDate(todayDate, 1) ? "Завтра" : selectedDate === shiftDate(todayDate, -1) ? "Вчера" : "Расписание";
  return <Shell eyebrow="Ваш рабочий день" title={`${relative}, ${dateTitle(selectedDate)}`} actions={<div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 sm:flex sm:w-auto sm:flex-wrap"><div className="flex min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><button onClick={() => setSelectedDate((date) => shiftDate(date, -1))} aria-label="Предыдущий день" className="grid size-11 shrink-0 place-items-center hover:bg-slate-50"><ChevronLeft className="size-5" /></button><button onClick={() => setSelectedDate(todayDate)} className="min-w-0 flex-1 truncate whitespace-nowrap border-x border-slate-200 px-2 text-sm font-semibold sm:px-4">{dateTitle(selectedDate, { day: "numeric", month: "long", year: "numeric" })}</button><button onClick={() => setSelectedDate((date) => shiftDate(date, 1))} aria-label="Следующий день" className="grid size-11 shrink-0 place-items-center hover:bg-slate-50"><ChevronRight className="size-5" /></button></div><AddLessonDialog compact students={students} defaultDate={selectedDate} onAdd={onAdd} /></div>}>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]"><section className="card p-4 md:p-7"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold md:text-2xl">Расписание на день</h2><p className="mt-1 text-sm text-slate-500">{plural(selectedLessons.reduce((sum, lesson) => sum + lesson.units, 0), "занятие", "занятия", "занятий")} · нажмите на урок для управления</p></div><button onClick={() => setView("calendar")} className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 md:block">Открыть календарь</button></div><LessonList lessons={selectedLessons} onSelect={setEditing} onMaterials={onMaterials} /></section>
      <aside className="space-y-6"><section className="card p-5 md:p-6"><h2 className="mb-4 text-xl font-bold">Требуют внимания</h2>{requests.length > 0 && <Attention icon={Bell} tone="rose" title={plural(requests.length, "запрос", "запроса", "запросов")} text="ожидают решения" onClick={() => setView("requests")} />}{debtCount > 0 && <Attention icon={UserRound} tone="rose" title={plural(debtCount, "ученик", "ученика", "учеников")} text="с задолженностью" onClick={() => setView("students")} />}{withoutLessonCount > 0 && <Attention icon={Clock3} tone="amber" title={plural(withoutLessonCount, "ученик", "ученика", "учеников")} text="без следующего урока" onClick={() => setView("students")} />}{requests.length === 0 && debtCount === 0 && withoutLessonCount === 0 && <p className="py-4 text-sm text-slate-500">Всё в порядке — ничего срочного.</p>}</section><section className="rounded-[24px] bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-200/70"><p className="text-sm font-semibold text-indigo-100">Ближайший урок</p>{nextLesson ? <><p className="mt-3 text-2xl font-bold">{nextLesson.name} · {nextLesson.time}</p><p className="mt-1 text-sm text-indigo-100">{dateTitle(nextLesson.date, { weekday: "long", day: "numeric", month: "long" })}</p><button onClick={() => onOpenStudent(nextLesson.studentId)} className="mt-5 w-full rounded-xl bg-white/15 px-4 py-3 text-sm font-semibold hover:bg-white/20">Открыть карточку</button></> : <p className="mt-3 text-indigo-100">Будущих уроков пока нет</p>}</section></aside></div>
    <EditLessonDialog key={editing?.id ?? "today-no-lesson"} lesson={editing} onOpenChange={(open) => !open && setEditing(null)} onUpdate={onUpdate} onDelete={onDelete} onMaterials={onMaterials} onOpenStudent={(studentId) => { setEditing(null); onOpenStudent(studentId); }} />
  </Shell>;
}

function LessonList({ lessons, onSelect, onMaterials, onOpenStudent, onConvertTrial, showActions = false }: { lessons: Lesson[]; onSelect?: (lesson: Lesson) => void; onMaterials?: (lesson: Lesson) => void; onOpenStudent?: (studentId: string) => void; onConvertTrial?: (studentId: string) => Promise<boolean>; showActions?: boolean }) {
  return <div className="space-y-3">{lessons.length ? lessons.map((lesson) => <div key={lesson.id} className={`group overflow-hidden rounded-2xl border border-slate-200 transition ${lesson.past ? "opacity-75" : "hover:border-indigo-200 hover:shadow-md"}`}>
    <button type="button" disabled={lesson.past || !onSelect} onClick={() => !lesson.past && onSelect?.(lesson)} className={`grid w-full grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-3 p-3 text-left md:grid-cols-[74px_minmax(0,1fr)_auto] md:p-4 ${lesson.past || !onSelect ? "cursor-default" : "hover:bg-indigo-50/40"}`}>
      <span className="text-sm font-semibold leading-5 text-slate-700"><span className="block">{lesson.time}</span><span className="block font-normal text-slate-400">{lesson.end}</span></span>
      <span className="min-w-0 border-l border-slate-200 pl-3 md:pl-5"><span className="block truncate text-base font-bold md:text-lg">{lesson.name}</span><span className="mt-0.5 block truncate text-sm text-slate-500">{lesson.lessonType === "trial" ? "Пробное занятие · бесплатно" : lesson.units === 2 ? "Двойной урок · 2 занятия" : "Барабаны · Студия"}</span><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 sm:hidden ${statusStyles[lesson.status]}`}>{lesson.label}</span></span>
      <span className="flex items-center gap-2"><span className={`hidden rounded-full px-3 py-1.5 text-xs font-semibold ring-1 sm:inline-flex ${statusStyles[lesson.status]}`}>{lesson.label}</span>{onSelect && !lesson.past && !showActions && <ChevronRight className="size-5 text-slate-400" />}</span>
    </button>
    {(showActions || onMaterials) && <div className="flex flex-col gap-2 border-t border-slate-200 p-3 sm:flex-row sm:justify-end">{lesson.trialContact && onConvertTrial ? <Button type="button" size="sm" variant="outline" onClick={() => void onConvertTrial(lesson.studentId)}><UserRound />Создать ученика</Button> : showActions && onOpenStudent && <Button type="button" size="sm" variant="outline" onClick={() => onOpenStudent(lesson.studentId)}><UserRound />Открыть ученика</Button>}{onMaterials && <Button type="button" size="sm" variant="outline" onClick={() => onMaterials(lesson)}><NotebookPen />Материалы</Button>}{showActions && onSelect && !lesson.past && <Button type="button" size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => onSelect(lesson)}><Pencil />Внести изменения</Button>}</div>}
  </div>) : <Empty text="На этот день уроков нет" />}</div>;
}

function Attention({ icon: Icon, tone, title, text, onClick }: { icon: typeof Bell; tone: "rose" | "amber"; title: string; text: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-slate-50"><span className={`grid size-11 place-items-center rounded-xl ${tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}><Icon className="size-5" /></span><span><span className="block text-sm font-bold">{title}</span><span className="block text-sm text-slate-500">{text}</span></span><ChevronRight className="ml-auto size-4 text-slate-400" /></button>;
}

function CalendarView({ preferenceScope, lessons, students, showPastLessons, pastLessonsLoading, onShowPastLessonsChange, onAdd, onUpdate, onDelete, onMaterials, onConvertTrial, onOpenStudent }: { preferenceScope: string; lessons: Lesson[]; students: Student[]; showPastLessons: boolean; pastLessonsLoading: boolean; onShowPastLessonsChange: (show: boolean) => Promise<void>; onAdd: (lesson: LessonDraft) => Promise<boolean>; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>; onMaterials: (lesson: Lesson) => void; onConvertTrial: (id: string) => Promise<boolean>; onOpenStudent: (id: string) => void }) {
  const [mode, setMode] = useState<"day" | "week" | "month">(() => {
    const savedMode = readPreference(preferenceKey(preferenceScope, "calendar-mode"));
    return savedMode === "day" || savedMode === "week" || savedMode === "month" ? savedMode : "month";
  });
  const [cursor, setCursor] = useState(today);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const changeMode = (nextMode: "day" | "week" | "month") => { setMode(nextMode); writePreference(preferenceKey(preferenceScope, "calendar-mode"), nextMode); };
  const cursorDate = dateAtNoon(cursor);
  const monthStart = new Date(Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth(), 1, 12));
  const gridStart = new Date(monthStart); gridStart.setUTCDate(gridStart.getUTCDate() - ((gridStart.getUTCDay() + 6) % 7));
  const monthDays = Array.from({ length: 42 }, (_, index) => shiftDate(toIsoDate(gridStart), index));
  const weekStart = shiftDate(cursor, -((cursorDate.getUTCDay() + 6) % 7));
  const visibleDates = mode === "day" ? [cursor] : Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const move = (direction: number) => setCursor((date) => mode === "day" ? shiftDate(date, direction) : mode === "week" ? shiftDate(date, direction * 7) : shiftMonth(date, direction));
  const title = mode === "month" ? dateTitle(cursor, { month: "long", year: "numeric" }) : mode === "week" ? `${dateTitle(visibleDates[0])} — ${dateTitle(visibleDates[6], { day: "numeric", month: "long", year: "numeric" })}` : dateTitle(cursor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const visibleLessons = showPastLessons ? lessons : lessons.filter((lesson) => !lesson.past);
  const selectedLessons = selectedDate ? visibleLessons.filter((lesson) => lesson.date === selectedDate) : [];

  return <Shell title="Календарь" actions={<AddLessonDialog students={students} defaultDate={cursor} onAdd={onAdd} />}>
    <div className="card calendar-surface overflow-hidden">
      <div className="flex flex-col items-center gap-4 border-b border-slate-200 p-4 lg:flex-row lg:justify-between md:p-6">
        <div className="flex w-full flex-col items-center gap-4 lg:w-auto lg:flex-row lg:flex-wrap"><div className="flex rounded-xl bg-slate-100 p-1">{(["day", "week", "month"] as const).map((item) => <button key={item} onClick={() => changeMode(item)} className={`rounded-lg px-4 py-2 text-sm ${mode === item ? "bg-white font-semibold text-indigo-700 shadow-sm" : "text-slate-500"}`}>{item === "day" ? "День" : item === "week" ? "Неделя" : "Месяц"}</button>)}</div><label className="flex cursor-pointer items-center justify-center gap-2 text-sm font-medium text-slate-600"><Checkbox checked={showPastLessons} disabled={pastLessonsLoading} onCheckedChange={(checked) => void onShowPastLessonsChange(checked === true)} /><span>{pastLessonsLoading ? "Загружаю прошедшие…" : "Показывать прошедшие уроки"}</span></label></div>
        <div className="flex w-full items-center justify-center gap-2 lg:w-auto"><button onClick={() => move(-1)} aria-label="Назад" className="grid size-10 place-items-center rounded-xl border"><ChevronLeft className="size-4" /></button><button onClick={() => setCursor(today())} className="min-w-44 px-2 text-center text-base font-bold capitalize">{title}</button><button onClick={() => move(1)} aria-label="Вперёд" className="grid size-10 place-items-center rounded-xl border"><ChevronRight className="size-4" /></button></div>
      </div>
      {mode === "month" ? <MonthGrid dates={monthDays} cursor={cursor} lessons={visibleLessons} onSelect={setSelectedDate} /> : <ScheduleColumns dates={visibleDates} lessons={visibleLessons} onSelectDate={setSelectedDate} onSelectLesson={setEditing} />}
    </div>
    <Dialog open={selectedDate !== null} onOpenChange={(open) => !open && setSelectedDate(null)}><DialogContent className="rounded-3xl sm:max-w-2xl"><DialogHeader><DialogTitle className="text-2xl capitalize">{selectedDate && dateTitle(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</DialogTitle><DialogDescription>{plural(selectedLessons.reduce((sum, lesson) => sum + lesson.units, 0), "занятие", "занятия", "занятий")}</DialogDescription></DialogHeader><LessonList lessons={selectedLessons} onSelect={setEditing} onMaterials={onMaterials} onConvertTrial={onConvertTrial} onOpenStudent={(id) => { setSelectedDate(null); onOpenStudent(id); }} showActions /><DialogFooter><DialogClose asChild><Button variant="outline">Закрыть</Button></DialogClose>{selectedDate && <AddLessonDialog students={students} defaultDate={selectedDate} onAdd={onAdd} compact />}</DialogFooter></DialogContent></Dialog>
    <EditLessonDialog key={editing?.id ?? "no-lesson"} lesson={editing} onOpenChange={(open) => !open && setEditing(null)} onUpdate={onUpdate} onDelete={onDelete} onMaterials={onMaterials} />
  </Shell>;
}

function MonthGrid({ dates, cursor, lessons, onSelect }: { dates: string[]; cursor: string; lessons: Lesson[]; onSelect: (date: string) => void }) {
  const month = cursor.slice(0, 7);
  return <><div className="grid grid-cols-7 border-b bg-slate-50">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, index) => <div key={day} className={`p-3 text-center text-sm font-semibold text-slate-500 ${index > 4 ? "calendar-weekend-header" : ""}`}>{day}</div>)}</div><div className="grid grid-cols-7">{dates.map((date) => { const dayLessons = lessons.filter((lesson) => lesson.date === date); const currentMonth = date.startsWith(month); const weekend = [0, 6].includes(dateAtNoon(date).getUTCDay()); return <button key={date} onClick={() => onSelect(date)} className={`relative min-h-20 border-b border-r p-2 text-left transition hover:bg-indigo-50/50 md:min-h-32 md:p-3 ${date === today() ? "bg-indigo-50" : weekend ? "calendar-weekend" : "calendar-weekday"}`}><span className={`grid size-7 place-items-center rounded-full text-sm font-semibold ${date === today() ? "bg-indigo-600 text-white" : currentMonth ? weekend ? "calendar-weekend-date" : "text-slate-700" : "text-slate-300"}`}>{Number(date.slice(-2))}</span>{dayLessons.length > 0 && <span className="absolute bottom-2 right-2 grid size-6 place-items-center rounded-full bg-teal-600 text-xs font-bold text-white md:hidden" aria-label={plural(dayLessons.length, "урок", "урока", "уроков")}>{dayLessons.length}</span>}<span className="mt-2 hidden space-y-1 md:block">{dayLessons.slice(0, 2).map((lesson) => <span key={lesson.id} className={`flex items-center justify-between gap-1 overflow-hidden rounded-md px-2 text-xs ${lesson.units === 2 ? "min-h-12 py-2" : "py-1"} ${statusStyles[lesson.status]}`}><span className="truncate">{lesson.time} {lesson.name.split(" ")[0]}</span>{lesson.units === 2 && <span className="shrink-0 font-bold">×2</span>}</span>)}</span>{dayLessons.length > 2 && <span className="mt-1 hidden text-xs text-slate-500 md:block">ещё {dayLessons.length - 2}</span>}</button>; })}</div></>;
}

function ScheduleColumns({ dates, lessons, onSelectDate, onSelectLesson }: { dates: string[]; lessons: Lesson[]; onSelectDate: (date: string) => void; onSelectLesson: (lesson: Lesson) => void }) {
  return <div className={`grid ${dates.length === 1 ? "grid-cols-1" : "grid-cols-1 divide-y md:grid-cols-7 md:divide-x md:divide-y-0"}`}>{dates.map((date) => { const dayLessons = lessons.filter((lesson) => lesson.date === date); const weekend = [0, 6].includes(dateAtNoon(date).getUTCDay()); return <section key={date} className={`min-h-0 p-3 md:min-h-64 ${weekend ? "calendar-weekend" : ""}`}><button onClick={() => onSelectDate(date)} className="mb-2 w-full rounded-xl p-2 text-center hover:bg-indigo-50 md:mb-3"><span className="block text-xs uppercase text-slate-500">{dateTitle(date, { weekday: "short" })}</span><strong className={date === today() ? "text-indigo-600" : weekend ? "calendar-weekend-date" : ""}>{dateTitle(date)}</strong></button><div className="space-y-2">{dayLessons.map((lesson) => <button key={lesson.id} type="button" disabled={lesson.past} onClick={() => !lesson.past && onSelectLesson(lesson)} className={`w-full rounded-xl text-left text-sm ${lesson.units === 2 ? "min-h-28 p-4" : "p-3"} ${lesson.past ? "cursor-default opacity-75" : ""} ${statusStyles[lesson.status]}`}><strong className="block">{lesson.time}–{lesson.end}</strong><span className="block truncate">{lesson.name}</span><span className="mt-1 block text-xs opacity-75">{lesson.units === 2 ? "Двойной урок · 2 часа" : lesson.label}</span></button>)}{!dayLessons.length && <p className="py-2 text-center text-xs text-slate-400 md:py-8">Нет уроков</p>}</div></section>; })}</div>;
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

const materialTags = (value: string) => value.split(",").map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase("ru-RU") === tag.toLocaleLowerCase("ru-RU")) === index).slice(0, 10);
const isPdfMaterial = (resource: TeacherMaterial) => resource.contentType === "application/pdf";

function TeacherMaterialsView() {
  const [data, setData] = useState<TeacherMaterialsData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "pdf" | "word">("all");
  const [folderFilter, setFolderFilter] = useState("all");
  const [sort, setSort] = useState<"recent" | "new" | "title">("recent");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => setData(await readTeacherMaterials()), []);
  useEffect(() => { let active = true; void readTeacherMaterials().then((next) => active && setData(next)).catch((reason) => active && setError(reason instanceof Error ? reason.message : "Не удалось загрузить библиотеку")); return () => { active = false; }; }, []);
  const folders = useMemo(() => [...new Set((data?.resources ?? []).map((resource) => resource.folder).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "ru")), [data]);
  const filteredResources = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return [...(data?.resources ?? [])].filter((resource) => {
      const matchesType = typeFilter === "all" || typeFilter === "pdf" && isPdfMaterial(resource) || typeFilter === "word" && !isPdfMaterial(resource);
      const matchesFolder = folderFilter === "all" || folderFilter === "none" && !resource.folder || resource.folder === folderFilter;
      const haystack = [resource.title, resource.filename, resource.folder ?? "", ...(resource.tags ?? []), ...(resource.assignments ?? []).map((item) => item.studentName)].join(" ").toLocaleLowerCase("ru-RU");
      return matchesType && matchesFolder && (!needle || haystack.includes(needle));
    }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "ru") : sort === "new" ? b.createdAt - a.createdAt : (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
  }, [data, folderFilter, query, sort, typeFilter]);
  const acceptRules = async () => {
    if (!acceptedRules) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "acceptContentRules", accepted: true }); await load(); toast.success("Правила приняты"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить согласие"); }
    finally { setPending(false); }
  };
  const upload = async () => {
    if (!file || !data) return;
    if (file.size > data.maxFileBytes) { setError("Документ должен быть не больше 25 МБ"); return; }
    setPending(true); setError("");
    try {
      const form = new FormData(); form.set("file", file); form.set("title", title.trim()); form.set("folder", folder.trim()); form.set("tags", JSON.stringify(materialTags(tags)));
      const response = await appFetch("/api/teacher-materials", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить документ");
      setFile(null); setTitle(""); setFolder(""); setTags(""); await load(); toast.success("Материал добавлен в библиотеку");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить документ"); }
    finally { setPending(false); }
  };
  const saveMetadata = async (resource: TeacherMaterial, next: { title: string; folder: string; tags: string[] }) => {
    setPending(true); setError("");
    try {
      const response = await appFetch("/api/teacher-materials", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: resource.id, title: next.title, folder: next.folder.trim() || null, tags: next.tags }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось обновить материал");
      await load(); toast.success("Название, папка и теги сохранены"); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить материал"); return false; }
    finally { setPending(false); }
  };
  const replaceFile = async (resource: TeacherMaterial, replacement: File) => {
    if (!data || replacement.size > data.maxFileBytes) { setError("Документ должен быть не больше 25 МБ"); return false; }
    setPending(true); setError("");
    try {
      const form = new FormData(); form.set("file", replacement);
      const response = await appFetch(`/api/teacher-materials?id=${encodeURIComponent(resource.id)}`, { method: "PUT", body: form });
      const result = await response.json() as { error?: string; versionNumber?: number };
      if (!response.ok) throw new Error(result.error ?? "Не удалось заменить файл");
      await load(); toast.success(`Новая версия ${result.versionNumber ?? ""} сохранена, назначения не изменились`); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось заменить файл"); return false; }
    finally { setPending(false); }
  };
  const remove = async (resource: TeacherMaterial) => {
    if (!window.confirm(`Удалить «${resource.title}» из библиотеки и всех уроков?`)) return;
    setPending(true); setError("");
    try {
      const response = await appFetch(`/api/teacher-materials?id=${encodeURIComponent(resource.id)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось удалить материал");
      await load(); toast.success("Материал удалён");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить материал"); }
    finally { setPending(false); }
  };
  return <Shell title="Материалы" eyebrow="Библиотека преподавателя"><div className="space-y-6">
    {error && <p className="max-w-5xl rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
    {!data && !error && <div className="card max-w-5xl p-8 text-center text-slate-500">Загружаю библиотеку…</div>}
    {data && !data.contentRulesAccepted && <section className="card max-w-3xl border-indigo-200 bg-indigo-50 p-6"><h2 className="text-xl font-bold text-indigo-950">Правила пользовательского контента</h2><p className="mt-2 text-sm leading-6 text-indigo-900">Перед загрузкой документов подтвердите, что у вас есть права на их хранение и передачу ученикам.</p><label className="mt-4 flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedRules} onCheckedChange={(value) => setAcceptedRules(value === true)} className="mt-0.5" /><span>Я принимаю <a href="/legal/content-rules" target="_blank" rel="noreferrer" className="underline">Правила размещения контента</a> и несу ответственность за загружаемые материалы.</span></label><Button className="mt-4 bg-indigo-600" disabled={!acceptedRules || pending} onClick={() => void acceptRules()}>{pending ? "Сохраняю…" : "Принять правила"}</Button></section>}
    {data?.contentRulesAccepted && <>
      <datalist id="teacher-material-folders">{folders.map((item) => <option value={item} key={item} />)}</datalist>
      <section className="card max-w-5xl p-6 md:p-8"><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="text-xl font-bold">Добавить документ</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">PDF, DOC или DOCX до 25 МБ. Папка необязательна, теги вводятся через запятую.</p></div><div className="text-sm text-slate-500"><p>{data.uploadsThisMonth} из {data.maxUploadsPerMonth} загрузок в этом месяце</p><p>{formatBytes(data.storageBytes)} из {formatBytes(data.maxStorageBytes)}</p></div></div>
        {!data.storageConfigured && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">S3-хранилище документов пока не настроено.</p>}
        {data.storageConfigured && <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1.2fr_auto] xl:items-end"><Field label="Название"><Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Упражнения на координацию" /></Field><Field label="Папка"><Input list="teacher-material-folders" value={folder} maxLength={80} onChange={(event) => setFolder(event.target.value)} placeholder="Например: Начинающие" /></Field><Field label="Теги"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="ритм, техника" /></Field><Field label="Файл"><Input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={pending} onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !title) setTitle(next.name.replace(/\.(pdf|docx?)$/i, "")); }} /></Field><Button className="bg-indigo-600 md:col-span-2 xl:col-span-1" disabled={pending || !file || !title.trim() || data.uploadsThisMonth >= data.maxUploadsPerMonth} onClick={() => void upload()}><Upload />{pending ? "Загружаю…" : "Добавить"}</Button></div>}
      </section>
      <section className="card max-w-5xl overflow-hidden"><div className="border-b border-slate-200 p-5 md:px-7"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold">Моя библиотека</h2><p className="mt-1 text-sm text-slate-500">Поиск работает по названию, файлу, папкам, тегам и ученикам.</p></div><p className="text-sm font-medium text-slate-500">Показано {filteredResources.length} из {data.resources.length}</p></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_180px_210px_210px]"><label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти материал или ученика" className="pl-9" /></label><Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">PDF и Word</SelectItem><SelectItem value="pdf">Только PDF</SelectItem><SelectItem value="word">Только Word</SelectItem></SelectContent></Select><Select value={folderFilter} onValueChange={setFolderFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все папки</SelectItem><SelectItem value="none">Без папки</SelectItem>{folders.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">Недавно использованные</SelectItem><SelectItem value="new">Сначала новые</SelectItem><SelectItem value="title">По названию</SelectItem></SelectContent></Select></div></div>
        {filteredResources.length ? <div className="divide-y divide-slate-200">{filteredResources.map((resource) => <article key={resource.id} className="p-5 md:px-7"><div className="flex flex-col gap-4 md:flex-row md:items-start"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><FileText className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="min-w-0 truncate">{resource.title}</strong><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{isPdfMaterial(resource) ? "PDF" : "Word"}</span><span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">версия {resource.versionNumber ?? 1}</span></div><p className="mt-1 truncate text-sm text-slate-500">{resource.filename} · {formatBytes(resource.byteSize)}{resource.folder ? ` · ${resource.folder}` : ""}</p>{Boolean(resource.tags?.length) && <div className="mt-2 flex flex-wrap gap-1.5">{resource.tags?.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700"><Tag className="size-3" />{tag}</span>)}</div>}<p className="mt-2 text-xs text-slate-400">{resource.lastUsedAt ? `Недавно использован ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" }).format(resource.lastUsedAt)}` : "Ещё не использовался"}</p></div><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><a href={resource.url}><Download />Скачать</a></Button><ManageTeacherMaterialDialog resource={resource} folders={folders} maxFileBytes={data.maxFileBytes} uploadLimitReached={data.uploadsThisMonth >= data.maxUploadsPerMonth} pending={pending} onSave={saveMetadata} onReplace={replaceFile} /><Button size="sm" variant="outline" className="text-rose-600" disabled={pending} onClick={() => void remove(resource)}><Trash2 />Удалить</Button></div></div>
          <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Назначен: {plural(resource.assignments?.length ?? 0, "уроку", "урокам", "урокам")}</summary><div className="border-t border-slate-200 px-4 py-3">{resource.assignments?.length ? <ul className="space-y-2">{resource.assignments.map((assignment) => <li key={`${assignment.lessonId}-${assignment.startsAt}`} className="flex flex-col justify-between gap-1 text-sm sm:flex-row"><span className="font-medium">{assignment.studentName}</span><span className="text-slate-500">{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(assignment.startsAt)}</span></li>)}</ul> : <p className="text-sm text-slate-500">Материал пока не назначен ни одному уроку.</p>}</div></details>
        </article>)}</div> : <Empty text={data.resources.length ? "По выбранным условиям ничего не найдено" : "В библиотеке пока нет документов"} />}
      </section>
    </>}
  </div></Shell>;
}

function ManageTeacherMaterialDialog({ resource, folders, maxFileBytes, uploadLimitReached, pending, onSave, onReplace }: { resource: TeacherMaterial; folders: string[]; maxFileBytes: number; uploadLimitReached: boolean; pending: boolean; onSave: (resource: TeacherMaterial, next: { title: string; folder: string; tags: string[] }) => Promise<boolean>; onReplace: (resource: TeacherMaterial, file: File) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(resource.title);
  const [folder, setFolder] = useState(resource.folder ?? "");
  const [tags, setTags] = useState((resource.tags ?? []).join(", "));
  const [replacement, setReplacement] = useState<File | null>(null);
  const save = async () => { if (await onSave(resource, { title: title.trim(), folder, tags: materialTags(tags) })) setOpen(false); };
  const replace = async () => { if (!replacement || replacement.size > maxFileBytes) return; if (await onReplace(resource, replacement)) { setReplacement(null); setOpen(false); } };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline"><Pencil />Настроить</Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-xl"><DialogHeader><DialogTitle>Настроить материал</DialogTitle><DialogDescription>Измените метаданные или загрузите новую версию. Связи с уроками сохранятся.</DialogDescription></DialogHeader><div className="space-y-5"><Field label="Название"><Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="Папка"><Input list="teacher-material-folders" value={folder} maxLength={80} onChange={(event) => setFolder(event.target.value)} placeholder="Без папки" />{folders.length > 0 && <p className="text-xs text-slate-500">Можно выбрать существующую папку или написать новую.</p>}</Field><Field label="Теги"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="через, запятую" /><p className="text-xs text-slate-500">До 10 тегов, каждый не длиннее 30 символов.</p></Field><Button className="w-full bg-indigo-600" disabled={pending || !title.trim() || materialTags(tags).some((tag) => tag.length > 30)} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить название, папку и теги"}</Button><div className="border-t border-slate-200 pt-5"><h3 className="font-bold">Заменить файл</h3><p className="mt-1 text-sm leading-6 text-slate-500">Новая версия заменит текущий PDF или Word. Все назначения ученикам и урокам останутся на месте.</p><Input className="mt-4" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={pending || uploadLimitReached} onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} />{uploadLimitReached && <p className="mt-2 text-xs font-medium text-amber-700">Месячный лимит загрузок исчерпан.</p>}<Button variant="outline" className="mt-3 w-full" disabled={pending || uploadLimitReached || !replacement || replacement.size > maxFileBytes} onClick={() => void replace()}><RefreshCw />{pending ? "Заменяю…" : `Загрузить версию ${(resource.versionNumber ?? 1) + 1}`}</Button></div></div></DialogContent></Dialog>;
}

function SettingsView({ profile, availabilityWindows, onSave, onSaveAvailability, onLogout, isPlatformAdmin }: { profile: { name: string; professionalTitle: string; email: string }; availabilityWindows: AvailabilityWindow[]; onSave: (name: string, professionalTitle: string) => Promise<void>; onSaveAvailability: (windows: Array<{ weekday: number; start: string; end: string }>) => Promise<void>; onLogout?: () => void; isPlatformAdmin: boolean }) {
  const [name, setName] = useState(profile.name);
  const [professionalTitle, setProfessionalTitle] = useState(profile.professionalTitle);
  const [pending, setPending] = useState(false);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const [windows, setWindows] = useState<Array<{ id: string; weekday: number; start: string; end: string }>>(() => availabilityWindows.map((window) => ({ id: window.id, weekday: window.weekday, start: minutesToInputTime(window.startMinutes), end: minutesToInputTime(window.endMinutes) })));
  const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
  const save = async () => {
    setPending(true);
    try { await onSave(name.trim(), professionalTitle.trim()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить настройки"); }
    finally { setPending(false); }
  };
  const saveAvailability = async () => {
    setAvailabilityPending(true);
    try { await onSaveAvailability(windows.map(({ weekday, start, end }) => ({ weekday, start, end }))); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить рабочие часы"); }
    finally { setAvailabilityPending(false); }
  };
  const changeWindow = (id: string, patch: Partial<{ weekday: number; start: string; end: string }>) => setWindows((current) => current.map((window) => window.id === id ? { ...window, ...patch } : window));
  return <Shell title="Настройки" eyebrow="Профиль преподавателя"><div className="space-y-6">
    <section className="card max-w-2xl p-6 md:p-8">
      <h2 className="text-xl font-bold">Основные данные</h2>
      <p className="mt-1 text-sm text-slate-500">Это имя видно в меню и в кабинете ваших учеников.</p>
      <div className="mt-6 space-y-5">
        <Field label="Имя преподавателя"><Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} placeholder="Ваше имя" className="h-11 rounded-xl" /></Field>
        <Field label="Название или роль"><Input value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} maxLength={50} placeholder="Например: Репетитор или Тренер" className="h-11 rounded-xl" /><p className="text-xs text-slate-500">Необязательно. Оставьте пустым, если подпись над именем не нужна.</p></Field>
        <Field label="Email для входа"><Input value={profile.email} readOnly className="h-11 rounded-xl opacity-70" /></Field>
        <p className="text-sm text-slate-500">Email хранится в вашей учётной записи и сейчас не изменяется через настройки.</p>
        <Button onClick={() => void save()} disabled={pending || name.trim().length < 2 || name.trim() === profile.name && professionalTitle.trim() === profile.professionalTitle} className="w-full bg-indigo-600 sm:w-auto">{pending ? "Сохраняю…" : "Сохранить изменения"}</Button>
      </div>
    </section>
    <section className="card min-w-0 max-w-3xl overflow-hidden p-5 md:p-8">
      <h2 className="text-xl font-bold">Рабочие часы</h2>
      <p className="mt-1 text-sm text-slate-500">Эти интервалы используются для показа свободного времени ученикам, которым вы дали доступ. Можно добавить несколько интервалов на один день.</p>
      <div className="mt-6 space-y-3">{windows.map((window) => <div key={window.id} className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_130px_130px_auto] sm:items-end">
        <Field label="День"><Select value={String(window.weekday)} onValueChange={(value) => changeWindow(window.id, { weekday: Number(value) })}><SelectTrigger className="h-11 w-full min-w-0 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{weekdays.map((day, index) => <SelectItem key={day} value={String(index + 1)}>{day}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Начало"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.start} onChange={(event) => changeWindow(window.id, { start: event.target.value })} /></Field>
        <Field label="Конец"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.end} onChange={(event) => changeWindow(window.id, { end: event.target.value })} /></Field>
        <Button type="button" variant="outline" aria-label="Удалить интервал" onClick={() => setWindows((current) => current.filter((item) => item.id !== window.id))}><Trash2 /><span className="sm:sr-only">Удалить интервал</span></Button>
        {window.end <= window.start && <p className="text-xs text-indigo-600 sm:col-span-4">Интервал заканчивается на следующий день.</p>}
      </div>)}{!windows.length && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Рабочие часы пока не заданы. Ученики не увидят свободных слотов.</p>}</div>
      <div className="mt-5 grid gap-3 pb-2 sm:flex sm:flex-wrap">
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setWindows((current) => [...current, { id: crypto.randomUUID(), weekday: 1, start: "10:00", end: "18:00" }])}><Plus />Добавить интервал</Button>
        <Button type="button" className="w-full bg-indigo-600 sm:w-auto" disabled={availabilityPending || windows.some((window) => !window.start || !window.end || window.start === window.end)} onClick={() => void saveAvailability()}>{availabilityPending ? "Сохраняю…" : "Сохранить рабочие часы"}</Button>
      </div>
    </section>
    <TelegramNotificationsCard />
    {isPlatformAdmin && <section className="card max-w-3xl p-5 md:p-8"><h2 className="text-xl font-bold">Управление платформой</h2><p className="mt-1 text-sm text-slate-500">Список кабинетов преподавателей и управление доступом.</p><Button asChild variant="outline" className="mt-4"><a href="/admin"><ShieldCheck />Открыть админку</a></Button></section>}
    {onLogout && <section className="card max-w-3xl p-5 lg:hidden">
      <h2 className="text-xl font-bold">Сеанс</h2>
      <p className="mt-1 text-sm text-slate-500">Завершить работу в кабинете на этом устройстве.</p>
      <Button type="button" variant="outline" onClick={onLogout} className="mt-4 h-11 w-full rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"><LogOut />Выйти</Button>
    </section>}
  </div></Shell>;
}

function StudentPortal({ student, teacherName, lessons, entries, historyEvents, requests, notifications, availableSlots, onReadNotifications, onRequest, onMaterials, onBack, onReload }: { student: Student; teacherName: string; lessons: Lesson[]; entries: BalanceEntry[]; historyEvents: HistoryEvent[]; requests: LessonRequest[]; notifications: AppNotification[]; availableSlots: AvailableSlot[]; onReadNotifications: () => Promise<void>; onRequest: (body: StudentRequestDraft) => Promise<boolean>; onMaterials: (lesson: Lesson) => void; onBack: () => void; onReload: () => Promise<void> }) {
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
  const changeView = (compact: boolean) => { setCompactView(compact); writePreference(preferenceKey(student.id, "student-portal-view"), compact ? "compact" : "dashboard"); };
  return <main className="min-h-screen overflow-x-clip bg-background px-4 pb-24 pt-5 text-foreground"><div className={`mx-auto ${compactView ? "max-w-xl" : "max-w-7xl"}`}>
    <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500"><LogOut className="size-4" />Выйти</button>
    <div className="mb-4 flex justify-end"><Button type="button" size="sm" variant="outline" onClick={() => changeView(!compactView)}>{compactView ? <LayoutGrid /> : <Rows3 />}{compactView ? "Расширенный вид" : "Компактный вид"}</Button></div>
    <div className="mb-7 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><BrandIcon className="size-12" /><div className="min-w-0"><h1 className="truncate text-3xl font-bold">Привет, {student.name.split(" ")[0]}</h1><p className="mt-1 text-slate-500">Ваше расписание занятий</p></div></div><div className="flex items-center gap-2"><ThemeToggle compact /><MemberAvatar name={student.name} initials={student.initials.slice(0, 1)} color={student.ownAvatarColor} url={student.avatarUrl} className="size-12" /></div></div>
    <div className={`grid items-start gap-6 ${compactView ? "" : "lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,380px)]"}`}><div className="min-w-0">
    {notifications.some((item) => !item.read) && <button onClick={() => void onReadNotifications()} className="mb-4 flex w-full items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-left text-indigo-950 transition hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-950/55 dark:text-indigo-50 dark:hover:bg-indigo-950/75"><Bell className="mt-0.5 size-5 shrink-0 text-indigo-600 dark:text-indigo-300" /><span><strong className="block">{notifications.find((item) => !item.read)?.title}</strong><span className="mt-1 block text-sm text-indigo-800 dark:text-indigo-100">{notifications.find((item) => !item.read)?.body}</span></span></button>}
    {nextLesson ? <section className="card p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-500">Следующий урок</p><h2 className="mt-3 text-2xl font-bold capitalize">{dateTitle(nextLesson.date, { weekday: "long", day: "numeric", month: "long" })}</h2><p className="mt-2 text-3xl font-bold">{nextLesson.time}–{nextLesson.end}</p><p className="mt-2 text-slate-500">{teacherName}</p></div><span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${statusStyles[nextLesson.status]}`}>{nextLesson.label}</span></div><Button type="button" variant="outline" className="mt-5 w-full" onClick={() => onMaterials(nextLesson)}><NotebookPen />Материалы урока</Button><div className="mt-3 grid gap-3"><StudentRequestDialog type="reschedule" lesson={nextLesson} student={student} onRequest={onRequest} /><StudentRequestDialog type="cancel" lesson={nextLesson} student={student} onRequest={onRequest} /></div><p className="mt-3 text-center text-sm text-slate-500">Отмену можно запросить до 23:59 предыдущего дня</p></section> : <section className="card"><Empty text="Следующий урок пока не назначен" /></section>}
    {futureLessons.length > 1 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Дальнейшие занятия</h2><div className="card divide-y">{futureLessons.slice(1).map((lesson) => <article key={lesson.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><strong className="capitalize">{dateTitle(lesson.date, { weekday: "long", day: "numeric", month: "long" })}</strong><p className="mt-1 text-sm text-slate-500">{lesson.time}–{lesson.end}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[lesson.status]}`}>{lesson.label}</span></div><Button type="button" size="sm" variant="outline" className="mt-3 w-full" onClick={() => onMaterials(lesson)}><NotebookPen />Материалы урока</Button><div className="mt-2 grid gap-2"><StudentRequestDialog type="reschedule" lesson={lesson} student={student} onRequest={onRequest} /><StudentRequestDialog type="cancel" lesson={lesson} student={student} onRequest={onRequest} /></div></article>)}</div></section>}
    {recentLessons.length > 0 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Недавние уроки</h2><div className="card divide-y overflow-hidden">{visibleRecentLessons.map((lesson) => <button key={lesson.id} type="button" onClick={() => onMaterials(lesson)} className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800/80 dark:hover:text-white"><span><strong className="block capitalize">{dateTitle(lesson.date, { day: "numeric", month: "long" })}</strong><span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{lesson.time}–{lesson.end}</span></span><span className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400"><NotebookPen className="size-4" />Материалы</span></button>)}{recentLessons.length > 3 && <ShowMoreButton expanded={recentExpanded} remaining={recentLessons.length - 3} className="rounded-none border-x-0 border-b-0" onToggle={() => setRecentExpanded((value) => !value)} />}</div></section>}
    <section className="mt-5"><h2 className="mb-3 text-lg font-bold">История</h2><HistoryTimeline events={visibleHistoryEvents} showStudent={false} />{historyEvents.length > 3 && <ShowMoreButton expanded={historyExpanded} remaining={historyEvents.length - 3} className="mt-3" onToggle={() => setHistoryExpanded((value) => !value)} />}</section>
    </div><aside className={`${compactView ? "" : "order-first lg:order-none lg:sticky lg:top-5"} min-w-0 space-y-5`}>
    <ProfilePersonalizationCard name={student.name} initials={student.initials} avatarColor={student.ownAvatarColor} avatarUrl={student.avatarUrl} onChanged={onReload} />
    <MessagesCard />
    <section className={`rounded-3xl border p-6 ${student.balance < 0 ? "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-400/30 dark:bg-rose-950/45 dark:text-rose-50" : "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-50"}`}><div className="flex items-center gap-3"><WalletCards className={`size-6 ${student.balance < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`} /><div><p className="font-semibold opacity-80">Баланс</p><p className="text-2xl font-bold">{plural(student.balance, "занятие", "занятия", "занятий")}</p></div></div>{student.balance < 0 && <p className="mt-3 text-rose-800 dark:text-rose-100">Необходимо оплатить {plural(Math.abs(student.balance), "занятие", "занятия", "занятий")}</p>}</section>
    {(student.floating || student.canViewAvailability) && <AppCard><AppCardTitle>Свободные слоты</AppCardTitle><AppCardDescription>Выберите подходящее свободное время и отправьте запрос преподавателю.</AppCardDescription><div className="mt-4"><StudentRequestDialog type="new_lesson" student={student} availableSlots={student.canViewAvailability ? availableSlots : undefined} onRequest={onRequest} fullWidth /></div></AppCard>}
    {requests.length > 0 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Запросы на рассмотрении</h2><div className="card divide-y">{requests.map((request) => <div key={request.id} className="p-4"><strong>{request.type}</strong><p className="mt-1 text-sm text-slate-500">{request.detail}</p></div>)}</div></section>}
    <div className="mt-5"><TelegramNotificationsCard compact /></div>
    <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Оплаты</h2><BalanceHistory entries={paymentEntries} /></section>
    </aside></div>
  </div><Toaster position="top-center" richColors /></main>;
}

function LessonMaterialsDialog({ lesson, role, onOpenChange }: { lesson: Lesson | null; role: "owner" | "teacher" | "student"; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<LessonMaterialsData | null>(null);
  const [sharedNote, setSharedNote] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [homeworkAssignment, setHomeworkAssignment] = useState("");
  const [homeworkResponse, setHomeworkResponse] = useState("");
  const [selectedResource, setSelectedResource] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!lesson) return;
    const next = await readLessonMaterials(lesson.id);
    setData(next);
    setSharedNote(next.notes.find((note) => note.mine && note.visibility === "shared")?.body ?? "");
    setPrivateNote(next.notes.find((note) => note.mine && note.visibility === "teacher_private")?.body ?? "");
    setHomeworkAssignment(next.homework.assignment);
    setHomeworkResponse(next.homework.studentResponse);
  }, [lesson]);
  useEffect(() => {
    if (!lesson) return;
    let active = true;
    void readLessonMaterials(lesson.id).then((next) => {
      if (!active) return;
      setData(next);
      setSharedNote(next.notes.find((note) => note.mine && note.visibility === "shared")?.body ?? "");
      setPrivateNote(next.notes.find((note) => note.mine && note.visibility === "teacher_private")?.body ?? "");
      setHomeworkAssignment(next.homework.assignment);
      setHomeworkResponse(next.homework.studentResponse);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "Не удалось загрузить материалы"));
    return () => { active = false; };
  }, [lesson]);
  const acceptRules = async () => {
    if (!acceptedRules) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "acceptContentRules", accepted: true }); await load(); toast.success("Правила приняты"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить согласие"); }
    finally { setPending(false); }
  };
  const saveNote = async (visibility: "shared" | "teacher_private", body: string) => {
    if (!lesson || !body.trim()) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "upsertNote", lessonId: lesson.id, visibility, body: body.trim() }); await load(); toast.success("Заметка сохранена"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить заметку"); }
    finally { setPending(false); }
  };
  const saveHomework = async (field: "assignment" | "student_response", body: string) => {
    if (!lesson) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "updateHomework", lessonId: lesson.id, field, body }); await load(); toast.success(body.trim() ? "Домашнее задание сохранено" : "Текст домашнего задания удалён"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить домашнее задание"); }
    finally { setPending(false); }
  };
  const removeNote = async (noteId: string) => {
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "deleteNote", noteId }); await load(); toast.success("Заметка удалена"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить заметку"); }
    finally { setPending(false); }
  };
  const uploadPhotos = async (files: FileList | null) => {
    if (!lesson || !files?.length) return;
    if (files.length > (data?.maxPhotosPerParticipant ?? 5) - (data?.attachments.filter((photo) => photo.mine).length ?? 0)) {
      setError("К одному уроку можно добавить не более 5 фотографий от каждого участника");
      return;
    }
    if (Array.from(files).some((file) => file.size > 5 * 1024 * 1024)) {
      setError("Размер каждой фотографии не должен превышать 5 МБ");
      return;
    }
    setPending(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set("lessonId", lesson.id); form.set("file", file);
        const response = await appFetch("/api/lesson-materials/photos", { method: "POST", body: form });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить фотографию");
      }
      await load(); toast.success(files.length === 1 ? "Фотография добавлена" : "Фотографии добавлены");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить фотографию"); }
    finally { setPending(false); }
  };
  const removePhoto = async (attachmentId: string) => {
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "deleteAttachment", attachmentId }); await load(); toast.success("Фотография удалена"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить фотографию"); }
    finally { setPending(false); }
  };
  const changeResourceLink = async (resourceId: string, attach: boolean) => {
    if (!lesson) return;
    setPending(true); setError("");
    try {
      await saveLessonMaterial({ action: attach ? "attachResource" : "detachResource", lessonId: lesson.id, resourceId });
      setSelectedResource(""); await load(); toast.success(attach ? "Документ добавлен к уроку" : "Документ откреплён от урока");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить документы урока"); }
    finally { setPending(false); }
  };
  const sharedMine = data?.notes.find((note) => note.mine && note.visibility === "shared");
  const privateMine = data?.notes.find((note) => note.mine && note.visibility === "teacher_private");
  const otherNotes = data?.notes.filter((note) => !note.mine && note.visibility === "shared") ?? [];
  const minePhotoCount = data?.attachments.filter((photo) => photo.mine).length ?? 0;
  const linkedResourceIds = new Set(data?.documents.map((document) => document.id) ?? []);
  const availableResources = data?.library.filter((resource) => !linkedResourceIds.has(resource.id)) ?? [];
  return <Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-3xl"><DialogHeader><DialogTitle className="text-2xl">Материалы урока</DialogTitle><DialogDescription>{lesson ? `${lesson.name} · ${dateTitle(lesson.date, { day: "numeric", month: "long", year: "numeric" })}, ${lesson.time}` : "Заметки, документы и фотографии"}</DialogDescription></DialogHeader>
    {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
    {!data && !error && <p className="py-10 text-center text-slate-500">Загружаю материалы…</p>}
    {data && !data.contentRulesAccepted && <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h3 className="font-bold text-indigo-950">Правила пользовательского контента</h3><p className="mt-2 text-sm leading-6 text-indigo-900">Перед первой заметкой, фотографией или документом подтвердите права на материалы. Запрещено размещать чужие персональные данные, документы и изображения людей без необходимых согласий.</p><label className="mt-4 flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedRules} onCheckedChange={(value) => setAcceptedRules(value === true)} className="mt-0.5" /><span>Я принимаю <a href="/legal/content-rules" target="_blank" rel="noreferrer" className="underline">Правила размещения контента</a>, подтверждаю наличие необходимых прав и согласий и несу ответственность за загружаемые тексты, документы и изображения.</span></label><Button className="mt-4 bg-indigo-600" disabled={!acceptedRules || pending} onClick={() => void acceptRules()}>{pending ? "Сохраняю…" : "Принять правила"}</Button></section>}
    {data?.contentRulesAccepted && <div className="space-y-6"><section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5"><div><h3 className="font-bold text-indigo-950">Домашнее задание</h3><p className="mt-1 text-sm text-indigo-800">Задание преподавателя и отдельный ответ ученика — без смешивания с заметками.</p></div>
      {role !== "student" ? <div className="mt-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="homework-assignment" className="font-bold">Задание ученику</Label><span className="text-xs text-slate-400">{homeworkAssignment.length}/4000</span></div><Textarea id="homework-assignment" value={homeworkAssignment} maxLength={4000} rows={4} onChange={(event) => setHomeworkAssignment(event.target.value)} placeholder="Что нужно подготовить или выполнить к следующему уроку" /><div className="mt-3 flex justify-end gap-2">{data.homework.assignment && <Button variant="outline" disabled={pending} onClick={() => void saveHomework("assignment", "")}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || homeworkAssignment.trim() === data.homework.assignment} onClick={() => void saveHomework("assignment", homeworkAssignment)}>Сохранить задание</Button></div></div> : <div className="mt-4 rounded-xl bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Задание преподавателя</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{data.homework.assignment || "Преподаватель пока не добавил задание."}</p></div>}
      {role === "student" ? <div className="mt-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="homework-response" className="font-bold">Мой ответ или комментарий</Label><span className="text-xs text-slate-400">{homeworkResponse.length}/4000</span></div><Textarea id="homework-response" value={homeworkResponse} maxLength={4000} rows={4} onChange={(event) => setHomeworkResponse(event.target.value)} placeholder="Напишите, что выполнено, или задайте вопрос по заданию" /><div className="mt-3 flex justify-end gap-2">{data.homework.studentResponse && <Button variant="outline" disabled={pending} onClick={() => void saveHomework("student_response", "")}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || homeworkResponse.trim() === data.homework.studentResponse} onClick={() => void saveHomework("student_response", homeworkResponse)}>Сохранить ответ</Button></div></div> : <div className="mt-4 rounded-xl bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ответ ученика</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{data.homework.studentResponse || "Ученик пока не добавил ответ."}</p></div>}
    </section><section><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="shared-lesson-note" className="font-bold">{role === "student" ? "Моя заметка преподавателю" : "Общая заметка ученику"}</Label><span className="text-xs text-slate-400">{sharedNote.length}/4000</span></div><Textarea id="shared-lesson-note" value={sharedNote} maxLength={4000} rows={5} onChange={(event) => setSharedNote(event.target.value)} placeholder={role === "student" ? "Вопрос или комментарий к уроку" : "Рекомендация или комментарий к уроку"} /><div className="mt-3 flex justify-end gap-2">{sharedMine && <Button variant="outline" disabled={pending} onClick={() => void removeNote(sharedMine.id)}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || !sharedNote.trim() || sharedNote.trim() === sharedMine?.body} onClick={() => void saveNote("shared", sharedNote)}>Сохранить заметку</Button></div></section>
      {role !== "student" && <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="private-lesson-note" className="font-bold">Личная заметка преподавателя</Label><span className="text-xs text-slate-400">{privateNote.length}/4000</span></div><p className="mb-3 text-xs text-slate-500">Ученик её не увидит.</p><Textarea id="private-lesson-note" value={privateNote} maxLength={4000} rows={4} onChange={(event) => setPrivateNote(event.target.value)} placeholder="Личные наблюдения по уроку" /><div className="mt-3 flex justify-end gap-2">{privateMine && <Button variant="outline" disabled={pending} onClick={() => void removeNote(privateMine.id)}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || !privateNote.trim() || privateNote.trim() === privateMine?.body} onClick={() => void saveNote("teacher_private", privateNote)}>Сохранить личную заметку</Button></div></section>}
      {otherNotes.length > 0 && <section><h3 className="mb-3 font-bold">{role === "student" ? "Заметка преподавателя" : "Заметка ученика"}</h3><div className="space-y-3">{otherNotes.map((note) => <article key={note.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{note.authorName}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{note.body}</p></div>{note.canDelete && <Button type="button" size="icon" variant="ghost" disabled={pending} aria-label="Удалить заметку" onClick={() => void removeNote(note.id)}><Trash2 className="size-4" /></Button>}</div></article>)}</div></section>}
      <section><div><h3 className="font-bold">Документы</h3><p className="mt-1 text-sm text-slate-500">PDF и Word, которыми преподаватель поделился для этого урока.</p></div>
        {role !== "student" && <div className="mt-4 flex flex-col gap-3 sm:flex-row"><Select value={selectedResource} onValueChange={setSelectedResource}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder={availableResources.length ? "Выберите документ из библиотеки" : "Нет непривязанных документов"} /></SelectTrigger><SelectContent>{availableResources.map((resource) => <SelectItem key={resource.id} value={resource.id}>{resource.title} · {formatBytes(resource.byteSize)}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" disabled={pending || !selectedResource} onClick={() => void changeResourceLink(selectedResource, true)}><Link2 />Добавить к уроку</Button></div>}
        {data.documents.length ? <div className="mt-4 divide-y overflow-hidden rounded-2xl border border-slate-200">{data.documents.map((document) => <article key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><FileText className="size-5 shrink-0 text-indigo-600" /><div className="min-w-0 flex-1"><strong className="block truncate">{document.title}</strong><p className="truncate text-xs text-slate-500">{document.filename} · {formatBytes(document.byteSize)}</p></div><div className="flex gap-2"><Button asChild size="sm" variant="outline"><a href={document.url}><Download />Скачать</a></Button>{role !== "student" && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void changeResourceLink(document.id, false)}><Unlink />Открепить</Button>}</div></article>)}</div> : <div className="mt-4 grid min-h-24 place-items-center rounded-2xl border border-dashed border-slate-200 text-center text-sm text-slate-500"><span><FileText className="mx-auto mb-2 size-6 text-slate-300" />Документов для урока пока нет</span></div>}
        {role !== "student" && data.library.length === 0 && <p className="mt-3 text-xs text-slate-500">Сначала добавьте PDF или Word в раздел «Материалы» кабинета.</p>}
      </section>
      <section><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-bold">Фотографии</h3><p className="mt-1 text-sm text-slate-500">До 5 фотографий от каждого участника. Файлы автоматически удаляются через 90 дней после урока.</p></div>{data.photoStorageConfigured && minePhotoCount < data.maxPhotosPerParticipant && <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white ${pending ? "pointer-events-none opacity-50" : ""}`}><Upload className="size-4" />Добавить<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={pending} onChange={(event) => { void uploadPhotos(event.target.files); event.currentTarget.value = ""; }} /></label>}</div>
        {!data.photoStorageConfigured && <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Хранилище фотографий пока не настроено. Текстовые заметки работают независимо от него.</p>}
        {data.attachments.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{data.attachments.map((photo) => <figure key={photo.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Фотография к уроку от ${photo.authorName}`} className="aspect-square w-full object-cover" /></a>{photo.canDelete && <Button type="button" size="icon" variant="destructive" disabled={pending} className="absolute right-2 top-2 size-8" aria-label="Удалить фотографию" onClick={() => void removePhoto(photo.id)}><Trash2 className="size-4" /></Button>}<figcaption className="p-2 text-xs text-slate-500"><span className="block truncate">{photo.authorName}</span><span>до {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(photo.expiresAt))}</span></figcaption></figure>)}</div> : <div className="mt-4 grid min-h-28 place-items-center rounded-2xl border border-dashed border-slate-200 text-center text-sm text-slate-500"><span><Camera className="mx-auto mb-2 size-6 text-slate-300" />Фотографий пока нет</span></div>}
      </section></div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function TelegramNotificationsCard({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const response = await appFetch("/api/telegram/link", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось проверить подключение Telegram");
    setStatus(await response.json() as TelegramStatus);
  }, []);
  useEffect(() => {
    let active = true;
    void appFetch("/api/telegram/link", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<TelegramStatus> : Promise.reject(new Error("Telegram status failed")))
      .then((nextStatus) => { if (active) setStatus(nextStatus); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const connect = async () => {
    setPending(true);
    try {
      const response = await appFetch("/api/telegram/link", { method: "POST" });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Не удалось создать ссылку");
      window.open(result.url, "_blank", "noopener,noreferrer");
      toast.info("В Telegram нажмите «Запустить», затем вернитесь сюда и проверьте подключение");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось подключить Telegram"); }
    finally { setPending(false); }
  };
  const disconnect = async () => {
    setPending(true);
    try {
      const response = await appFetch("/api/telegram/link", { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось отключить Telegram");
      await load();
      toast.success("Telegram отключён");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отключить Telegram"); }
    finally { setPending(false); }
  };
  return <section className={`card min-w-0 overflow-hidden p-5 md:p-8 ${compact ? "max-w-none" : "max-w-3xl"}`}>
    <div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-600"><Send className="size-5" /></span><div className="min-w-0 flex-1">
      <h2 className="text-xl font-bold">Уведомления в Telegram</h2>
      <p className="mt-1 text-sm text-slate-500">Подключите свой Telegram к общему боту Тьюттори. Бот отправляет только напоминания за 24 часа до урока, изменения расписания и запросы ученика.</p>
      {!status && <p className="mt-4 text-sm text-slate-500">Проверяем подключение…</p>}
      {status && !status.configured && <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Telegram-бот ещё настраивается. Здесь появится кнопка подключения, когда он будет готов.</p>}
      {status?.configured && status.connected && <><p className="mt-4 text-sm font-semibold text-emerald-700">Telegram подключён{status.username ? ` · @${status.username}` : ""}</p><Button type="button" variant="outline" className="mt-4" disabled={pending} onClick={() => void disconnect()}>{pending ? "Отключаю…" : "Отключить"}</Button></>}
      {status?.configured && !status.connected && <div className="mt-5">
        <ol className="space-y-3 text-sm text-slate-700">
          {["Нажмите «Подключить Telegram» — откроется бот Тьюттори.", "В Telegram нажмите «Запустить» или отправьте команду /start.", "Вернитесь в Тьюттори и нажмите «Проверить подключение»."].map((step, index) => <li key={step} className="flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span><span className="pt-0.5 leading-5">{step}</span></li>)}
        </ol>
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">Одноразовая ссылка действует 15 минут. Бот не получает доступ к вашим перепискам и контактам. Подключение можно отключить в любой момент.</p>
        <div className="mt-4 grid min-w-0 gap-2"><Button type="button" className="h-auto min-h-10 w-full min-w-0 whitespace-normal bg-sky-600 text-center hover:bg-sky-700" disabled={pending} onClick={() => void connect()}><Send className="shrink-0" /><span>{pending ? "Создаю ссылку…" : "Подключить Telegram"}</span></Button><Button type="button" variant="outline" className="h-auto min-h-10 w-full min-w-0 whitespace-normal text-center" disabled={pending} onClick={() => void load().catch(() => toast.error("Не удалось проверить подключение"))}>Проверить подключение</Button></div>
      </div>}
    </div></div>
  </section>;
}

function StudentRequestDialog({ type, lesson, student, availableSlots, onRequest, fullWidth = false }: { type: "cancel" | "reschedule" | "new_lesson"; lesson?: Lesson; student: Student; availableSlots?: AvailableSlot[]; onRequest: (body: StudentRequestDraft) => Promise<boolean>; fullWidth?: boolean }) {
  const [open, setOpen] = useState(false); const [date, setDate] = useState(lesson?.date ?? shiftDate(today(), 1)); const [time, setTime] = useState(lesson?.time ?? "17:00"); const [lessonCount, setLessonCount] = useState<1 | 2>(1); const [selectedSlot, setSelectedSlot] = useState<number | null>(null); const [expandedSlotDay, setExpandedSlotDay] = useState<string | null>(null); const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  const cancellationExpired = type === "cancel" && Boolean(lesson && lesson.date <= today());
  const label = cancellationExpired ? "Срок отмены истёк" : type === "cancel" ? "Запросить отмену" : type === "reschedule" ? "Запросить перенос" : "Предложить время урока";
  const slotOnly = type === "new_lesson" && Boolean(availableSlots) && !student.floating;
  const visibleSlots = availableSlots?.filter((slot) => slot.maxUnits >= lessonCount) ?? [];
  const slotGroups = Object.entries(visibleSlots.reduce<Record<string, AvailableSlot[]>>((groups, slot) => { const day = moscowDate(slot.startsAt); (groups[day] ??= []).push(slot); return groups; }, {})).map(([day, slots]) => ({ day, slots }));
  const activeSlotDay = expandedSlotDay && slotGroups.some((group) => group.day === expandedSlotDay) ? expandedSlotDay : slotGroups[0]?.day ?? null;
  const chooseSlot = (slot: AvailableSlot) => { setSelectedSlot(slot.startsAt); setDate(moscowDate(slot.startsAt)); setTime(moscowTime(slot.startsAt)); };
  const submit = async () => { setPending(true); const saved = await onRequest({ requestType: type, lessonId: lesson?.id, proposedDate: type === "cancel" ? undefined : date, proposedTime: type === "cancel" ? undefined : time, lessonCount: type === "new_lesson" ? lessonCount : undefined, message, studentId: student.id }); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setSelectedSlot(null); setExpandedSlotDay(null); } }}><DialogTrigger asChild><Button size="lg" disabled={cancellationExpired} variant={type === "cancel" ? "outline" : "default"} className={`${fullWidth ? "w-full" : ""} h-auto min-h-12 min-w-0 whitespace-normal rounded-xl px-4 text-center leading-snug ${type === "cancel" ? "" : "bg-indigo-600"}`}>{availableSlots ? "Выбрать свободное время" : label}</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{type === "cancel" ? "Преподаватель получит запрос. Своевременный запрос не будет списан, даже если останется без ответа." : availableSlots ? "Выберите свободное время. Оно появится в расписании только после подтверждения преподавателем." : "Предложите удобные дату и время. Урок появится в расписании после подтверждения преподавателем."}</DialogDescription></DialogHeader>{type === "new_lesson" && <><Field label="Продолжительность"><Select value={String(lessonCount)} onValueChange={(value) => { setLessonCount(value === "2" ? 2 : 1); setSelectedSlot(null); setExpandedSlotDay(null); }}><SelectTrigger aria-label="Продолжительность урока" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Обычный урок · 1 час</SelectItem><SelectItem value="2">Двойной урок · 2 часа</SelectItem></SelectContent></Select></Field>{lessonCount === 2 && <p className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-800">После подтверждения появится один двойной урок на два часа, а после проведения спишутся два занятия.</p>}{availableSlots && <Field label="Свободные слоты"><div className="max-h-80 space-y-2 overflow-y-auto pr-1">{slotGroups.map((group) => <section key={group.day} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"><button type="button" aria-expanded={activeSlotDay === group.day} onClick={() => setExpandedSlotDay(group.day)} className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100 dark:bg-slate-800/70 dark:hover:bg-slate-800"><span><strong className="block capitalize">{dateTitle(group.day, { weekday: "long", day: "numeric", month: "long" })}</strong><span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{plural(group.slots.length, "слот", "слота", "слотов")}</span></span><ChevronRight className={`size-4 shrink-0 text-slate-400 transition-transform ${activeSlotDay === group.day ? "rotate-90" : ""}`} /></button>{activeSlotDay === group.day && <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">{group.slots.map((slot) => <button key={slot.startsAt} type="button" onClick={() => chooseSlot(slot)} className={`rounded-xl border p-3 text-left text-sm transition ${selectedSlot === slot.startsAt ? "border-indigo-600 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-600 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-50 dark:ring-indigo-400" : "border-slate-200 hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-500"}`}><span>{moscowTime(slot.startsAt)}–{moscowTime(slot.startsAt + lessonCount * 60 * 60_000)}</span></button>)}</div>}</section>)}{!visibleSlots.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">Подходящих свободных слотов пока нет.</p>}</div></Field>}</>}{type !== "cancel" && !slotOnly && <div className="grid gap-4 sm:grid-cols-2"><Field label={availableSlots ? "Или другая дата" : "Дата"}><Input type="date" value={date} min={today()} onChange={(event) => { setDate(event.target.value); setSelectedSlot(null); }} /></Field><Field label="Время"><Input type="time" value={time} onChange={(event) => { setTime(event.target.value); setSelectedSlot(null); }} /></Field></div>}<Field label="Комментарий"><Input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Необязательно" /></Field><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button className="bg-indigo-600" disabled={pending || (type !== "cancel" && (!date || !time)) || (slotOnly && selectedSlot === null)} onClick={() => void submit()}>{pending ? "Отправляю…" : "Отправить запрос"}</Button></DialogFooter></DialogContent></Dialog>;
}

function AddLessonDialog({ students, defaultDate, onAdd, compact = false }: { students: Student[]; defaultDate: string; onAdd: (lesson: LessonDraft) => Promise<boolean>; compact?: boolean }) {
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
  const changeOpen = (next: boolean) => { setOpen(next); if (next) { setDate(defaultDate < today() ? today() : defaultDate); setStudentId((current) => students.some((student) => student.id === current) ? current : (students[0]?.id ?? "")); } };
  const submit = async () => { setPending(true); const saved = await onAdd({ date, time, studentId: lessonType === "trial" && trialTarget === "guest" ? undefined : studentId, repeat, lessonCount, lessonType, trialGuestName: lessonType === "trial" && trialTarget === "guest" ? guestName.trim() : undefined, trialGuestEmail: guestEmail.trim() || undefined, trialGuestPhone: guestPhone.trim() || undefined, trialGuestNote: guestNote.trim() || undefined }); setPending(false); if (saved) setOpen(false); };
  const trialStudents = students.filter((student) => !student.archived && student.trialEligible);
  if (lessonType === "trial") return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button size={compact ? "default" : "lg"} className="h-11 rounded-xl bg-indigo-600 px-5 text-base shadow-lg shadow-indigo-200 hover:bg-indigo-700"><Plus />Добавить урок</Button></DialogTrigger><DialogContent className="gap-0 overflow-hidden rounded-[22px] border-0 p-0 sm:max-w-xl"><DialogHeader className="border-b p-6 pr-14"><DialogTitle className="text-2xl">Пробное занятие</DialogTitle><DialogDescription>Бесплатное разовое занятие на один час.</DialogDescription></DialogHeader><div className="space-y-5 p-6"><Field label="Тип занятия"><Select value={lessonType} onValueChange={(value) => setLessonType(value as "regular" | "trial")}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Обычное занятие</SelectItem><SelectItem value="trial">Пробное занятие · бесплатно</SelectItem></SelectContent></Select></Field><Field label="Кому назначить"><Select value={trialTarget} onValueChange={(value) => setTrialTarget(value as "guest" | "student")}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="guest">Новому посетителю</SelectItem><SelectItem value="student" disabled={!trialStudents.length}>Существующему ученику без платных занятий</SelectItem></SelectContent></Select></Field>{trialTarget === "guest" ? <><Field label="Имя *"><Input value={guestName} onChange={(event) => setGuestName(event.target.value)} maxLength={80} placeholder="Имя посетителя" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Email"><Input value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} type="email" placeholder="Необязательно" /></Field><Field label="Телефон"><Input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="Необязательно" /></Field></div><Field label="Заметка"><Input value={guestNote} onChange={(event) => setGuestNote(event.target.value)} maxLength={300} placeholder="Необязательно" /></Field></> : <Field label="Ученик"><Select value={studentId} onValueChange={setStudentId}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue placeholder="Выберите ученика" /></SelectTrigger><SelectContent>{trialStudents.map((student) => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}</SelectContent></Select></Field>}<div className="grid gap-4 sm:grid-cols-2"><Field label="Дата"><Input type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Время"><TimeField value={time} onChange={setTime} /></Field></div><p className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-800">Посетитель не появится в списке учеников. После занятия его можно преобразовать в ученика из календаря.</p></div><DialogFooter className="border-t bg-slate-50 p-5"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button className="bg-indigo-600" disabled={pending || !date || !time || trialTarget === "guest" && !guestName.trim() || trialTarget === "student" && !studentId} onClick={() => void submit()}>{pending ? "Сохраняю…" : "Сохранить пробное занятие"}</Button></DialogFooter></DialogContent></Dialog>;
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button size={compact ? "default" : "lg"} disabled={!students.length} className="h-11 rounded-xl bg-indigo-600 px-5 text-base shadow-lg shadow-indigo-200 hover:bg-indigo-700"><Plus />Добавить урок</Button></DialogTrigger><DialogContent className="gap-0 overflow-hidden rounded-[22px] border-0 p-0 sm:max-w-xl"><DialogHeader className="border-b p-6 pr-14"><DialogTitle className="text-2xl">Новый урок</DialogTitle><DialogDescription>Добавьте обычное или бесплатное пробное занятие.</DialogDescription></DialogHeader><div className="space-y-5 p-6"><Field label="Ученик"><Select value={studentId} onValueChange={setStudentId}><SelectTrigger aria-label="Ученик" className="h-11 w-full rounded-xl"><SelectValue placeholder="Выберите ученика" /></SelectTrigger><SelectContent>{students.map((student) => <SelectItem value={student.id} key={student.id}>{student.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Тип занятия"><Select value={lessonType} onValueChange={(value) => { const next = value as "regular" | "trial"; setLessonType(next); if (next === "trial") { setLessonCount(1); setRepeat("once"); } }}><SelectTrigger aria-label="Тип занятия" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Обычное занятие</SelectItem><SelectItem value="trial">Пробное занятие · бесплатно</SelectItem></SelectContent></Select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Дата"><Input aria-label="Дата" type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} className="h-11 rounded-xl" /></Field><Field label="Время"><TimeField value={time} onChange={setTime} /></Field></div><Field label="Продолжительность"><Select value={String(lessonCount)} onValueChange={(value) => setLessonCount(value === "2" ? 2 : 1)}><SelectTrigger aria-label="Продолжительность урока" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Обычный урок · 1 час</SelectItem><SelectItem value="2">Двойной урок · 2 часа</SelectItem></SelectContent></Select></Field><Field label="Повторение"><Select value={repeat} onValueChange={(value) => setRepeat(value as "once" | "weekly")}><SelectTrigger aria-label="Повторение" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="once">Не повторять</SelectItem><SelectItem value="weekly">Каждую неделю</SelectItem></SelectContent></Select></Field>{lessonCount === 2 && <p className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-800">Будут созданы два связанных занятия подряд. Они переносятся и отменяются вместе, а после проведения с баланса списываются два занятия.</p>}</div><DialogFooter className="border-t bg-slate-50 p-5"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !studentId || !date || !time} onClick={() => void submit()} className="bg-indigo-600">{pending ? "Сохраняю…" : lessonCount === 2 ? "Сохранить двойной урок" : "Сохранить урок"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EditLessonDialog({ lesson, onOpenChange, onUpdate, onDelete, onMaterials, onOpenStudent }: { lesson: Lesson | null; onOpenChange: (open: boolean) => void; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean>; onMaterials: (lesson: Lesson) => void; onOpenStudent?: (studentId: string) => void }) {
  const [date, setDate] = useState(lesson?.date ?? today());
  const [time, setTime] = useState(lesson?.time ?? "17:00");
  const [pending, setPending] = useState(false);
  const update = async () => { if (!lesson) return; setPending(true); const saved = await onUpdate(lesson.id, date, time); setPending(false); if (saved) onOpenChange(false); };
  const remove = async () => { if (!lesson || !window.confirm(lesson.units === 2 ? "Отменить оба занятия без списания баланса?" : "Отменить урок без списания баланса?")) return; setPending(true); const saved = await onDelete(lesson.id); setPending(false); if (saved) onOpenChange(false); };
  return <Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">{lesson?.name}</DialogTitle><DialogDescription>{lesson?.units === 2 ? "Обе части двойного урока будут перенесены или отменены вместе." : "Перенесите урок, откройте материалы или отмените его без списания."}</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Новая дата"><Input type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Новое время"><TimeField value={time} onChange={setTime} /></Field></div>{lesson && <div className={`grid gap-2 ${onOpenStudent ? "sm:grid-cols-2" : ""}`}><Button type="button" variant="outline" onClick={() => { onOpenChange(false); onMaterials(lesson); }}><NotebookPen />Материалы и домашка</Button>{onOpenStudent && <Button type="button" variant="outline" onClick={() => onOpenStudent(lesson.studentId)}><UserRound />Карточка ученика</Button>}</div>}<DialogFooter className="sm:justify-between"><Button variant="destructive" disabled={pending} onClick={() => void remove()}><Trash2 />{pending ? "Сохраняю…" : lesson?.units === 2 ? "Отменить оба без списания" : "Отменить без списания"}</Button><div className="flex gap-2"><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Закрыть</Button><Button className="bg-indigo-600" disabled={pending || !date || !time} onClick={() => void update()}>{lesson?.units === 2 ? "Перенести оба" : "Перенести"}</Button></div></DialogFooter></DialogContent></Dialog>;
}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith(" *");
  const visibleLabel = required ? label.slice(0, -2) : label;
  return <div className="min-w-0 space-y-2"><Label className={required ? "font-semibold text-primary" : undefined}>{visibleLabel}{required && <span aria-hidden="true"> *</span>}</Label>{children}</div>;
}
function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const shift = (hours: number) => {
    const [rawHours, rawMinutes] = value.split(":").map(Number);
    if (!Number.isFinite(rawHours) || !Number.isFinite(rawMinutes)) return;
    onChange(`${String((rawHours + hours + 24) % 24).padStart(2, "0")}:${String(rawMinutes).padStart(2, "0")}`);
  };
  return <div className="flex min-w-0 gap-2"><Button type="button" variant="outline" size="icon" aria-label="Уменьшить время на час" onClick={() => shift(-1)} className="h-11 shrink-0 rounded-xl"><Minus className="size-4" /></Button><Input aria-label="Время" type="time" step="3600" value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-0 rounded-xl text-center" /><Button type="button" variant="outline" size="icon" aria-label="Увеличить время на час" onClick={() => shift(1)} className="h-11 shrink-0 rounded-xl"><Plus className="size-4" /></Button></div>;
}
function Empty({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center p-6 text-center text-slate-500"><div><CalendarDays className="mx-auto mb-3 size-7 text-slate-300" /><p>{text}</p></div></div>; }
