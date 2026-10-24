"use client";

import { useState } from "react";
import { ChevronDown, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/common/app-shell";
import { useDesign } from "@/components/design-provider";
import { FormField } from "@/components/common/form-field";
import type { AvailabilityWindow } from "@/components/features/app/types";
import { TelegramNotificationsCard } from "@/components/features/telegram/telegram-notifications-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  const { design, setDesign, previewUnlocked } = useDesign();
  const [name, setName] = useState(profile.name);
  const [professionalTitle, setProfessionalTitle] = useState(profile.professionalTitle);
  const [pending, setPending] = useState(false);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const [expandedWeekday, setExpandedWeekday] = useState<number | null>(null);
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
      <p className="mt-1 text-sm text-ink-muted">Это имя видно в меню и в кабинете ваших учеников.</p>
      <div className="mt-6 space-y-5">
        <FormField label="Имя преподавателя"><Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} placeholder="Ваше имя" className="h-11 rounded-xl" /></FormField>
        <FormField label="Название или роль"><Input value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} maxLength={50} placeholder="Например: Репетитор или Тренер" className="h-11 rounded-xl" /><p className="text-xs text-ink-muted">Необязательно. Оставьте пустым, если подпись над именем не нужна.</p></FormField>
        <FormField label="Email для входа"><Input value={profile.email} readOnly className="h-11 rounded-xl opacity-70" /></FormField>
        <p className="text-sm text-ink-muted">Email хранится в вашей учётной записи и сейчас не изменяется через настройки.</p>
        <Button onClick={() => void save()} disabled={pending || name.trim().length < 2 || name.trim() === profile.name && professionalTitle.trim() === profile.professionalTitle} className="w-full bg-brand-solid sm:w-auto">{pending ? "Сохраняю…" : "Сохранить изменения"}</Button>
      </div>
    </section>
    <section className="card min-w-0 max-w-3xl overflow-hidden p-5 md:p-8">
      <h2 className="text-xl font-bold">Рабочие часы</h2>
      <p className="mt-1 text-sm text-ink-muted">Эти интервалы используются для показа свободного времени ученикам, которым вы дали доступ. Можно добавить несколько интервалов на один день.</p>
      <div className="mt-6 divide-y overflow-hidden rounded-2xl border border-line">{weekdays.map((day, index) => {
        const weekday = index + 1;
        const dayWindows = windows.filter((window) => window.weekday === weekday);
        const open = expandedWeekday === weekday;
        return <section key={day}><button type="button" className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50" aria-expanded={open} onClick={() => setExpandedWeekday(open ? null : weekday)}><span className="min-w-0 flex-1"><strong className="block">{day}</strong><span className="mt-1 block text-sm text-ink-muted">{dayWindows.length ? dayWindows.map((window) => `${window.start}–${window.end}`).join(", ") : "Выходной"}</span></span><ChevronDown className={`size-5 shrink-0 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`} /></button>{open && <div className="space-y-3 border-t border-line bg-slate-50/60 p-4">{dayWindows.map((window) => <div key={window.id} className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><FormField label="Начало"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.start} onChange={(event) => changeWindow(window.id, { start: event.target.value })} /></FormField><FormField label="Конец"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.end} onChange={(event) => changeWindow(window.id, { end: event.target.value })} /></FormField><Button type="button" variant="outline" aria-label="Удалить интервал" onClick={() => setWindows((current) => current.filter((item) => item.id !== window.id))}><Trash2 /><span className="sm:sr-only">Удалить интервал</span></Button>{window.end <= window.start && <p className="text-xs text-brand-text sm:col-span-3">Интервал заканчивается на следующий день.</p>}</div>)}<Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setWindows((current) => [...current, { id: crypto.randomUUID(), weekday, start: "10:00", end: "18:00" }])}><Plus />Добавить интервал</Button></div>}</section>;
      })}</div>
      <div className="mt-5 grid gap-3 pb-2 sm:flex sm:flex-wrap">
        <Button type="button" className="w-full bg-brand-solid sm:w-auto" disabled={availabilityPending || windows.some((window) => !window.start || !window.end || window.start === window.end)} onClick={() => void saveAvailability()}>{availabilityPending ? "Сохраняю…" : "Сохранить рабочие часы"}</Button>
      </div>
    </section>
    <TelegramNotificationsCard />
    {(isPlatformAdmin || previewUnlocked) && <section className="card max-w-3xl p-5 md:p-8"><h2 className="text-xl font-bold">Новый интерфейс</h2><p className="mt-1 text-sm text-ink-muted">Предварительная версия редизайна. Включается только на этом устройстве.</p><label className="mt-4 flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-line p-4"><span className="min-w-0"><strong className="block text-sm">Показывать новый интерфейс</strong><span className="mt-1 block text-xs leading-5 text-ink-muted">Изменения появляются поэтапно. Выключите, чтобы вернуться к привычному виду.</span></span><Switch checked={design === "v2"} onCheckedChange={(checked) => setDesign(checked ? "v2" : "v1")} aria-label="Показывать новый интерфейс" /></label></section>}
    {isPlatformAdmin && <section className="card max-w-3xl p-5 md:p-8"><h2 className="text-xl font-bold">Управление платформой</h2><p className="mt-1 text-sm text-ink-muted">Список кабинетов преподавателей и управление доступом.</p><Button asChild variant="outline" className="mt-4"><a href="/admin"><ShieldCheck />Открыть админку</a></Button></section>}
    {onLogout && <section className="card max-w-3xl p-5 lg:hidden"><h2 className="text-xl font-bold">Сеанс</h2><p className="mt-1 text-sm text-ink-muted">Завершить работу в кабинете на этом устройстве.</p><Button type="button" variant="outline" onClick={onLogout} className="mt-4 h-11 w-full rounded-xl text-danger-text hover:bg-rose-50 hover:text-rose-700"><LogOut />Выйти</Button></section>}
  </div></AppShell>;
}
