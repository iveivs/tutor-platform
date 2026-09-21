"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, Copy,
  History as HistoryIcon, Home, LogOut, Minus, Pencil, Plus, Search, Send, Settings, Trash2, UserRound, UsersRound, WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/theme-toggle";

type View = "today" | "calendar" | "students" | "history" | "requests" | "notifications" | "student" | "settings";
type CurrentUser = { name: string; email: string; role: "owner" | "teacher" | "student" };
type Lesson = { id: string; studentId: string; date: string; time: string; end: string; name: string; status: "paid" | "low" | "debt" | "request"; label: string };
type LessonDraft = { date: string; time: string; studentId: string; repeat: "once" | "weekly" };
type StudentDraft = { name: string; email?: string; floating: boolean; weekday?: number; time?: string };
type RecurringSlot = { id: string; studentId: string; label: string; durationMinutes: number };
type Student = { id: string; name: string; email?: string; initials: string; schedule: string; next: string; balance: number; floating: boolean; accountStatus: "invited" | "active" };
type LessonRequest = { id: string; type: string; kind: string; name: string; detail: string; note: string };
type BalanceEntry = { id: string; studentId: string; kind: string; units: number; note: string; date: string; reversed?: boolean };
type HistoryEvent = { id: string; sourceId?: string; studentId: string; studentName: string; category: "lesson" | "payment" | "request"; type: string; title: string; detail: string; actor?: string; units?: number; canReverse?: boolean; occurredAt: number };
type AppNotification = { id: string; type: string; title: string; body: string; read: boolean; createdAt: number };
type AppData = { lessons: Lesson[]; students: Student[]; recurringSlots?: RecurringSlot[]; requests: LessonRequest[]; balanceEntries: BalanceEntry[]; historyEvents?: HistoryEvent[]; notifications: AppNotification[]; currentStudentId?: string | null; teacherName?: string; profile?: { name: string; email: string } };

async function appFetch(input: RequestInfo | URL, init?: RequestInit) {
  let response = await fetch(input, init);
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await fetch(input, init);
  }
  return response;
}

async function readAppData(): Promise<AppData> {
  const response = await appFetch("/api/app-data", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить данные");
  return response.json() as Promise<AppData>;
}

async function saveAppData(body: Record<string, unknown>) {
  const response = await appFetch("/api/app-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string; inviteUrl?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить изменения");
  return result;
}

const statusStyles = {
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  low: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  debt: "bg-rose-50 text-rose-700 ring-rose-100",
  request: "bg-amber-50 text-amber-700 ring-amber-100",
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00Z`);
const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
const shiftDate = (value: string, days: number) => { const date = dateAtNoon(value); date.setUTCDate(date.getUTCDate() + days); return toIsoDate(date); };
const shiftMonth = (value: string, months: number) => { const date = dateAtNoon(value); const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months); date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate())); return toIsoDate(date); };
const dateTitle = (value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) => new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(dateAtNoon(value));
const plural = (count: number, one: string, few: string, many: string) => {
  const mod100 = count % 100; const mod10 = count % 10;
  return `${count} ${mod100 >= 11 && mod100 <= 14 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many}`;
};

export default function TutorApp({ role = "owner", user, onLogout }: { role?: "owner" | "teacher" | "student"; user?: CurrentUser; onLogout?: () => void }) {
  const [view, setView] = useState<View>("today");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [recurringSlots, setRecurringSlots] = useState<RecurringSlot[]>([]);
  const [requests, setRequests] = useState<LessonRequest[]>([]);
  const [balanceEntries, setBalanceEntries] = useState<BalanceEntry[]>([]);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [profile, setProfile] = useState({ name: user?.name ?? "Преподаватель", email: user?.email ?? "" });
  const [teacherName, setTeacherName] = useState(user?.name ?? "Преподаватель");
  const [selectedStudent, setSelectedStudent] = useState("101");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const applyData = useCallback((data: AppData) => {
    setLessons(data.lessons); setStudents(data.students); setRecurringSlots(data.recurringSlots ?? []); setRequests(data.requests); setBalanceEntries(data.balanceEntries ?? []); setHistoryEvents(data.historyEvents ?? []); setNotifications(data.notifications ?? []); setTeacherName(data.teacherName ?? "Преподаватель"); if (data.profile) setProfile(data.profile);
    setSelectedStudent((current) => data.students.some((student) => student.id === current) ? current : (data.students[0]?.id ?? current));
  }, []);

  const reload = useCallback(async () => {
    const data = await readAppData(); applyData(data); setLoadError(false); setLoading(false);
  }, [applyData]);

  useEffect(() => {
    let active = true;
    void readAppData().then((data) => { if (active) { applyData(data); setLoadError(false); setLoading(false); } }).catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [applyData]);

  const addLesson = async (lesson: LessonDraft) => {
    try { await saveAppData({ action: "createLesson", studentId: lesson.studentId, date: lesson.date, time: lesson.time, repeat: lesson.repeat }); await reload(); toast.success("Урок добавлен в расписание"); return true; }
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
  const updateStudent = async (student: Pick<Student, "id" | "name" | "email">) => {
    try { await saveAppData({ action: "updateStudent", studentId: student.id, name: student.name, email: student.email }); await reload(); toast.success("Данные ученика сохранены"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить данные ученика"); return false; }
  };
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
    try { await saveAppData({ action: "addPayment", studentId, count, paymentDate }); await reload(); toast.success(`Добавлено ${count} занятий`); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить оплату"); return false; }
  };
  const reversePayment = async (paymentId: string) => {
    try { await saveAppData({ action: "reversePayment", paymentId }); await reload(); toast.success("Оплата отменена, баланс пересчитан"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отменить оплату"); return false; }
  };
  const submitStudentRequest = async (body: { requestType: "cancel" | "reschedule" | "new_lesson"; lessonId?: string; proposedDate?: string; proposedTime?: string; message?: string; studentId?: string }) => {
    try { await saveAppData({ action: "submitStudentRequest", ...body }); await reload(); toast.success("Запрос отправлен преподавателю"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос"); return false; }
  };
  const markNotificationsRead = async () => {
    try { await saveAppData({ action: "markNotificationsRead" }); await reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось обновить уведомления"); }
  };
  const updateProfile = async (name: string) => {
    await saveAppData({ action: "updateProfile", name });
    setProfile((current) => ({ ...current, name }));
    setTeacherName(name);
    toast.success("Имя сохранено");
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
        return { date, lessons: lessons.filter((lesson) => lesson.date === date).map(({ time, end, name, label }) => ({ time, end, name, status: label })) };
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

  if (loading) return <main className="grid min-h-screen place-items-center bg-background text-foreground"><div className="text-center"><CalendarDays className="mx-auto mb-3 size-8 animate-pulse text-indigo-600" /><p className="font-semibold">Загружаю расписание…</p></div></main>;
  if (loadError) return <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Данные временно недоступны</h1><p className="mt-2 text-slate-500">Локальная база не ответила. Попробуйте ещё раз.</p><Button className="mt-5 bg-indigo-600" onClick={() => { setLoading(true); void reload().catch(() => { setLoadError(true); setLoading(false); }); }}>Повторить</Button></div></main>;
  const portalStudent = students.find((student) => student.id === selectedStudent) ?? students[0];
  if (role === "student") return portalStudent
    ? <StudentPortal student={portalStudent} teacherName={teacherName} lessons={lessons} entries={balanceEntries} historyEvents={historyEvents} requests={requests} notifications={notifications} onReadNotifications={markNotificationsRead} onRequest={submitStudentRequest} onBack={onLogout ?? (() => undefined)} />
    : <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Кабинет ученика не найден</h1><p className="mt-2 text-slate-500">Аккаунт вошёл, но не связан с карточкой ученика. Попросите преподавателя создать новое приглашение.</p><Button className="mt-5" variant="outline" onClick={onLogout}>Выйти</Button></div></main>;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Sidebar view={view} setView={setView} name={profile.name} onLogout={onLogout} requestCount={requests.length} notificationCount={notifications.filter((item) => !item.read).length} />
      <section className="min-h-screen pb-24 lg:ml-[272px] lg:pb-0">
        <MobileHeader name={profile.name} notificationCount={notifications.filter((item) => !item.read).length} onNotifications={() => setView("notifications")} />
        {view === "today" && <TodayView lessons={lessons} students={students} requests={requests} onAdd={addLesson} setView={setView} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "calendar" && <CalendarView lessons={lessons} students={students} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} />}
        {view === "students" && <StudentsView students={students} onAdd={addStudent} onOpen={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "student" && students.length > 0 && <StudentView student={students.find((student) => student.id === selectedStudent) ?? students[0]} lessons={lessons} recurringSlots={recurringSlots} balanceEntries={balanceEntries} historyEvents={historyEvents} onAdd={addLesson} onBack={() => setView("students")} onPay={addPayment} onReversePayment={reversePayment} onCreateInvite={createStudentInvite} onUpdate={updateStudent} onStopSeries={stopLessonSeries} />}
        {view === "history" && <HistoryView events={historyEvents} students={students} onReversePayment={reversePayment} />}
        {view === "requests" && <RequestsView requests={requests} onResolved={reload} />}
        {view === "notifications" && <NotificationsView notifications={notifications} onRead={markNotificationsRead} />}
        {view === "settings" && <SettingsView profile={profile} onSave={updateProfile} />}
      </section>
      <MobileNav view={view} setView={setView} />
      <Toaster position="top-right" richColors />
    </main>
  );
}

function Sidebar({ view, setView, name, onLogout, requestCount, notificationCount }: { view: View; setView: (view: View) => void; name: string; onLogout?: () => void; requestCount: number; notificationCount: number }) {
  const items = [
    { id: "today" as View, label: "Сегодня", icon: Home },
    { id: "calendar" as View, label: "Календарь", icon: CalendarDays },
    { id: "students" as View, label: "Ученики", icon: UsersRound },
    { id: "history" as View, label: "История", icon: HistoryIcon },
    { id: "requests" as View, label: "Запросы", icon: Bell, count: requestCount },
    { id: "notifications" as View, label: "Уведомления", icon: Bell, count: notificationCount },
    { id: "settings" as View, label: "Настройки", icon: Settings },
  ];
  return <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-slate-200 bg-white lg:flex">
    <div className="border-b border-slate-200 px-7 py-7"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200"><CalendarDays className="size-6" /></span><div className="min-w-0"><p className="text-xl font-bold tracking-tight">Репетитор</p><p className="mt-0.5 truncate text-sm text-slate-500">{name}</p></div></div></div>
    <nav className="flex-1 space-y-2 p-5" aria-label="Основная навигация">{items.map(({ id, label, icon: Icon, count }) => <button key={label} onClick={() => setView(id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-base font-medium transition ${view === id || (id === "students" && view === "student") ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon className="size-5" /><span>{label}</span>{count ? <span className="ml-auto rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white">{count}</span> : null}</button>)}</nav>
    <div className="border-t border-slate-200 p-5"><ThemeToggle /><button onClick={onLogout} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm text-slate-600 hover:bg-slate-50"><LogOut className="size-5" />Выйти</button></div>
  </aside>;
}

function MobileHeader({ name, notificationCount, onNotifications }: { name: string; notificationCount: number; onNotifications: () => void }) {
  return <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden"><div className="min-w-0"><p className="font-bold">Репетитор</p><p className="truncate text-xs text-slate-500">{name}</p></div><div className="flex items-center gap-2"><ThemeToggle compact /><button onClick={onNotifications} aria-label="Уведомления" className="relative grid size-10 place-items-center rounded-xl border border-slate-200"><Bell className="size-5" />{notificationCount > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-rose-500" />}</button></div></header>;
}

function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  const items = [{ id: "today" as View, label: "Сегодня", icon: Home }, { id: "calendar" as View, label: "Календарь", icon: CalendarDays }, { id: "students" as View, label: "Ученики", icon: UsersRound }, { id: "history" as View, label: "История", icon: HistoryIcon }, { id: "requests" as View, label: "Запросы", icon: Bell }, { id: "settings" as View, label: "Настройки", icon: Settings }];
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-slate-200 bg-white/95 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden" aria-label="Мобильная навигация">{items.map(({ id, label, icon: Icon }) => <button key={label} onClick={() => setView(id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium ${view === id || (id === "students" && view === "student") ? "text-indigo-600" : "text-slate-500"}`}><Icon className="size-5" />{label}</button>)}</nav>;
}

function Shell({ eyebrow, title, actions, children }: { eyebrow?: string; title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-9 xl:px-12"><div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div>{eyebrow && <p className="mb-1 text-sm font-semibold text-indigo-600">{eyebrow}</p>}<h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1></div>{actions}</div>{children}</div>;
}

function TodayView({ lessons, students, requests, onAdd, setView, onOpenStudent }: { lessons: Lesson[]; students: Student[]; requests: LessonRequest[]; onAdd: (lesson: LessonDraft) => Promise<boolean>; setView: (view: View) => void; onOpenStudent: (id: string) => void }) {
  const [selectedDate, setSelectedDate] = useState(today);
  const selectedLessons = lessons.filter((lesson) => lesson.date === selectedDate);
  const todayDate = today();
  const debtCount = students.filter((student) => student.balance < 0).length;
  const withoutLessonCount = students.filter((student) => student.next === "Не назначен").length;
  const nextLesson = lessons.filter((lesson) => `${lesson.date}T${lesson.time}` >= `${todayDate}T${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" })}`).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  const relative = selectedDate === todayDate ? "Сегодня" : selectedDate === shiftDate(todayDate, 1) ? "Завтра" : selectedDate === shiftDate(todayDate, -1) ? "Вчера" : "Расписание";
  return <Shell eyebrow="Ваш рабочий день" title={`${relative}, ${dateTitle(selectedDate)}`} actions={<div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 sm:flex sm:w-auto sm:flex-wrap"><div className="flex min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><button onClick={() => setSelectedDate((date) => shiftDate(date, -1))} aria-label="Предыдущий день" className="grid size-11 shrink-0 place-items-center hover:bg-slate-50"><ChevronLeft className="size-5" /></button><button onClick={() => setSelectedDate(todayDate)} className="min-w-0 flex-1 truncate whitespace-nowrap border-x border-slate-200 px-2 text-sm font-semibold sm:px-4">{dateTitle(selectedDate, { day: "numeric", month: "long", year: "numeric" })}</button><button onClick={() => setSelectedDate((date) => shiftDate(date, 1))} aria-label="Следующий день" className="grid size-11 shrink-0 place-items-center hover:bg-slate-50"><ChevronRight className="size-5" /></button></div><AddLessonDialog compact students={students} defaultDate={selectedDate} onAdd={onAdd} /></div>}>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]"><section className="card p-4 md:p-7"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold md:text-2xl">Расписание на день</h2><p className="mt-1 text-sm text-slate-500">{plural(selectedLessons.length, "занятие", "занятия", "занятий")}</p></div><button onClick={() => setView("calendar")} className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 md:block">Открыть календарь</button></div><LessonList lessons={selectedLessons} /></section>
      <aside className="space-y-6"><section className="card p-5 md:p-6"><h2 className="mb-4 text-xl font-bold">Требуют внимания</h2>{requests.length > 0 && <Attention icon={Bell} tone="rose" title={plural(requests.length, "запрос", "запроса", "запросов")} text="ожидают решения" onClick={() => setView("requests")} />}{debtCount > 0 && <Attention icon={UserRound} tone="rose" title={plural(debtCount, "ученик", "ученика", "учеников")} text="с задолженностью" onClick={() => setView("students")} />}{withoutLessonCount > 0 && <Attention icon={Clock3} tone="amber" title={plural(withoutLessonCount, "ученик", "ученика", "учеников")} text="без следующего урока" onClick={() => setView("students")} />}{requests.length === 0 && debtCount === 0 && withoutLessonCount === 0 && <p className="py-4 text-sm text-slate-500">Всё в порядке — ничего срочного.</p>}</section><section className="rounded-[24px] bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-200/70"><p className="text-sm font-semibold text-indigo-100">Ближайший урок</p>{nextLesson ? <><p className="mt-3 text-2xl font-bold">{nextLesson.name} · {nextLesson.time}</p><p className="mt-1 text-sm text-indigo-100">{dateTitle(nextLesson.date, { weekday: "long", day: "numeric", month: "long" })}</p><button onClick={() => onOpenStudent(nextLesson.studentId)} className="mt-5 w-full rounded-xl bg-white/15 px-4 py-3 text-sm font-semibold hover:bg-white/20">Открыть карточку</button></> : <p className="mt-3 text-indigo-100">Будущих уроков пока нет</p>}</section></aside></div>
  </Shell>;
}

function LessonList({ lessons, onSelect }: { lessons: Lesson[]; onSelect?: (lesson: Lesson) => void }) {
  return <div className="space-y-3">{lessons.length ? lessons.map((lesson) => <button key={lesson.id} onClick={() => onSelect?.(lesson)} className="group grid w-full grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md md:grid-cols-[74px_minmax(0,1fr)_auto] md:p-4"><span className="text-sm font-semibold leading-5 text-slate-700"><span className="block">{lesson.time}</span><span className="block font-normal text-slate-400">{lesson.end}</span></span><span className="min-w-0 border-l border-slate-200 pl-3 md:pl-5"><span className="block truncate text-base font-bold md:text-lg">{lesson.name}</span><span className="mt-0.5 block truncate text-sm text-slate-500">Барабаны · Студия</span></span><span className="flex items-center gap-2"><span className={`hidden rounded-full px-3 py-1.5 text-xs font-semibold ring-1 sm:inline-flex ${statusStyles[lesson.status]}`}>{lesson.label}</span>{onSelect && <ChevronRight className="size-5 text-slate-400" />}</span></button>) : <Empty text="На этот день уроков нет" />}</div>;
}

function Attention({ icon: Icon, tone, title, text, onClick }: { icon: typeof Bell; tone: "rose" | "amber"; title: string; text: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-slate-50"><span className={`grid size-11 place-items-center rounded-xl ${tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}><Icon className="size-5" /></span><span><span className="block text-sm font-bold">{title}</span><span className="block text-sm text-slate-500">{text}</span></span><ChevronRight className="ml-auto size-4 text-slate-400" /></button>;
}

function CalendarView({ lessons, students, onAdd, onUpdate, onDelete }: { lessons: Lesson[]; students: Student[]; onAdd: (lesson: LessonDraft) => Promise<boolean>; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean> }) {
  const [mode, setMode] = useState<"day" | "week" | "month">("month");
  const [cursor, setCursor] = useState(today);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const cursorDate = dateAtNoon(cursor);
  const monthStart = new Date(Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth(), 1, 12));
  const gridStart = new Date(monthStart); gridStart.setUTCDate(gridStart.getUTCDate() - ((gridStart.getUTCDay() + 6) % 7));
  const monthDays = Array.from({ length: 42 }, (_, index) => shiftDate(toIsoDate(gridStart), index));
  const weekStart = shiftDate(cursor, -((cursorDate.getUTCDay() + 6) % 7));
  const visibleDates = mode === "day" ? [cursor] : Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const move = (direction: number) => setCursor((date) => mode === "day" ? shiftDate(date, direction) : mode === "week" ? shiftDate(date, direction * 7) : shiftMonth(date, direction));
  const title = mode === "month" ? dateTitle(cursor, { month: "long", year: "numeric" }) : mode === "week" ? `${dateTitle(visibleDates[0])} — ${dateTitle(visibleDates[6], { day: "numeric", month: "long", year: "numeric" })}` : dateTitle(cursor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const selectedLessons = selectedDate ? lessons.filter((lesson) => lesson.date === selectedDate) : [];

  return <Shell title="Календарь" actions={<AddLessonDialog students={students} defaultDate={cursor} onAdd={onAdd} />}>
    <div className="card calendar-surface overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="flex rounded-xl bg-slate-100 p-1">{(["day", "week", "month"] as const).map((item) => <button key={item} onClick={() => setMode(item)} className={`rounded-lg px-4 py-2 text-sm ${mode === item ? "bg-white font-semibold text-indigo-700 shadow-sm" : "text-slate-500"}`}>{item === "day" ? "День" : item === "week" ? "Неделя" : "Месяц"}</button>)}</div>
        <div className="flex items-center gap-2"><button onClick={() => move(-1)} aria-label="Назад" className="grid size-10 place-items-center rounded-xl border"><ChevronLeft className="size-4" /></button><button onClick={() => setCursor(today())} className="min-w-44 px-2 text-center text-base font-bold capitalize">{title}</button><button onClick={() => move(1)} aria-label="Вперёд" className="grid size-10 place-items-center rounded-xl border"><ChevronRight className="size-4" /></button></div>
      </div>
      {mode === "month" ? <MonthGrid dates={monthDays} cursor={cursor} lessons={lessons} onSelect={setSelectedDate} /> : <ScheduleColumns dates={visibleDates} lessons={lessons} onSelectDate={setSelectedDate} onSelectLesson={setEditing} />}
    </div>
    <Dialog open={selectedDate !== null} onOpenChange={(open) => !open && setSelectedDate(null)}><DialogContent className="rounded-3xl sm:max-w-2xl"><DialogHeader><DialogTitle className="text-2xl capitalize">{selectedDate && dateTitle(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</DialogTitle><DialogDescription>{selectedLessons.length} занятий</DialogDescription></DialogHeader><LessonList lessons={selectedLessons} onSelect={setEditing} /><DialogFooter><DialogClose asChild><Button variant="outline">Закрыть</Button></DialogClose>{selectedDate && <AddLessonDialog students={students} defaultDate={selectedDate} onAdd={onAdd} compact />}</DialogFooter></DialogContent></Dialog>
    <EditLessonDialog key={editing?.id ?? "no-lesson"} lesson={editing} onOpenChange={(open) => !open && setEditing(null)} onUpdate={onUpdate} onDelete={onDelete} />
  </Shell>;
}

function MonthGrid({ dates, cursor, lessons, onSelect }: { dates: string[]; cursor: string; lessons: Lesson[]; onSelect: (date: string) => void }) {
  const month = cursor.slice(0, 7);
  return <><div className="grid grid-cols-7 border-b bg-slate-50">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, index) => <div key={day} className={`p-3 text-center text-sm font-semibold text-slate-500 ${index > 4 ? "calendar-weekend-header" : ""}`}>{day}</div>)}</div><div className="grid grid-cols-7">{dates.map((date) => { const dayLessons = lessons.filter((lesson) => lesson.date === date); const currentMonth = date.startsWith(month); const weekend = [0, 6].includes(dateAtNoon(date).getUTCDay()); return <button key={date} onClick={() => onSelect(date)} className={`min-h-20 border-b border-r p-2 text-left transition hover:bg-indigo-50/50 md:min-h-32 md:p-3 ${date === today() ? "bg-indigo-50" : weekend ? "calendar-weekend" : "calendar-weekday"}`}><span className={`grid size-7 place-items-center rounded-full text-sm font-semibold ${date === today() ? "bg-indigo-600 text-white" : currentMonth ? weekend ? "calendar-weekend-date" : "text-slate-700" : "text-slate-300"}`}>{Number(date.slice(-2))}</span><span className="mt-2 hidden space-y-1 md:block">{dayLessons.slice(0, 2).map((lesson) => <span key={lesson.id} className={`block truncate rounded-md px-2 py-1 text-xs ${statusStyles[lesson.status]}`}>{lesson.time} {lesson.name.split(" ")[0]}</span>)}</span>{dayLessons.length > 2 && <span className="mt-1 block text-xs text-slate-500">ещё {dayLessons.length - 2}</span>}</button>; })}</div></>;
}

function ScheduleColumns({ dates, lessons, onSelectDate, onSelectLesson }: { dates: string[]; lessons: Lesson[]; onSelectDate: (date: string) => void; onSelectLesson: (lesson: Lesson) => void }) {
  return <div className={`grid divide-x ${dates.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-7"}`}>{dates.map((date) => { const dayLessons = lessons.filter((lesson) => lesson.date === date); const weekend = [0, 6].includes(dateAtNoon(date).getUTCDay()); return <section key={date} className={`min-h-64 p-3 ${weekend ? "calendar-weekend" : ""}`}><button onClick={() => onSelectDate(date)} className="mb-3 w-full rounded-xl p-2 text-center hover:bg-indigo-50"><span className="block text-xs uppercase text-slate-500">{dateTitle(date, { weekday: "short" })}</span><strong className={date === today() ? "text-indigo-600" : weekend ? "calendar-weekend-date" : ""}>{dateTitle(date)}</strong></button><div className="space-y-2">{dayLessons.map((lesson) => <button key={lesson.id} onClick={() => onSelectLesson(lesson)} className={`w-full rounded-xl p-3 text-left text-sm ${statusStyles[lesson.status]}`}><strong className="block">{lesson.time}</strong><span className="block truncate">{lesson.name}</span></button>)}{!dayLessons.length && <p className="py-8 text-center text-xs text-slate-400">Нет уроков</p>}</div></section>; })}</div>;
}

function StudentsView({ students, onAdd, onOpen }: { students: Student[]; onAdd: (student: StudentDraft) => Promise<boolean>; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("Все");
  const filtered = useMemo(() => students.filter((student) => student.name.toLowerCase().includes(query.toLowerCase()) && (filter === "Все" || filter === "Плавающее" && student.floating || filter === "Постоянное" && !student.floating || filter === "Задолженность" && student.balance < 0 || filter === "Без урока" && student.next === "Не назначен")), [students, query, filter]);
  return <Shell title="Ученики" actions={<AddStudentSheet onAdd={onAdd} />}><div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="relative max-w-md flex-1"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени" className="h-12 rounded-xl bg-white pl-11" /></div><div className="flex gap-2 overflow-x-auto pb-1">{["Все", "Постоянное", "Плавающее", "Задолженность", "Без урока"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${filter === item ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>{item}</button>)}</div></div><div className="card overflow-hidden"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="px-5">Ученик</TableHead><TableHead>Расписание</TableHead><TableHead>Следующий урок</TableHead><TableHead>Баланс</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((student) => <TableRow key={student.id} onClick={() => onOpen(student.id)} className="cursor-pointer"><TableCell className="px-5 py-5"><span className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-indigo-50 font-bold text-indigo-700">{student.initials}</span><strong>{student.name}</strong></span></TableCell><TableCell><span className={student.floating ? "rounded-full bg-indigo-50 px-3 py-1.5 text-indigo-700" : "text-slate-600"}>{student.schedule}</span></TableCell><TableCell className={student.next === "Не назначен" ? "text-amber-700" : "text-slate-600"}>{student.next}</TableCell><TableCell><Balance balance={student.balance} /></TableCell><TableCell><ChevronRight className="size-5 text-slate-400" /></TableCell></TableRow>)}</TableBody></Table>{!filtered.length && <Empty text="Ученики не найдены" />}</div></Shell>;
}

function Balance({ balance }: { balance: number }) { return <span className={`inline-flex min-w-12 justify-center rounded-xl px-3 py-2 font-bold ${balance < 0 ? "bg-rose-50 text-rose-700" : balance <= 1 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{balance}</span>; }

function StudentView({ student, lessons, recurringSlots, balanceEntries, historyEvents, onAdd, onBack, onPay, onReversePayment, onCreateInvite, onUpdate, onStopSeries }: { student: Student; lessons: Lesson[]; recurringSlots: RecurringSlot[]; balanceEntries: BalanceEntry[]; historyEvents: HistoryEvent[]; onAdd: (lesson: LessonDraft) => Promise<boolean>; onBack: () => void; onPay: (id: string, count: number, date: string) => Promise<boolean>; onReversePayment: (id: string) => Promise<boolean>; onCreateInvite: (id: string) => Promise<string>; onUpdate: (student: Pick<Student, "id" | "name" | "email">) => Promise<boolean>; onStopSeries: (id: string) => Promise<boolean> }) {
  const history = balanceEntries.filter((entry) => entry.studentId === student.id);
  const studentHistory = historyEvents.filter((event) => event.studentId === student.id);
  const studentSlots = recurringSlots.filter((slot) => slot.studentId === student.id);
  return <Shell title={student.name} eyebrow={student.floating ? "Плавающее расписание" : "Постоянное расписание"} actions={<div className="flex flex-wrap gap-3"><EditStudentDialog student={student} onUpdate={onUpdate} />{student.accountStatus === "invited" && student.email && <InviteStudentDialog student={student} onCreateInvite={onCreateInvite} />}<AddLessonDialog students={[student]} defaultDate={today()} onAdd={onAdd} compact /><PaymentDialog student={student} onPay={onPay} /></div>}><button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600"><ArrowLeft className="size-4" />Назад к ученикам</button><div className={`mb-5 rounded-2xl border p-4 ${student.balance < 0 ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}><strong>Баланс: {student.balance} занятия</strong>{student.balance < 0 && <span className="ml-2 text-sm">Необходимо оплатить {Math.abs(student.balance)} занятия</span>}</div><Tabs defaultValue="overview"><TabsList variant="line" className="mb-5 max-w-full overflow-x-auto"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="lessons">Будущие уроки</TabsTrigger><TabsTrigger value="history">История</TabsTrigger><TabsTrigger value="payments">Оплаты</TabsTrigger></TabsList><TabsContent value="overview"><div className="grid gap-5 md:grid-cols-2"><InfoCard title="Следующий урок" icon={CalendarDays}><p className="text-2xl font-bold">{student.next}</p><p className="mt-1 text-slate-500">Продолжительность: 1 час</p></InfoCard><InfoCard title="Расписание" icon={Clock3}><p className="text-lg font-bold">{student.floating ? "Регулярного расписания нет" : student.schedule}</p>{studentSlots.length ? <div className="mt-4 space-y-2">{studentSlots.map((slot) => <div key={slot.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><span>{slot.label}</span><StopSeriesDialog slot={slot} onStop={onStopSeries} /></div>)}</div> : <p className="mt-1 text-slate-500">{student.floating ? "Следующий урок назначается отдельно" : "Постоянные занятия не заданы"}</p>}</InfoCard></div></TabsContent><TabsContent value="lessons"><div className="card p-5"><LessonList lessons={lessons.filter((lesson) => lesson.studentId === student.id && lesson.date >= today())} /></div></TabsContent><TabsContent value="history"><HistoryTimeline events={studentHistory} showStudent={false} onReversePayment={onReversePayment} /></TabsContent><TabsContent value="payments"><BalanceHistory entries={history.filter((entry) => entry.kind === "payment" || entry.kind === "refund")} onReversePayment={onReversePayment} /></TabsContent></Tabs></Shell>;
}

function StopSeriesDialog({ slot, onStop }: { slot: RecurringSlot; onStop: (id: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [pending, setPending] = useState(false);
  const stop = async () => { setPending(true); const saved = await onStop(slot.id); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">Остановить</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle>Остановить постоянное занятие?</DialogTitle><DialogDescription>{slot.label}. Все будущие уроки этого времени будут отменены без списания. Уже проведённые занятия сохранятся в истории.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button variant="destructive" disabled={pending} onClick={() => void stop()}>{pending ? "Останавливаю…" : "Остановить расписание"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EditStudentDialog({ student, onUpdate }: { student: Student; onUpdate: (student: Pick<Student, "id" | "name" | "email">) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [firstName, ...surnameParts] = student.name.split(/\s+/);
  const [name, setName] = useState(firstName ?? "");
  const [surname, setSurname] = useState(surnameParts.join(" "));
  const [email, setEmail] = useState(student.email ?? "");
  const [pending, setPending] = useState(false);
  const changeOpen = (next: boolean) => { setOpen(next); if (next) { const [first, ...rest] = student.name.split(/\s+/); setName(first ?? ""); setSurname(rest.join(" ")); setEmail(student.email ?? ""); } };
  const submit = async () => {
    setPending(true);
    const saved = await onUpdate({ id: student.id, name: [name.trim(), surname.trim()].filter(Boolean).join(" "), email: email.trim() || undefined });
    setPending(false);
    if (saved) setOpen(false);
  };
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button variant="outline" className="h-11 rounded-xl"><Pencil />Изменить данные</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Данные ученика</DialogTitle><DialogDescription>Имя обязательно. Email нужен только для личного кабинета ученика.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Имя *"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></Field><Field label="Фамилия"><Input value={surname} onChange={(event) => setSurname(event.target.value)} maxLength={80} /></Field></div><Field label="Email"><Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Необязательно" readOnly={student.accountStatus === "active"} /></Field>{student.accountStatus === "active" && <p className="text-sm text-slate-500">Email уже связан со входом ученика и здесь не изменяется.</p>}<DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button className="bg-indigo-600" disabled={pending || !name.trim()} onClick={() => void submit()}>{pending ? "Сохраняю…" : "Сохранить"}</Button></DialogFooter></DialogContent></Dialog>;
}

function InviteStudentDialog({ student, onCreateInvite }: { student: Student; onCreateInvite: (id: string) => Promise<string> }) {
  const [open, setOpen] = useState(false); const [url, setUrl] = useState(""); const [pending, setPending] = useState(false);
  const prepare = async () => { setOpen(true); setPending(true); setUrl(""); try { setUrl(await onCreateInvite(student.id)); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось создать приглашение"); setOpen(false); } finally { setPending(false); } };
  const copy = async () => { await navigator.clipboard.writeText(url); toast.success("Ссылка скопирована — отправьте её ученику"); };
  const share = async () => { if (navigator.share) await navigator.share({ title: `Приглашение для ${student.name}`, text: "Войдите в кабинет ученика по ссылке:", url }); else await copy(); };
  return <Dialog open={open} onOpenChange={setOpen}><Button variant="outline" className="h-11 rounded-xl" onClick={() => void prepare()}><Send />Пригласить ученика</Button><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Пригласить {student.name}</DialogTitle><DialogDescription>Отправьте эту персональную ссылку ученику в Telegram, WhatsApp, почте или другом удобном месте. По ней ученик задаст пароль и войдёт в свой кабинет.</DialogDescription></DialogHeader>{pending ? <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">Готовим приглашение…</p> : <><Field label="Персональная ссылка"><Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></Field><p className="text-sm text-slate-500">Ссылка действует 14 дней. Создание новой ссылки отключит предыдущую.</p></>}<DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Закрыть</Button><Button variant="outline" disabled={!url} onClick={() => void copy()}><Copy />Скопировать ссылку</Button><Button disabled={!url} className="bg-indigo-600" onClick={() => void share()}><Send />Отправить</Button></DialogFooter></DialogContent></Dialog>;
}

function InfoCard({ title, icon: Icon, children }: { title: string; icon: typeof CalendarDays; children: React.ReactNode }) { return <section className="card p-6"><div className="mb-5 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="size-5" /></span><h2 className="text-lg font-bold">{title}</h2></div>{children}</section>; }

function HistoryView({ events, students, onReversePayment }: { events: HistoryEvent[]; students: Student[]; onReversePayment: (id: string) => Promise<boolean> }) {
  const [category, setCategory] = useState<"all" | HistoryEvent["category"]>("all");
  const [studentId, setStudentId] = useState("all");
  const visible = events.filter((event) => (category === "all" || event.category === category) && (studentId === "all" || event.studentId === studentId));
  return <Shell title="История" eyebrow="Уроки, оплаты и запросы"><div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="flex gap-2 overflow-x-auto pb-1">{[["all", "Все"], ["lesson", "Уроки"], ["payment", "Баланс"], ["request", "Запросы"]].map(([value, label]) => <button key={value} onClick={() => setCategory(value as "all" | HistoryEvent["category"])} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${category === value ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>{label}</button>)}</div><Select value={studentId} onValueChange={setStudentId}><SelectTrigger className="h-11 w-full rounded-xl bg-white xl:w-72" aria-label="Ученик"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все ученики</SelectItem>{students.map((student) => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}</SelectContent></Select></div><HistoryTimeline events={visible} onReversePayment={onReversePayment} /></Shell>;
}

function HistoryTimeline({ events, showStudent = true, onReversePayment }: { events: HistoryEvent[]; showStudent?: boolean; onReversePayment?: (id: string) => Promise<boolean> }) {
  const colors = { lesson: "bg-indigo-50 text-indigo-700", payment: "bg-emerald-50 text-emerald-700", request: "bg-amber-50 text-amber-700" };
  const labels = { lesson: "Урок", payment: "Баланс", request: "Запрос" };
  const Icons = { lesson: CalendarDays, payment: WalletCards, request: Bell };
  const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  return <div className="card divide-y">{events.map((event) => { const Icon = Icons[event.category]; return <article key={event.id} className="flex gap-4 p-5 md:p-6"><span className={`grid size-11 shrink-0 place-items-center rounded-xl ${colors[event.category]}`}><Icon className="size-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"><div><span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${colors[event.category]}`}>{labels[event.category]}</span><strong>{event.title}</strong></div><time className="shrink-0 text-xs text-slate-400">{dateTime.format(new Date(event.occurredAt))}</time></div>{showStudent && <p className="mt-1 font-medium text-slate-700">{event.studentName}</p>}{event.detail && <p className="mt-1 text-sm text-slate-500">{event.detail}</p>}{event.actor && <p className="mt-2 text-xs text-slate-400">Кто: {event.actor}</p>}{event.canReverse && event.sourceId && onReversePayment && <div className="mt-3"><ReversePaymentButton paymentId={event.sourceId} onReverse={onReversePayment} /></div>}</div></article>; })}{!events.length && <Empty text="История пока пуста" />}</div>;
}

function BalanceHistory({ entries, onReversePayment }: { entries: BalanceEntry[]; onReversePayment?: (id: string) => Promise<boolean> }) { return <div className="card divide-y">{entries.map((entry) => <div key={entry.id} className="flex items-center gap-4 p-5"><span className={`grid size-11 place-items-center rounded-xl font-bold ${entry.units > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{entry.units > 0 ? "+" : ""}{entry.units}</span><span className="min-w-0 flex-1"><strong className="block">{entry.note}{entry.reversed ? " · отменена" : ""}</strong><span className="text-sm text-slate-500">{dateTitle(entry.date, { day: "numeric", month: "long", year: "numeric" })}</span>{entry.kind === "payment" && !entry.reversed && onReversePayment && <span className="mt-2 block"><ReversePaymentButton paymentId={entry.id} onReverse={onReversePayment} /></span>}</span></div>)}{!entries.length && <Empty text="История пока пуста" />}</div>; }

function ReversePaymentButton({ paymentId, onReverse }: { paymentId: string; onReverse: (id: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [pending, setPending] = useState(false);
  const reverse = async () => { setPending(true); const saved = await onReverse(paymentId); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">Отменить оплату</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-md"><DialogHeader><DialogTitle>Отменить ошибочную оплату?</DialogTitle><DialogDescription>Исходная запись останется в истории. Будет создана обратная операция, а баланс ученика уменьшится на то же количество занятий.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button variant="destructive" disabled={pending} onClick={() => void reverse()}>{pending ? "Отменяю…" : "Отменить оплату"}</Button></DialogFooter></DialogContent></Dialog>;
}

function SettingsView({ profile, onSave }: { profile: { name: string; email: string }; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    try { await onSave(name.trim()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить настройки"); }
    finally { setPending(false); }
  };
  return <Shell title="Настройки" eyebrow="Профиль преподавателя"><section className="card max-w-2xl p-6 md:p-8"><h2 className="text-xl font-bold">Основные данные</h2><p className="mt-1 text-sm text-slate-500">Это имя видно в меню и в кабинете ваших учеников.</p><div className="mt-6 space-y-5"><Field label="Имя преподавателя"><Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} placeholder="Ваше имя" className="h-11 rounded-xl" /></Field><Field label="Email для входа"><Input value={profile.email} readOnly className="h-11 rounded-xl opacity-70" /></Field><p className="text-sm text-slate-500">Email управляется в Supabase и здесь не изменяется.</p><Button onClick={() => void save()} disabled={pending || name.trim().length < 2 || name.trim() === profile.name} className="bg-indigo-600">{pending ? "Сохраняю…" : "Сохранить изменения"}</Button></div></section></Shell>;
}

function RequestsView({ requests, onResolved }: { requests: LessonRequest[]; onResolved: () => Promise<void> }) {
  const [filter, setFilter] = useState("Все");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const visibleRequests = requests.filter((request) => filter === "Все" || filter === "Отмена" && request.kind === "cancel" || filter === "Перенос" && request.kind === "reschedule" || filter === "Новый урок" && request.kind === "new_lesson");
  const resolve = async (id: string, decision: "approved" | "declined") => { setPendingId(id); try { await saveAppData({ action: "resolveRequest", requestId: id, decision }); await onResolved(); toast.success(decision === "approved" ? "Запрос подтверждён" : "Запрос отклонён"); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось обработать запрос"); } finally { setPendingId(null); } };
  return <Shell title="Запросы" eyebrow={`${requests.length} требуют ответа`}><div className="mb-5 flex gap-2 overflow-x-auto">{["Все", "Отмена", "Перенос", "Новый урок"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${filter === item ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>{item}</button>)}</div><div className="grid gap-4">{visibleRequests.map((request, index) => <article key={request.id} className={`card p-5 md:p-6 ${request.kind === "cancel" ? "border-amber-300 bg-amber-50/40" : ""}`}><div className="flex flex-col gap-5 md:flex-row md:items-center"><span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${request.kind === "cancel" ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}>{request.kind === "cancel" ? <Bell className="size-5" /> : index === 1 ? <Clock3 className="size-5" /> : <Plus className="size-5" />}</span><div className="min-w-0 flex-1"><p className={`text-sm font-bold ${request.kind === "cancel" ? "text-amber-700" : "text-indigo-600"}`}>{request.type}</p><h2 className="mt-1 text-xl font-bold">{request.name}</h2><p className="mt-1 text-slate-600">{request.detail}</p><p className="mt-2 text-sm text-slate-500">{request.note}</p></div><div className="flex flex-col gap-2 sm:flex-row"><Button disabled={pendingId !== null} onClick={() => void resolve(request.id, "approved")} className="rounded-xl bg-indigo-600">{pendingId === request.id ? "Сохраняю…" : "Подтвердить"}</Button><Button disabled={pendingId !== null} onClick={() => void resolve(request.id, "declined")} variant="outline" className="rounded-xl">Отклонить</Button></div></div></article>)}{visibleRequests.length === 0 && <Empty text={requests.length === 0 ? "Все запросы обработаны" : "В этой категории запросов нет"} />}</div></Shell>;
}

function NotificationsView({ notifications, onRead }: { notifications: AppNotification[]; onRead: () => Promise<void> }) {
  return <Shell title="Уведомления" eyebrow={`${notifications.filter((item) => !item.read).length} непрочитанных`} actions={<Button variant="outline" disabled={!notifications.some((item) => !item.read)} onClick={() => void onRead()}>Отметить всё прочитанным</Button>}><div className="card divide-y">{notifications.map((item) => <article key={item.id} className={`flex gap-4 p-5 ${item.read ? "opacity-60" : "bg-indigo-50/40"}`}><span className={`mt-1 size-2.5 shrink-0 rounded-full ${item.read ? "bg-slate-300" : "bg-indigo-600"}`} /><div><h2 className="font-bold">{item.title}</h2><p className="mt-1 text-sm text-slate-600">{item.body}</p><p className="mt-2 text-xs text-slate-400">{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(item.createdAt))}</p></div></article>)}{!notifications.length && <Empty text="Новых уведомлений нет" />}</div></Shell>;
}

function StudentPortal({ student, teacherName, lessons, entries, historyEvents, requests, notifications, onReadNotifications, onRequest, onBack }: { student: Student; teacherName: string; lessons: Lesson[]; entries: BalanceEntry[]; historyEvents: HistoryEvent[]; requests: LessonRequest[]; notifications: AppNotification[]; onReadNotifications: () => Promise<void>; onRequest: (body: { requestType: "cancel" | "reschedule" | "new_lesson"; lessonId?: string; proposedDate?: string; proposedTime?: string; message?: string; studentId?: string }) => Promise<boolean>; onBack: () => void }) {
  const futureLessons = lessons.filter((lesson) => lesson.date >= today()).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const nextLesson = futureLessons[0];
  const paymentEntries = entries.filter((entry) => entry.kind === "payment" || entry.kind === "refund");
  return <main className="min-h-screen bg-background px-4 pb-24 pt-5 text-foreground"><div className="mx-auto max-w-lg">
    <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500"><LogOut className="size-4" />Выйти</button>
    <div className="mb-7 flex items-center justify-between"><div><h1 className="text-3xl font-bold">Привет, {student.name.split(" ")[0]}</h1><p className="mt-1 text-slate-500">Ваше расписание занятий</p></div><div className="flex items-center gap-2"><ThemeToggle compact /><span className="grid size-12 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">{student.initials.slice(0, 1)}</span></div></div>
    {notifications.some((item) => !item.read) && <button onClick={() => void onReadNotifications()} className="mb-4 flex w-full items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-left text-indigo-900"><Bell className="mt-0.5 size-5 shrink-0" /><span><strong className="block">{notifications.find((item) => !item.read)?.title}</strong><span className="mt-1 block text-sm">{notifications.find((item) => !item.read)?.body}</span></span></button>}
    {nextLesson ? <section className="card p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-500">Следующий урок</p><h2 className="mt-3 text-2xl font-bold capitalize">{dateTitle(nextLesson.date, { weekday: "long", day: "numeric", month: "long" })}</h2><p className="mt-2 text-3xl font-bold">{nextLesson.time}–{nextLesson.end}</p><p className="mt-2 text-slate-500">{teacherName}</p></div><span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${statusStyles[nextLesson.status]}`}>{nextLesson.label}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><StudentRequestDialog type="reschedule" lesson={nextLesson} student={student} onRequest={onRequest} /><StudentRequestDialog type="cancel" lesson={nextLesson} student={student} onRequest={onRequest} /></div><p className="mt-3 text-center text-sm text-slate-500">Отмену можно запросить до 23:59 предыдущего дня</p></section> : <section className="card"><Empty text="Следующий урок пока не назначен" /></section>}
    {futureLessons.length > 1 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Дальнейшие занятия</h2><div className="card divide-y">{futureLessons.slice(1).map((lesson) => <article key={lesson.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><strong className="capitalize">{dateTitle(lesson.date, { weekday: "long", day: "numeric", month: "long" })}</strong><p className="mt-1 text-sm text-slate-500">{lesson.time}–{lesson.end}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[lesson.status]}`}>{lesson.label}</span></div><div className="mt-3 grid grid-cols-2 gap-2"><StudentRequestDialog type="reschedule" lesson={lesson} student={student} onRequest={onRequest} /><StudentRequestDialog type="cancel" lesson={lesson} student={student} onRequest={onRequest} /></div></article>)}</div></section>}
    <section className={`mt-4 rounded-3xl border p-6 ${student.balance < 0 ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><div className="flex items-center gap-3"><WalletCards className="size-6" /><div><p className="font-semibold opacity-70">Баланс</p><p className="text-2xl font-bold">{student.balance} занятий</p></div></div>{student.balance < 0 && <p className="mt-3">Необходимо оплатить {Math.abs(student.balance)} занятий</p>}</section>
    {student.floating && <div className="mt-4"><StudentRequestDialog type="new_lesson" student={student} onRequest={onRequest} fullWidth /></div>}
    {requests.length > 0 && <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Запросы на рассмотрении</h2><div className="card divide-y">{requests.map((request) => <div key={request.id} className="p-4"><strong>{request.type}</strong><p className="mt-1 text-sm text-slate-500">{request.detail}</p></div>)}</div></section>}
    <section className="mt-5"><h2 className="mb-3 text-lg font-bold">История</h2><HistoryTimeline events={historyEvents} showStudent={false} /></section>
    <section className="mt-5"><h2 className="mb-3 text-lg font-bold">Оплаты</h2><BalanceHistory entries={paymentEntries} /></section>
  </div><Toaster position="top-center" richColors /></main>;
}

function StudentRequestDialog({ type, lesson, student, onRequest, fullWidth = false }: { type: "cancel" | "reschedule" | "new_lesson"; lesson?: Lesson; student: Student; onRequest: (body: { requestType: "cancel" | "reschedule" | "new_lesson"; lessonId?: string; proposedDate?: string; proposedTime?: string; message?: string; studentId?: string }) => Promise<boolean>; fullWidth?: boolean }) {
  const [open, setOpen] = useState(false); const [date, setDate] = useState(lesson?.date ?? shiftDate(today(), 1)); const [time, setTime] = useState(lesson?.time ?? "17:00"); const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  const cancellationExpired = type === "cancel" && Boolean(lesson && lesson.date <= today());
  const label = cancellationExpired ? "Срок отмены истёк" : type === "cancel" ? "Запросить отмену" : type === "reschedule" ? "Запросить перенос" : "Предложить время урока";
  const submit = async () => { setPending(true); const saved = await onRequest({ requestType: type, lessonId: lesson?.id, proposedDate: type === "cancel" ? undefined : date, proposedTime: type === "cancel" ? undefined : time, message, studentId: student.id }); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="lg" disabled={cancellationExpired} variant={type === "cancel" ? "outline" : "default"} className={`${fullWidth ? "w-full" : ""} h-12 rounded-xl ${type === "cancel" ? "" : "bg-indigo-600"}`}>{label}</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{type === "cancel" ? "Преподаватель получит запрос. Своевременный запрос не будет списан, даже если останется без ответа." : "Предложите удобные дату и время. Урок появится в расписании после подтверждения преподавателем."}</DialogDescription></DialogHeader>{type !== "cancel" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Дата"><Input type="date" value={date} min={today()} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Время"><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field></div>}<Field label="Комментарий"><Input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Необязательно" /></Field><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Назад</Button><Button className="bg-indigo-600" disabled={pending || (type !== "cancel" && (!date || !time))} onClick={() => void submit()}>{pending ? "Отправляю…" : "Отправить запрос"}</Button></DialogFooter></DialogContent></Dialog>;
}

function AddLessonDialog({ students, defaultDate, onAdd, compact = false }: { students: Student[]; defaultDate: string; onAdd: (lesson: LessonDraft) => Promise<boolean>; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("17:00");
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");
  const [pending, setPending] = useState(false);
  const changeOpen = (next: boolean) => { setOpen(next); if (next) { setDate(defaultDate < today() ? today() : defaultDate); setStudentId((current) => students.some((student) => student.id === current) ? current : (students[0]?.id ?? "")); } };
  const submit = async () => { setPending(true); const saved = await onAdd({ date, time, studentId, repeat }); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button size={compact ? "default" : "lg"} disabled={!students.length} className="h-11 rounded-xl bg-indigo-600 px-5 text-base shadow-lg shadow-indigo-200 hover:bg-indigo-700"><Plus />{compact ? "Добавить" : "Добавить урок"}</Button></DialogTrigger><DialogContent className="gap-0 overflow-hidden rounded-[22px] border-0 p-0 sm:max-w-xl"><DialogHeader className="border-b p-6 pr-14"><DialogTitle className="text-2xl">Новый урок</DialogTitle><DialogDescription>Добавьте разовое или постоянное занятие.</DialogDescription></DialogHeader><div className="space-y-5 p-6"><Field label="Ученик"><Select value={studentId} onValueChange={setStudentId}><SelectTrigger aria-label="Ученик" className="h-11 w-full rounded-xl"><SelectValue placeholder="Выберите ученика" /></SelectTrigger><SelectContent>{students.map((student) => <SelectItem value={student.id} key={student.id}>{student.name}</SelectItem>)}</SelectContent></Select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Дата"><Input aria-label="Дата" type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} className="h-11 rounded-xl" /></Field><Field label="Время"><TimeField value={time} onChange={setTime} /></Field></div><Field label="Повторение"><Select value={repeat} onValueChange={(value) => setRepeat(value as "once" | "weekly")}><SelectTrigger aria-label="Повторение" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="once">Не повторять</SelectItem><SelectItem value="weekly">Каждую неделю</SelectItem></SelectContent></Select></Field></div><DialogFooter className="border-t bg-slate-50 p-5"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !studentId || !date || !time} onClick={() => void submit()} className="bg-indigo-600">{pending ? "Сохраняю…" : "Сохранить урок"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EditLessonDialog({ lesson, onOpenChange, onUpdate, onDelete }: { lesson: Lesson | null; onOpenChange: (open: boolean) => void; onUpdate: (id: string, date: string, time: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean> }) {
  const [date, setDate] = useState(lesson?.date ?? today());
  const [time, setTime] = useState(lesson?.time ?? "17:00");
  const [pending, setPending] = useState(false);
  const update = async () => { if (!lesson) return; setPending(true); const saved = await onUpdate(lesson.id, date, time); setPending(false); if (saved) onOpenChange(false); };
  const remove = async () => { if (!lesson) return; setPending(true); const saved = await onDelete(lesson.id); setPending(false); if (saved) onOpenChange(false); };
  return <Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">{lesson?.name}</DialogTitle><DialogDescription>Перенесите урок или отмените его без списания.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Новая дата"><Input type="date" min={today()} value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Новое время"><TimeField value={time} onChange={setTime} /></Field></div><DialogFooter className="sm:justify-between"><Button variant="destructive" disabled={pending} onClick={() => void remove()}><Trash2 />{pending ? "Сохраняю…" : "Отменить урок"}</Button><div className="flex gap-2"><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Закрыть</Button><Button className="bg-indigo-600" disabled={pending || !date || !time} onClick={() => void update()}>Перенести</Button></div></DialogFooter></DialogContent></Dialog>;
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
  const [open, setOpen] = useState(false); const [count, setCount] = useState(8); const [paymentDate, setPaymentDate] = useState(today); const [pending, setPending] = useState(false);
  const submit = async () => { setPending(true); const saved = await onPay(student.id, count, paymentDate); setPending(false); if (saved) setOpen(false); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="lg" className="h-11 rounded-xl bg-indigo-600"><Plus />Добавить оплату</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">Добавить оплату</DialogTitle><DialogDescription>{student.name}</DialogDescription></DialogHeader><div className={`rounded-2xl p-4 font-semibold ${student.balance < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-700"}`}>Текущий баланс: {student.balance} занятия</div><Field label="Количество занятий"><Input aria-label="Количество занятий" type="number" min="1" max="100" value={count} onChange={(event) => setCount(Number(event.target.value))} className="h-11 rounded-xl" /></Field><Field label="Дата оплаты"><Input aria-label="Дата оплаты" type="date" max={today()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="h-11 rounded-xl" /></Field><div className="rounded-2xl bg-emerald-50 p-4 text-emerald-800">После оплаты баланс составит <strong>{student.balance + count} занятий</strong></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !Number.isInteger(count) || count < 1 || !paymentDate} onClick={() => void submit()} className="bg-indigo-600">{pending ? "Сохраняю…" : "Добавить оплату"}</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const shift = (hours: number) => {
    const [rawHours, rawMinutes] = value.split(":").map(Number);
    if (!Number.isFinite(rawHours) || !Number.isFinite(rawMinutes)) return;
    onChange(`${String((rawHours + hours + 24) % 24).padStart(2, "0")}:${String(rawMinutes).padStart(2, "0")}`);
  };
  return <div className="flex min-w-0 gap-2"><Button type="button" variant="outline" size="icon" aria-label="Уменьшить время на час" onClick={() => shift(-1)} className="h-11 shrink-0 rounded-xl"><Minus className="size-4" /></Button><Input aria-label="Время" type="time" step="3600" value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-0 rounded-xl text-center" /><Button type="button" variant="outline" size="icon" aria-label="Увеличить время на час" onClick={() => shift(1)} className="h-11 shrink-0 rounded-xl"><Plus className="size-4" /></Button></div>;
}
function Empty({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center p-6 text-center text-slate-500"><div><CalendarDays className="mx-auto mb-3 size-7 text-slate-300" /><p>{text}</p></div></div>; }
