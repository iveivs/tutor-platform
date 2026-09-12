"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3,
  Home, LogOut, Menu, Plus, Search, Settings, Trash2, UserRound, UsersRound, WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/theme-toggle";

type View = "today" | "calendar" | "students" | "requests" | "student" | "portal";
type Lesson = { id: string; date: string; time: string; end: string; name: string; status: "paid" | "low" | "debt" | "request"; label: string };
type LessonDraft = { date: string; time: string; name: string; repeat: "once" | "weekly" };
type Student = { id: string; name: string; email?: string; initials: string; schedule: string; next: string; balance: number; floating: boolean };
type LessonRequest = { id: string; type: string; kind: string; name: string; detail: string; note: string };
type BalanceEntry = { id: string; studentId: string; kind: string; units: number; note: string; date: string };
type AppData = { lessons: Lesson[]; students: Student[]; requests: LessonRequest[]; balanceEntries: BalanceEntry[] };

async function readAppData(): Promise<AppData> {
  const response = await fetch("/api/app-data", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить данные");
  return response.json() as Promise<AppData>;
}

async function saveAppData(body: Record<string, unknown>) {
  const response = await fetch("/api/app-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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

export default function TutorApp({ role = "owner", onLogout }: { role?: "owner" | "teacher" | "student"; onLogout?: () => void }) {
  const [view, setView] = useState<View>("today");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [requests, setRequests] = useState<LessonRequest[]>([]);
  const [balanceEntries, setBalanceEntries] = useState<BalanceEntry[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("101");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const applyData = useCallback((data: AppData) => {
    setLessons(data.lessons); setStudents(data.students); setRequests(data.requests); setBalanceEntries(data.balanceEntries ?? []);
    setSelectedStudent((current) => data.students.some((student) => student.id === current) ? current : (data.students[0]?.id ?? current));
  }, []);

  const reload = useCallback(async () => {
    const data = await readAppData(); applyData(data); setLoadError(false); setLoading(false);
  }, [applyData]);

  useEffect(() => { void reload().catch(() => { setLoadError(true); setLoading(false); }); }, [reload]);

  const addLesson = async (lesson: LessonDraft) => {
    try { await saveAppData({ action: "createLesson", student: lesson.name, date: lesson.date, time: lesson.time, repeat: lesson.repeat }); await reload(); toast.success("Урок добавлен в расписание"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить урок"); }
  };
  const updateLesson = async (lessonId: string, date: string, time: string) => {
    try { await saveAppData({ action: "updateLesson", lessonId, date, time }); await reload(); toast.success("Урок перенесён"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось перенести урок"); }
  };
  const deleteLesson = async (lessonId: string) => {
    try { await saveAppData({ action: "deleteLesson", lessonId }); await reload(); toast.success("Урок отменён без списания"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отменить урок"); }
  };
  const addStudent = async (student: Omit<Student, "id">) => {
    try { const result = await saveAppData({ action: "createStudent", name: student.name, email: student.email, floating: student.floating }); await reload(); if (result.inviteUrl) { await navigator.clipboard?.writeText(result.inviteUrl); toast.success("Ученик создан. Ссылка-приглашение скопирована"); } else toast.success("Ученик сохранён в базе"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось создать ученика"); }
  };
  const addPayment = async (studentId: string, count: number, paymentDate: string) => {
    try { await saveAppData({ action: "addPayment", studentId, count, paymentDate }); await reload(); toast.success(`Добавлено ${count} занятий`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить оплату"); }
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
      execute(input: unknown) {
        const { student, date, time } = input as { student?: unknown; date?: unknown; time?: unknown };
        if (typeof student !== "string" || student.trim().length < 2 || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Проверьте ученика, дату и время");
        void saveAppData({ action: "createLesson", student: student.trim(), date, time, repeat: "once" }).then(reload);
        return { status: "created", student: student.trim(), date, time };
      },
    });
    return () => lifecycle.abort();
  }, [lessons, reload]);

  if (role === "student") return <StudentPortal onBack={onLogout ?? (() => undefined)} studentMode />;
  if (view === "portal") return <StudentPortal onBack={() => setView("today")} />;
  if (loading) return <main className="grid min-h-screen place-items-center bg-background text-foreground"><div className="text-center"><CalendarDays className="mx-auto mb-3 size-8 animate-pulse text-indigo-600" /><p className="font-semibold">Загружаю расписание…</p></div></main>;
  if (loadError) return <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Данные временно недоступны</h1><p className="mt-2 text-slate-500">Локальная база не ответила. Попробуйте ещё раз.</p><Button className="mt-5 bg-indigo-600" onClick={() => { setLoading(true); void reload().catch(() => { setLoadError(true); setLoading(false); }); }}>Повторить</Button></div></main>;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Sidebar view={view} setView={setView} onPortal={() => setView("portal")} onLogout={onLogout} requestCount={requests.length} />
      <section className="min-h-screen pb-24 lg:ml-[272px] lg:pb-0">
        <MobileHeader />
        {view === "today" && <TodayView lessons={lessons} students={students} onAdd={addLesson} setView={setView} />}
        {view === "calendar" && <CalendarView lessons={lessons} students={students} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} />}
        {view === "students" && <StudentsView students={students} onAdd={addStudent} onOpen={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "student" && students.length > 0 && <StudentView student={students.find((student) => student.id === selectedStudent) ?? students[0]} lessons={lessons} balanceEntries={balanceEntries} onAdd={addLesson} onBack={() => setView("students")} onPay={addPayment} />}
        {view === "requests" && <RequestsView requests={requests} onResolved={reload} />}
      </section>
      <MobileNav view={view} setView={setView} />
      <Toaster position="top-right" richColors />
    </main>
  );
}

function Sidebar({ view, setView, onPortal, onLogout, requestCount }: { view: View; setView: (view: View) => void; onPortal: () => void; onLogout?: () => void; requestCount: number }) {
  const items = [
    { id: "today" as View, label: "Сегодня", icon: Home },
    { id: "calendar" as View, label: "Календарь", icon: CalendarDays },
    { id: "students" as View, label: "Ученики", icon: UsersRound },
    { id: "requests" as View, label: "Запросы", icon: Bell, count: requestCount },
    { id: "settings" as View, label: "Настройки", icon: Settings },
  ];
  return <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-slate-200 bg-white lg:flex">
    <div className="border-b border-slate-200 px-7 py-7"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200"><CalendarDays className="size-6" /></span><div><p className="text-xl font-bold tracking-tight">Репетитор</p><p className="mt-0.5 text-sm text-slate-500">Анна Петрова</p></div></div></div>
    <nav className="flex-1 space-y-2 p-5" aria-label="Основная навигация">{items.map(({ id, label, icon: Icon, count }) => <button key={label} onClick={() => id !== "settings" && setView(id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-base font-medium transition ${view === id || (id === "students" && view === "student") ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon className="size-5" /><span>{label}</span>{count ? <span className="ml-auto rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white">{count}</span> : null}</button>)}</nav>
    <div className="border-t border-slate-200 p-5"><ThemeToggle /><button onClick={onPortal} className="mb-2 flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"><UserRound className="size-5" />Кабинет ученика</button><button onClick={onLogout} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm text-slate-600 hover:bg-slate-50"><LogOut className="size-5" />Выйти</button></div>
  </aside>;
}

function MobileHeader() {
  return <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden"><div className="flex items-center gap-3"><button aria-label="Открыть меню" className="grid size-10 place-items-center rounded-xl border border-slate-200"><Menu className="size-5" /></button><div><p className="font-bold">Репетитор</p><p className="text-xs text-slate-500">Анна Петрова</p></div></div><div className="flex items-center gap-2"><ThemeToggle compact /><button aria-label="Уведомления" className="relative grid size-10 place-items-center rounded-xl border border-slate-200"><Bell className="size-5" /><span className="absolute right-2 top-2 size-2 rounded-full bg-rose-500" /></button></div></header>;
}

function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  const items = [{ id: "today" as View, label: "Сегодня", icon: Home }, { id: "calendar" as View, label: "Календарь", icon: CalendarDays }, { id: "students" as View, label: "Ученики", icon: UsersRound }, { id: "requests" as View, label: "Запросы", icon: Bell }];
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden" aria-label="Мобильная навигация">{items.map(({ id, label, icon: Icon }) => <button key={label} onClick={() => setView(id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium ${view === id || (id === "students" && view === "student") ? "text-indigo-600" : "text-slate-500"}`}><Icon className="size-5" />{label}</button>)}</nav>;
}

function Shell({ eyebrow, title, actions, children }: { eyebrow?: string; title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-9 xl:px-12"><div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div>{eyebrow && <p className="mb-1 text-sm font-semibold text-indigo-600">{eyebrow}</p>}<h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1></div>{actions}</div>{children}</div>;
}

function TodayView({ lessons, students, onAdd, setView }: { lessons: Lesson[]; students: Student[]; onAdd: (lesson: LessonDraft) => void; setView: (view: View) => void }) {
  const [selectedDate, setSelectedDate] = useState(today);
  const selectedLessons = lessons.filter((lesson) => lesson.date === selectedDate);
  const todayDate = today();
  const relative = selectedDate === todayDate ? "Сегодня" : selectedDate === shiftDate(todayDate, 1) ? "Завтра" : selectedDate === shiftDate(todayDate, -1) ? "Вчера" : "Расписание";
  return <Shell eyebrow="Ваш рабочий день" title={`${relative}, ${dateTitle(selectedDate)}`} actions={<div className="flex flex-wrap gap-3"><div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><button onClick={() => setSelectedDate((date) => shiftDate(date, -1))} aria-label="Предыдущий день" className="grid size-11 place-items-center hover:bg-slate-50"><ChevronLeft className="size-5" /></button><button onClick={() => setSelectedDate(todayDate)} className="border-x border-slate-200 px-4 text-sm font-semibold">{dateTitle(selectedDate, { day: "numeric", month: "long", year: "numeric" })}</button><button onClick={() => setSelectedDate((date) => shiftDate(date, 1))} aria-label="Следующий день" className="grid size-11 place-items-center hover:bg-slate-50"><ChevronRight className="size-5" /></button></div><AddLessonDialog students={students} defaultDate={selectedDate} onAdd={onAdd} /></div>}>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]"><section className="card p-4 md:p-7"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold md:text-2xl">Расписание на день</h2><p className="mt-1 text-sm text-slate-500">{selectedLessons.length} занятий</p></div><button onClick={() => setView("calendar")} className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 md:block">Открыть календарь</button></div><LessonList lessons={selectedLessons} /></section>
      <aside className="space-y-6"><section className="card p-5 md:p-6"><h2 className="mb-4 text-xl font-bold">Требуют внимания</h2><Attention icon={Bell} tone="rose" title="2 запроса" text="на перенос или отмену" onClick={() => setView("requests")} /><Attention icon={UserRound} tone="rose" title="3 ученика" text="с задолженностью" onClick={() => setView("students")} /><Attention icon={Clock3} tone="amber" title="1 ученик" text="без следующего урока" onClick={() => setView("students")} /></section><section className="rounded-[24px] bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-200/70"><p className="text-sm font-semibold text-indigo-100">Ближайший урок</p><p className="mt-3 text-2xl font-bold">Иван · 10:00</p><p className="mt-1 text-sm text-indigo-100">Начнётся через 35 минут</p><button onClick={() => setView("student")} className="mt-5 w-full rounded-xl bg-white/15 px-4 py-3 text-sm font-semibold hover:bg-white/20">Открыть карточку</button></section></aside></div>
  </Shell>;
}

function LessonList({ lessons, onSelect }: { lessons: Lesson[]; onSelect?: (lesson: Lesson) => void }) {
  return <div className="space-y-3">{lessons.length ? lessons.map((lesson) => <button key={lesson.id} onClick={() => onSelect?.(lesson)} className="group grid w-full grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md md:grid-cols-[74px_minmax(0,1fr)_auto] md:p-4"><span className="text-sm font-semibold leading-5 text-slate-700"><span className="block">{lesson.time}</span><span className="block font-normal text-slate-400">{lesson.end}</span></span><span className="min-w-0 border-l border-slate-200 pl-3 md:pl-5"><span className="block truncate text-base font-bold md:text-lg">{lesson.name}</span><span className="mt-0.5 block truncate text-sm text-slate-500">Барабаны · Студия</span></span><span className="flex items-center gap-2"><span className={`hidden rounded-full px-3 py-1.5 text-xs font-semibold ring-1 sm:inline-flex ${statusStyles[lesson.status]}`}>{lesson.label}</span>{onSelect && <ChevronRight className="size-5 text-slate-400" />}</span></button>) : <Empty text="На этот день уроков нет" />}</div>;
}

function Attention({ icon: Icon, tone, title, text, onClick }: { icon: typeof Bell; tone: "rose" | "amber"; title: string; text: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-slate-50"><span className={`grid size-11 place-items-center rounded-xl ${tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}><Icon className="size-5" /></span><span><span className="block text-sm font-bold">{title}</span><span className="block text-sm text-slate-500">{text}</span></span><ChevronRight className="ml-auto size-4 text-slate-400" /></button>;
}

function CalendarView({ lessons, students, onAdd, onUpdate, onDelete }: { lessons: Lesson[]; students: Student[]; onAdd: (lesson: LessonDraft) => void; onUpdate: (id: string, date: string, time: string) => void; onDelete: (id: string) => void }) {
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
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="flex rounded-xl bg-slate-100 p-1">{(["day", "week", "month"] as const).map((item) => <button key={item} onClick={() => setMode(item)} className={`rounded-lg px-4 py-2 text-sm ${mode === item ? "bg-white font-semibold text-indigo-700 shadow-sm" : "text-slate-500"}`}>{item === "day" ? "День" : item === "week" ? "Неделя" : "Месяц"}</button>)}</div>
        <div className="flex items-center gap-2"><button onClick={() => move(-1)} aria-label="Назад" className="grid size-10 place-items-center rounded-xl border"><ChevronLeft className="size-4" /></button><button onClick={() => setCursor(today())} className="min-w-44 px-2 text-center text-base font-bold capitalize">{title}</button><button onClick={() => move(1)} aria-label="Вперёд" className="grid size-10 place-items-center rounded-xl border"><ChevronRight className="size-4" /></button></div>
      </div>
      {mode === "month" ? <MonthGrid dates={monthDays} cursor={cursor} lessons={lessons} onSelect={setSelectedDate} /> : <ScheduleColumns dates={visibleDates} lessons={lessons} onSelectDate={setSelectedDate} onSelectLesson={setEditing} />}
    </div>
    <Dialog open={selectedDate !== null} onOpenChange={(open) => !open && setSelectedDate(null)}><DialogContent className="rounded-3xl sm:max-w-2xl"><DialogHeader><DialogTitle className="text-2xl capitalize">{selectedDate && dateTitle(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</DialogTitle><DialogDescription>{selectedLessons.length} занятий</DialogDescription></DialogHeader><LessonList lessons={selectedLessons} onSelect={setEditing} /><DialogFooter><DialogClose asChild><Button variant="outline">Закрыть</Button></DialogClose>{selectedDate && <AddLessonDialog students={students} defaultDate={selectedDate} onAdd={onAdd} compact />}</DialogFooter></DialogContent></Dialog>
    <EditLessonDialog lesson={editing} onOpenChange={(open) => !open && setEditing(null)} onUpdate={onUpdate} onDelete={onDelete} />
  </Shell>;
}

function MonthGrid({ dates, cursor, lessons, onSelect }: { dates: string[]; cursor: string; lessons: Lesson[]; onSelect: (date: string) => void }) {
  const month = cursor.slice(0, 7);
  return <><div className="grid grid-cols-7 border-b bg-slate-50">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <div key={day} className="p-3 text-center text-sm font-semibold text-slate-500">{day}</div>)}</div><div className="grid grid-cols-7">{dates.map((date) => { const dayLessons = lessons.filter((lesson) => lesson.date === date); const currentMonth = date.startsWith(month); return <button key={date} onClick={() => onSelect(date)} className={`min-h-20 border-b border-r p-2 text-left transition hover:bg-indigo-50/50 md:min-h-32 md:p-3 ${date === today() ? "bg-indigo-50" : "bg-white"}`}><span className={`grid size-7 place-items-center rounded-full text-sm font-semibold ${date === today() ? "bg-indigo-600 text-white" : currentMonth ? "text-slate-700" : "text-slate-300"}`}>{Number(date.slice(-2))}</span><span className="mt-2 hidden space-y-1 md:block">{dayLessons.slice(0, 2).map((lesson) => <span key={lesson.id} className={`block truncate rounded-md px-2 py-1 text-xs ${statusStyles[lesson.status]}`}>{lesson.time} {lesson.name.split(" ")[0]}</span>)}</span>{dayLessons.length > 2 && <span className="mt-1 block text-xs text-slate-500">ещё {dayLessons.length - 2}</span>}</button>; })}</div></>;
}

function ScheduleColumns({ dates, lessons, onSelectDate, onSelectLesson }: { dates: string[]; lessons: Lesson[]; onSelectDate: (date: string) => void; onSelectLesson: (lesson: Lesson) => void }) {
  return <div className={`grid divide-x ${dates.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-7"}`}>{dates.map((date) => { const dayLessons = lessons.filter((lesson) => lesson.date === date); return <section key={date} className="min-h-64 p-3"><button onClick={() => onSelectDate(date)} className="mb-3 w-full rounded-xl p-2 text-center hover:bg-indigo-50"><span className="block text-xs uppercase text-slate-500">{dateTitle(date, { weekday: "short" })}</span><strong className={date === today() ? "text-indigo-600" : ""}>{dateTitle(date)}</strong></button><div className="space-y-2">{dayLessons.map((lesson) => <button key={lesson.id} onClick={() => onSelectLesson(lesson)} className={`w-full rounded-xl p-3 text-left text-sm ${statusStyles[lesson.status]}`}><strong className="block">{lesson.time}</strong><span className="block truncate">{lesson.name}</span></button>)}{!dayLessons.length && <p className="py-8 text-center text-xs text-slate-400">Нет уроков</p>}</div></section>; })}</div>;
}

function StudentsView({ students, onAdd, onOpen }: { students: Student[]; onAdd: (student: Omit<Student, "id">) => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("Все");
  const filtered = useMemo(() => students.filter((student) => student.name.toLowerCase().includes(query.toLowerCase()) && (filter === "Все" || filter === "Плавающее" && student.floating || filter === "Постоянное" && !student.floating || filter === "Задолженность" && student.balance < 0 || filter === "Без урока" && student.next === "Не назначен")), [students, query, filter]);
  return <Shell title="Ученики" actions={<AddStudentSheet onAdd={onAdd} />}><div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="relative max-w-md flex-1"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени" className="h-12 rounded-xl bg-white pl-11" /></div><div className="flex gap-2 overflow-x-auto pb-1">{["Все", "Постоянное", "Плавающее", "Задолженность", "Без урока"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${filter === item ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>{item}</button>)}</div></div><div className="card overflow-hidden"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="px-5">Ученик</TableHead><TableHead>Расписание</TableHead><TableHead>Следующий урок</TableHead><TableHead>Баланс</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((student) => <TableRow key={student.id} onClick={() => onOpen(student.id)} className="cursor-pointer"><TableCell className="px-5 py-5"><span className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-indigo-50 font-bold text-indigo-700">{student.initials}</span><strong>{student.name}</strong></span></TableCell><TableCell><span className={student.floating ? "rounded-full bg-indigo-50 px-3 py-1.5 text-indigo-700" : "text-slate-600"}>{student.schedule}</span></TableCell><TableCell className={student.next === "Не назначен" ? "text-amber-700" : "text-slate-600"}>{student.next}</TableCell><TableCell><Balance balance={student.balance} /></TableCell><TableCell><ChevronRight className="size-5 text-slate-400" /></TableCell></TableRow>)}</TableBody></Table>{!filtered.length && <Empty text="Ученики не найдены" />}</div></Shell>;
}

function Balance({ balance }: { balance: number }) { return <span className={`inline-flex min-w-12 justify-center rounded-xl px-3 py-2 font-bold ${balance < 0 ? "bg-rose-50 text-rose-700" : balance <= 1 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{balance}</span>; }

function StudentView({ student, lessons, balanceEntries, onAdd, onBack, onPay }: { student: Student; lessons: Lesson[]; balanceEntries: BalanceEntry[]; onAdd: (lesson: LessonDraft) => void; onBack: () => void; onPay: (id: string, count: number, date: string) => void }) {
  const history = balanceEntries.filter((entry) => entry.studentId === student.id);
  return <Shell title={student.name} eyebrow={student.floating ? "Плавающее расписание" : "Постоянное расписание"} actions={<div className="flex flex-wrap gap-3"><AddLessonDialog students={[student]} defaultDate={today()} onAdd={onAdd} compact /><PaymentDialog student={student} onPay={onPay} /></div>}><button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600"><ArrowLeft className="size-4" />Назад к ученикам</button><div className={`mb-5 rounded-2xl border p-4 ${student.balance < 0 ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}><strong>Баланс: {student.balance} занятия</strong>{student.balance < 0 && <span className="ml-2 text-sm">Необходимо оплатить {Math.abs(student.balance)} занятия</span>}</div><Tabs defaultValue="overview"><TabsList variant="line" className="mb-5 max-w-full overflow-x-auto"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="lessons">Будущие уроки</TabsTrigger><TabsTrigger value="history">История занятий</TabsTrigger><TabsTrigger value="payments">Оплаты</TabsTrigger></TabsList><TabsContent value="overview"><div className="grid gap-5 md:grid-cols-2"><InfoCard title="Следующий урок" icon={CalendarDays}><p className="text-2xl font-bold">{student.next}</p><p className="mt-1 text-slate-500">Продолжительность: 1 час</p></InfoCard><InfoCard title="Расписание" icon={Clock3}><p className="text-lg font-bold">{student.floating ? "Регулярного расписания нет" : student.schedule}</p><p className="mt-1 text-slate-500">{student.floating ? "Следующий урок назначается отдельно" : "Без даты окончания"}</p></InfoCard></div></TabsContent><TabsContent value="lessons"><div className="card p-5"><LessonList lessons={lessons.filter((lesson) => lesson.name === student.name && lesson.date >= today())} /></div></TabsContent><TabsContent value="history"><History entries={history} /></TabsContent><TabsContent value="payments"><History entries={history.filter((entry) => entry.kind === "payment")} /></TabsContent></Tabs></Shell>;
}

function InfoCard({ title, icon: Icon, children }: { title: string; icon: typeof CalendarDays; children: React.ReactNode }) { return <section className="card p-6"><div className="mb-5 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="size-5" /></span><h2 className="text-lg font-bold">{title}</h2></div>{children}</section>; }
function History({ entries }: { entries: BalanceEntry[] }) { return <div className="card divide-y">{entries.map((entry) => <div key={entry.id} className="flex items-center gap-4 p-5"><span className={`grid size-11 place-items-center rounded-xl font-bold ${entry.units > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{entry.units > 0 ? "+" : ""}{entry.units}</span><span><strong className="block">{entry.note}</strong><span className="text-sm text-slate-500">{dateTitle(entry.date, { day: "numeric", month: "long", year: "numeric" })}</span></span></div>)}{!entries.length && <Empty text="История пока пуста" />}</div>; }

function RequestsView({ requests, onResolved }: { requests: LessonRequest[]; onResolved: () => Promise<void> }) {
  const resolve = async (id: string, decision: "approved" | "declined") => { try { await saveAppData({ action: "resolveRequest", requestId: id, decision }); await onResolved(); toast.success(decision === "approved" ? "Запрос подтверждён" : "Запрос отклонён"); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось обработать запрос"); } };
  return <Shell title="Запросы" eyebrow={`${requests.length} требуют ответа`}><div className="mb-5 flex gap-2 overflow-x-auto">{["Все", "Отмена", "Перенос", "Новый урок"].map((item, index) => <button key={item} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${index === 0 ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>{item}</button>)}</div><div className="grid gap-4">{requests.map((request, index) => <article key={request.id} className={`card p-5 md:p-6 ${request.kind === "cancel" ? "border-amber-300 bg-amber-50/40" : ""}`}><div className="flex flex-col gap-5 md:flex-row md:items-center"><span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${request.kind === "cancel" ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}>{request.kind === "cancel" ? <Bell className="size-5" /> : index === 1 ? <Clock3 className="size-5" /> : <Plus className="size-5" />}</span><div className="min-w-0 flex-1"><p className={`text-sm font-bold ${request.kind === "cancel" ? "text-amber-700" : "text-indigo-600"}`}>{request.type}</p><h2 className="mt-1 text-xl font-bold">{request.name}</h2><p className="mt-1 text-slate-600">{request.detail}</p><p className="mt-2 text-sm text-slate-500">{request.note}</p></div><div className="flex flex-col gap-2 sm:flex-row"><Button onClick={() => void resolve(request.id, "approved")} className="rounded-xl bg-indigo-600">Подтвердить</Button><Button onClick={() => void resolve(request.id, "declined")} variant="outline" className="rounded-xl">Отклонить</Button></div></div></article>)}{requests.length === 0 && <Empty text="Все запросы обработаны" />}</div></Shell>;
}

function StudentPortal({ onBack, studentMode = false }: { onBack: () => void; studentMode?: boolean }) {
  return <main className="min-h-screen bg-[#f6f8fc] px-4 pb-24 pt-5 text-slate-950"><div className="mx-auto max-w-lg"><button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500"><ArrowLeft className="size-4" />{studentMode ? "Выйти" : "К кабинету преподавателя"}</button><div className="mb-7 flex items-center justify-between"><div><h1 className="text-3xl font-bold">Привет, Иван</h1><p className="mt-1 text-slate-500">Ваше ближайшее занятие</p></div><span className="grid size-12 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">И</span></div><section className="card p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-500">Следующий урок</p><h2 className="mt-3 text-2xl font-bold">Среда, 18 сентября</h2><p className="mt-2 text-3xl font-bold">17:00–18:00</p><p className="mt-2 text-slate-500">Анна Петрова</p></div><span className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">Запланирован</span></div></section><section className="mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-6"><div className="flex items-center gap-3"><WalletCards className="size-6 text-rose-600" /><div><p className="font-semibold text-slate-600">Баланс</p><p className="text-2xl font-bold text-rose-700">−2 занятия</p></div></div><p className="mt-3 text-slate-600">Необходимо оплатить 2 занятия</p><button onClick={() => toast.info("Открыта история оплат")} className="mt-3 font-semibold text-indigo-600">История оплат</button></section><div className="mt-5 grid gap-3 sm:grid-cols-2"><Button onClick={() => toast.success("Запрос на перенос создан")} size="lg" className="h-12 rounded-xl bg-indigo-600">Запросить перенос</Button><Button onClick={() => toast.info("Отмену можно запросить до вторника, 23:59")} size="lg" variant="outline" className="h-12 rounded-xl">Запросить отмену</Button></div><p className="mt-3 text-center text-sm text-slate-500">Отмену можно запросить до вторника, 23:59</p></div><Toaster position="top-center" richColors /></main>;
}

function AddLessonDialog({ students, defaultDate, onAdd, compact = false }: { students: Student[]; defaultDate: string; onAdd: (lesson: LessonDraft) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(students[0]?.name ?? "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("17:00");
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");
  useEffect(() => { if (open) { setDate(defaultDate); setName((current) => students.some((student) => student.name === current) ? current : (students[0]?.name ?? "")); } }, [open, defaultDate, students]);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size={compact ? "default" : "lg"} className="h-11 rounded-xl bg-indigo-600 px-5 text-base shadow-lg shadow-indigo-200 hover:bg-indigo-700"><Plus />{compact ? "Добавить" : "Добавить урок"}</Button></DialogTrigger><DialogContent className="gap-0 overflow-hidden rounded-[22px] border-0 p-0 sm:max-w-xl"><DialogHeader className="border-b p-6 pr-14"><DialogTitle className="text-2xl">Новый урок</DialogTitle><DialogDescription>Добавьте разовое или постоянное занятие.</DialogDescription></DialogHeader><div className="space-y-5 p-6"><Field label="Ученик"><Select value={name} onValueChange={setName}><SelectTrigger aria-label="Ученик" className="h-11 w-full rounded-xl"><SelectValue placeholder="Выберите ученика" /></SelectTrigger><SelectContent>{students.map((student) => <SelectItem value={student.name} key={student.id}>{student.name}</SelectItem>)}</SelectContent></Select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Дата"><Input aria-label="Дата" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 rounded-xl" /></Field><Field label="Время"><Input aria-label="Время" type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-11 rounded-xl" /></Field></div><Field label="Повторение"><Select value={repeat} onValueChange={(value) => setRepeat(value as "once" | "weekly")}><SelectTrigger aria-label="Повторение" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="once">Не повторять</SelectItem><SelectItem value="weekly">Каждую неделю</SelectItem></SelectContent></Select></Field></div><DialogFooter className="border-t bg-slate-50 p-5"><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button disabled={!name || !date || !time} onClick={() => { onAdd({ date, time, name, repeat }); setOpen(false); }} className="bg-indigo-600">Сохранить урок</Button></DialogFooter></DialogContent></Dialog>;
}

function EditLessonDialog({ lesson, onOpenChange, onUpdate, onDelete }: { lesson: Lesson | null; onOpenChange: (open: boolean) => void; onUpdate: (id: string, date: string, time: string) => void; onDelete: (id: string) => void }) {
  const [date, setDate] = useState(lesson?.date ?? today());
  const [time, setTime] = useState(lesson?.time ?? "17:00");
  useEffect(() => { if (lesson) { setDate(lesson.date); setTime(lesson.time); } }, [lesson]);
  return <Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">{lesson?.name}</DialogTitle><DialogDescription>Перенесите урок или отмените его без списания.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Новая дата"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Новое время"><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field></div><DialogFooter className="sm:justify-between"><Button variant="destructive" onClick={() => { if (lesson) onDelete(lesson.id); onOpenChange(false); }}><Trash2 />Отменить урок</Button><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button><Button className="bg-indigo-600" onClick={() => { if (lesson) onUpdate(lesson.id, date, time); onOpenChange(false); }}>Перенести</Button></div></DialogFooter></DialogContent></Dialog>;
}

function AddStudentSheet({ onAdd }: { onAdd: (student: Omit<Student, "id">) => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [floating, setFloating] = useState("floating");
  return <Sheet><SheetTrigger asChild><Button size="lg" className="h-11 rounded-xl bg-indigo-600"><Plus />Добавить ученика</Button></SheetTrigger><SheetContent className="w-full gap-0 sm:max-w-lg"><SheetHeader className="border-b p-6"><SheetTitle className="text-2xl">Новый ученик</SheetTitle><SheetDescription>Создайте карточку и ссылку-приглашение.</SheetDescription></SheetHeader><div className="flex-1 space-y-5 overflow-y-auto p-6"><Field label="Имя"><Input aria-label="Имя" value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя ученика" className="h-11 rounded-xl" /></Field><Field label="Email"><Input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="student@example.com" className="h-11 rounded-xl" /></Field><Field label="Тип расписания"><Select value={floating} onValueChange={setFloating}><SelectTrigger aria-label="Тип расписания" className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Постоянное</SelectItem><SelectItem value="floating">Плавающее</SelectItem></SelectContent></Select></Field><div className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-800">После создания будет подготовлена ссылка, по которой ученик задаст личный пароль.</div></div><SheetFooter className="border-t p-5"><SheetClose asChild><Button variant="outline">Отмена</Button></SheetClose><SheetClose asChild><Button disabled={!name} onClick={() => onAdd({ name, email, initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2), schedule: floating === "floating" ? "Плавающее" : "Постоянное", next: "Не назначен", balance: 0, floating: floating === "floating" })} className="bg-indigo-600">Создать ученика</Button></SheetClose></SheetFooter></SheetContent></Sheet>;
}

function PaymentDialog({ student, onPay }: { student: Student; onPay: (id: string, count: number, date: string) => void }) {
  const [count, setCount] = useState(8); const [paymentDate, setPaymentDate] = useState(today);
  return <Dialog><DialogTrigger asChild><Button size="lg" className="h-11 rounded-xl bg-indigo-600"><Plus />Добавить оплату</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle className="text-2xl">Добавить оплату</DialogTitle><DialogDescription>{student.name}</DialogDescription></DialogHeader><div className={`rounded-2xl p-4 font-semibold ${student.balance < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-700"}`}>Текущий баланс: {student.balance} занятия</div><Field label="Количество занятий"><Input aria-label="Количество занятий" type="number" min="1" max="100" value={count} onChange={(event) => setCount(Number(event.target.value))} className="h-11 rounded-xl" /></Field><Field label="Дата оплаты"><Input aria-label="Дата оплаты" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="h-11 rounded-xl" /></Field><div className="rounded-2xl bg-emerald-50 p-4 text-emerald-800">После оплаты баланс составит <strong>{student.balance + count} занятий</strong></div><DialogFooter><DialogClose asChild><Button variant="outline">Отмена</Button></DialogClose><DialogClose asChild><Button disabled={!Number.isInteger(count) || count < 1 || !paymentDate} onClick={() => onPay(student.id, count, paymentDate)} className="bg-indigo-600">Добавить оплату</Button></DialogClose></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Empty({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center p-6 text-center text-slate-500"><div><CalendarDays className="mx-auto mb-3 size-7 text-slate-300" /><p>{text}</p></div></div>; }
