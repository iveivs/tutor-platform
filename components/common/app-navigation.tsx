"use client";

import { CalendarDays, FolderOpen, Home, Inbox, LogOut, Settings, UsersRound } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";
import type { View } from "@/components/features/app/types";
import { ThemeToggle } from "@/components/theme-toggle";

export function Sidebar({ view, setView, name, professionalTitle, onLogout, activityCount }: { view: View; setView: (view: View) => void; name: string; professionalTitle: string; onLogout?: () => void; activityCount: number }) {
  const items = [
    { id: "today" as View, label: "Сегодня", icon: Home },
    { id: "calendar" as View, label: "Календарь", icon: CalendarDays },
    { id: "students" as View, label: "Ученики", icon: UsersRound },
    { id: "activity" as View, label: "События", icon: Inbox, count: activityCount },
    { id: "materials" as View, label: "Материалы", icon: FolderOpen },
    { id: "settings" as View, label: "Настройки", icon: Settings },
  ];
  return <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-line bg-surface lg:flex">
    <div className="border-b border-line px-7 py-7"><div className="flex items-center gap-3"><BrandIcon className="size-11 shadow-lg" /><div className="min-w-0">{professionalTitle && <p className="truncate text-sm font-medium text-ink-muted">{professionalTitle}</p>}<p className="truncate text-xl font-bold tracking-tight">{name}</p></div></div></div>
    <nav className="flex-1 space-y-2 p-5" aria-label="Основная навигация">{items.map(({ id, label, icon: Icon, count }) => <button key={label} onClick={() => setView(id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-base font-medium transition ${view === id || (id === "students" && view === "student") ? "bg-brand-soft text-brand-ink" : "text-ink-secondary hover:bg-slate-50 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-white"}`}><Icon className="size-5" /><span>{label}</span>{count ? <span className="ml-auto rounded-full bg-brand-solid px-2 py-0.5 text-xs text-white">{count}</span> : null}</button>)}</nav>
    <div className="border-t border-line p-5"><ThemeToggle /><button onClick={onLogout} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm text-ink-secondary transition hover:bg-slate-50 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-white"><LogOut className="size-5" />Выйти</button></div>
  </aside>;
}

export function MobileHeader({ name, professionalTitle, activityCount, onActivity }: { name: string; professionalTitle: string; activityCount: number; onActivity: () => void }) {
  return <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-surface-glass-90 px-4 backdrop-blur lg:hidden"><div className="flex min-w-0 items-center gap-2.5"><BrandIcon className="size-9" /><div className="min-w-0">{professionalTitle && <p className="truncate text-[11px] text-ink-muted">{professionalTitle}</p>}<p className="truncate font-bold">{name}</p></div></div><div className="flex items-center gap-2"><ThemeToggle compact /><button onClick={onActivity} aria-label="События" className="relative grid size-10 place-items-center rounded-xl border border-line"><Inbox className="size-5" />{activityCount > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-rose-500" />}</button></div></header>;
}

export function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  const items = [{ id: "today" as View, label: "Сегодня", icon: Home }, { id: "calendar" as View, label: "Календарь", icon: CalendarDays }, { id: "students" as View, label: "Ученики", icon: UsersRound }, { id: "activity" as View, label: "События", icon: Inbox }, { id: "materials" as View, label: "Материалы", icon: FolderOpen }, { id: "settings" as View, label: "Настройки", icon: Settings }];
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-surface-glass-95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden" aria-label="Мобильная навигация">{items.map(({ id, label, icon: Icon }) => { const active = view === id || id === "students" && view === "student"; return <button key={label} onClick={() => setView(id)} aria-label={label} title={label} className={`flex min-h-14 items-center justify-center rounded-xl transition ${active ? "bg-brand-soft text-brand-text" : "text-ink-muted hover:bg-slate-50"}`}><Icon className="size-5 sm:size-6" /><span className="sr-only">{label}</span></button>; })}</nav>;
}


