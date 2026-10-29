"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { AppShell } from "@/components/common/app-shell";
import { FormField } from "@/components/common/form-field";
import type { AvailabilityWindow } from "@/components/features/app/types";
import { TelegramNotificationsCard } from "@/components/features/telegram/telegram-notifications-card";
import { PushNotificationsCard } from "@/components/features/notifications/push-notifications-card";
import { SubscriptionCard } from "@/components/features/subscription/subscription-card";
import { useLanguage, type Language } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { minutesToInputTime } from "@/lib/availability";
import { SettingsGroup, settingsRowClass } from "./settings-group";

const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

type SettingsViewProps = {
  profile: { name: string; professionalTitle: string; email: string };
  availabilityWindows: AvailabilityWindow[];
  onSave: (name: string, professionalTitle: string) => Promise<void>;
  onSaveAvailability: (windows: Array<{ weekday: number; start: string; end: string }>) => Promise<void>;
  onLogout?: () => void;
  isPlatformAdmin: boolean;
};

export function SettingsView({ profile, availabilityWindows, onSave, onSaveAvailability, onLogout, isPlatformAdmin }: SettingsViewProps) {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState(profile.name);
  const [professionalTitle, setProfessionalTitle] = useState(profile.professionalTitle);
  const [pending, setPending] = useState(false);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const [expandedWeekday, setExpandedWeekday] = useState<number | null>(null);
  const initialWindows = () => availabilityWindows.map((window) => ({ id: window.id, weekday: window.weekday, start: minutesToInputTime(window.startMinutes), end: minutesToInputTime(window.endMinutes) }));
  const [windows, setWindows] = useState<Array<{ id: string; weekday: number; start: string; end: string }>>(initialWindows);
  const [windowsChanged, setWindowsChanged] = useState(false);

  const save = async () => {
    setPending(true);
    try { await onSave(name.trim(), professionalTitle.trim()); setEditingProfile(false); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить настройки"); }
    finally { setPending(false); }
  };

  const saveAvailability = async () => {
    setAvailabilityPending(true);
    try { await onSaveAvailability(windows.map(({ weekday, start, end }) => ({ weekday, start, end }))); setWindowsChanged(false); setExpandedWeekday(null); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить рабочие часы"); }
    finally { setAvailabilityPending(false); }
  };

  const updateWindows = (update: (current: typeof windows) => typeof windows) => { setWindows(update); setWindowsChanged(true); };
  const changeWindow = (id: string, patch: Partial<{ weekday: number; start: string; end: string }>) => updateWindows((current) => current.map((window) => window.id === id ? { ...window, ...patch } : window));
  const selectTrigger = "h-9 w-auto min-w-0 gap-1.5 border-0 bg-transparent px-2 text-sm text-ink-muted shadow-none dark:bg-transparent";

  return <AppShell title="Настройки"><div className="flex max-w-2xl flex-col gap-3">
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-solid text-[17px] font-bold text-white">{initials(profile.name)}</span>
        <span className="flex min-w-0 flex-1 flex-col"><strong className="truncate text-base">{profile.name}</strong>{profile.professionalTitle && <span className="line-clamp-2 text-sm text-ink-muted">{profile.professionalTitle}</span>}</span>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-brand-text" aria-expanded={editingProfile} onClick={() => setEditingProfile((current) => !current)}>{editingProfile ? "Свернуть" : "Изменить"}</Button>
      </div>
      {editingProfile && <div className="mt-4 space-y-4 border-t border-line pt-4">
        <FormField label="Имя преподавателя"><Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} placeholder="Ваше имя" className="h-11 rounded-xl" /><p className="text-xs text-ink-muted">Это имя видно в меню и в кабинете ваших учеников.</p></FormField>
        <FormField label="Название или роль"><Input value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} maxLength={50} placeholder="Например: Репетитор или Тренер" className="h-11 rounded-xl" /><p className="text-xs text-ink-muted">Необязательно. Оставьте пустым, если подпись над именем не нужна.</p></FormField>
        <FormField label="Email для входа"><Input value={profile.email} readOnly className="h-11 rounded-xl opacity-70" /><p className="text-xs text-ink-muted">Email хранится в вашей учётной записи и сейчас не изменяется через настройки.</p></FormField>
        <Button onClick={() => void save()} disabled={pending || name.trim().length < 2 || name.trim() === profile.name && professionalTitle.trim() === profile.professionalTitle} className="w-full sm:w-auto">{pending ? "Сохраняю…" : "Сохранить изменения"}</Button>
      </div>}
    </section>

    <SubscriptionCard />

    <SettingsGroup title="Рабочие часы">
      {weekdays.map((day, index) => {
        const weekday = index + 1;
        const dayWindows = windows.filter((window) => window.weekday === weekday);
        const open = expandedWeekday === weekday;
        return <div key={day} className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-line">
          <button type="button" className="flex min-h-[50px] w-full items-center gap-3 px-4 py-2.5 text-left" aria-expanded={open} onClick={() => setExpandedWeekday(open ? null : weekday)}>
            <span className="flex-1 text-[15px] font-semibold">{day}</span>
            <span className={`text-right text-sm ${dayWindows.length ? "" : "text-ink-muted"}`}>{dayWindows.length ? dayWindows.map((window) => `${window.start}–${window.end}`).join(", ") : "выходной"}</span>
            <ChevronDown className={`size-4 shrink-0 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && <div className="space-y-3 border-t border-line bg-surface-subtle p-4">
            {dayWindows.map((window) => <div key={window.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
              <FormField label="Начало"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.start} onChange={(event) => changeWindow(window.id, { start: event.target.value })} /></FormField>
              <FormField label="Конец"><Input className="mobile-time-input h-11 rounded-xl" type="time" value={window.end} onChange={(event) => changeWindow(window.id, { end: event.target.value })} /></FormField>
              <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Удалить интервал" onClick={() => updateWindows((current) => current.filter((item) => item.id !== window.id))}><Trash2 /></Button>
              {window.end <= window.start && <p className="col-span-3 text-xs text-brand-text">Интервал заканчивается на следующий день.</p>}
            </div>)}
            <Button type="button" variant="outline" size="sm" onClick={() => updateWindows((current) => [...current, { id: crypto.randomUUID(), weekday, start: "10:00", end: "18:00" }])}><Plus />Добавить интервал</Button>
          </div>}
        </div>;
      })}
    </SettingsGroup>
    {windowsChanged && <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={availabilityPending || windows.some((window) => !window.start || !window.end || window.start === window.end)} onClick={() => void saveAvailability()}>{availabilityPending ? "Сохраняю…" : "Сохранить рабочие часы"}</Button>
      <Button type="button" variant="outline" disabled={availabilityPending} onClick={() => { setWindows(initialWindows()); setWindowsChanged(false); }}>Отменить</Button>
    </div>}
    <p className="px-1 text-xs leading-5 text-ink-muted">Эти интервалы используются для показа свободного времени ученикам, которым вы дали доступ.</p>

    <PushNotificationsCard audience="teacher" />

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

    {isPlatformAdmin && <SettingsGroup title="Платформа">
      <a href="/admin" className={`${settingsRowClass} hover:bg-surface-subtle`}><span className="flex items-center gap-3 text-[15px]"><ShieldCheck className="size-5 text-brand-text" />Открыть админку</span><ChevronRight className="size-4 text-ink-subtle" /></a>
    </SettingsGroup>}

    {onLogout && <Button type="button" variant="outline" onClick={onLogout} className="mt-2 h-12 w-full rounded-xl bg-surface text-[15px] text-danger-text lg:hidden"><LogOut />Выйти</Button>}
  </div></AppShell>;
}
