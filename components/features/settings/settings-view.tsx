"use client";

import { useState } from "react";
import { LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/common/app-shell";
import { FormField } from "@/components/common/form-field";
import type { AvailabilityWindow } from "@/components/features/app/types";
import { TelegramNotificationsCard } from "@/components/features/telegram/telegram-notifications-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { minutesToInputTime } from "@/lib/availability";

type SettingsViewProps = {
  profile: { name: string; professionalTitle: string; email: string };
  availabilityWindows: AvailabilityWindow[];
  onSave: (name: string, professionalTitle: string) => Promise<void>;
  onSaveAvailability: (windows: Array<{ weekday: number; start: string; end: string }>) => Promise<void>;
  onLogout?: () => void;
  isPlatformAdmin: boolean;
};

export function SettingsView({ profile, availabilityWindows, onSave, onSaveAvailability, onLogout, isPlatformAdmin }: SettingsViewProps) {
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

  return <AppShell title="Настройки" eyebrow="Профиль преподавателя"><div className="space-y-6">
    <section className="card max-w-2xl p-6 md:p-8">
      <h2 className="text-xl font-bold">Основные данные</h2>
      <p className="mt-1 text-sm text-slate-500">Это имя видно в меню и в кабинете ваших учеников.</p>
      <div className="mt-6 space-y-5">
        <FormField label="Имя преподавателя"><Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} placeholder="Ваше имя" className="h-11 rounded-xl" /></FormField>
        <FormField label="Название или роль"><Input value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} maxLength={50} placeholder="Например: Репетитор или Тренер" className="h-11 rounded-xl" /><p className="text-xs text-slate-500">Необязательно. Оставьте пустым, если подпись над именем не нужна.</p></FormField>
        <FormField label="Email для входа"><Input value={profile.email} readOnly className="h-11 rounded-xl opacity-70" /></FormField>
        <p className="text-sm text-slate-500">Email хранится в вашей учётной записи и сейчас не изменяется через настройки.</p>
        <Button onClick={() => void save()} disabled={pending || name.trim().length < 2 || name.trim() === profile.name && professionalTitle.trim() === profile.professionalTitle} className="w-full bg-indigo-600 sm:w-auto">{pending ? "Сохраняю…" : "Сохранить изменения"}</Button>
      </div>
    </section>
    <section className="card min-w-0 max-w-3xl overflow-hidden p-5 md:p-8">
      <h2 className="text-xl font-bold">Рабочие часы</h2>
      <p className="mt-1 text-sm text-slate-500">Эти интервалы используются для показа свободного времени ученикам, которым вы дали доступ. Можно добавить несколько интервалов на один день.</p>
      <div className="mt-6 space-y-3">{windows.map((window) => <div key={window.id} className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_130px_130px_auto] sm:items-end">
        <FormField label="День"><Select value={String(window.weekday)} onValueChange={(value) => changeWindow(window.id, { weekday: Number(value) })}><SelectTrigger className="h-11 w-full min-w-0 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{weekdays.map((day, index) => <SelectItem key={day} value={String(index + 1)}>{day}</SelectItem>)}</SelectContent></Select></FormField>
        <FormField label="Начало"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.start} onChange={(event) => changeWindow(window.id, { start: event.target.value })} /></FormField>
        <FormField label="Конец"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.end} onChange={(event) => changeWindow(window.id, { end: event.target.value })} /></FormField>
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
    {onLogout && <section className="card max-w-3xl p-5 lg:hidden"><h2 className="text-xl font-bold">Сеанс</h2><p className="mt-1 text-sm text-slate-500">Завершить работу в кабинете на этом устройстве.</p><Button type="button" variant="outline" onClick={onLogout} className="mt-4 h-11 w-full rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"><LogOut />Выйти</Button></section>}
  </div></AppShell>;
}
