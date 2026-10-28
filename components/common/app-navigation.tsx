"use client";

import { BarChart3, Bell, CalendarDays, FolderOpen, Home, Inbox, LogOut, Settings, UsersRound } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";
import type { View } from "@/components/features/app/types";
import { ThemeToggle } from "@/components/theme-toggle";

const isActive = (view: View, id: View) => view === id || (id === "students" && view === "student");

export function Sidebar({ view, setView, name, professionalTitle, onLogout, activityCount }: { view: View; setView: (view: View) => void; name: string; professionalTitle: string; onLogout?: () => void; activityCount: number }) {
  const items = [
    { id: "today" as View, label: "Сегодня", icon: Home },
    { id: "calendar" as View, label: "Календарь", icon: CalendarDays },
    { id: "students" as View, label: "Ученики", icon: UsersRound },
    { id: "activity" as View, label: "События", icon: Inbox, count: activityCount },
    { id: "materials" as View, label: "Материалы", icon: FolderOpen },
    { id: "stats" as View, label: "Статистика", icon: BarChart3 },
    { id: "settings" as View, label: "Настройки", icon: Settings },
  ];
  return <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col border-r border-line bg-surface lg:flex">
    <div className="border-b border-line px-7 py-7"><div className="flex items-center gap-3"><BrandIcon className="size-11 shadow-lg" /><div className="min-w-0">{professionalTitle && <p className="truncate text-sm font-medium text-ink-muted">{professionalTitle}</p>}<p className="truncate text-xl font-bold tracking-tight">{name}</p></div></div></div>
    <nav className="flex-1 space-y-2 p-5" aria-label="Основная навигация">{items.map(({ id, label, icon: Icon, count }) => <button key={label} onClick={() => setView(id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-base font-medium transition ${isActive(view, id) ? "bg-brand-soft font-semibold text-brand-ink" : "text-ink-secondary hover:bg-surface-muted hover:text-foreground"}`}><Icon className={`size-5 ${isActive(view, id) ? "text-coral" : ""}`} /><span>{label}</span>{count ? <span className="ml-auto rounded-full bg-attention px-2 py-0.5 text-xs text-white">{count}</span> : null}</button>)}</nav>
    <div className="flex items-center gap-2 border-t border-line p-5"><ThemeToggle compact /><button onClick={onLogout} className="ml-auto flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-line px-3 text-sm font-medium text-ink-secondary transition hover:bg-surface-muted hover:text-foreground"><LogOut className="size-4 shrink-0" />Выйти</button></div>
  </aside>;
}

export function MobileHeader({ name, professionalTitle, activityCount, onActivity, view }: { name: string; professionalTitle: string; activityCount: number; onActivity: () => void; view: View }) {
  const identity = <div className="flex min-w-0 items-center gap-2.5"><BrandIcon className="size-9" /><div className="min-w-0">{professionalTitle && <p className="truncate text-[11px] text-ink-muted">{professionalTitle}</p>}<p className="truncate font-bold">{name}</p></div></div>;
  return <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface-glass-90 px-4 backdrop-blur lg:hidden">{identity}<button onClick={onActivity} aria-current={view === "activity" ? "page" : undefined} className={`flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition ${view === "activity" ? "border-transparent bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink-strong"}`}><Bell className="size-5" /><span>События</span>{activityCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-attention px-1.5 text-xs font-bold text-white">{activityCount}</span>}</button></header>;
}

export function MobileNav({ view, setView }: { view: View; setView: (view: View) => void }) {
  // Events live in the header button, so the bar keeps five labelled tabs.
  const items = [{ id: "today" as View, label: "Сегодня", icon: Home }, { id: "calendar" as View, label: "Календарь", icon: CalendarDays }, { id: "students" as View, label: "Ученики", icon: UsersRound }, { id: "materials" as View, label: "Материалы", icon: FolderOpen }, { id: "settings" as View, label: "Настройки", icon: Settings }];
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface-glass-95 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden" aria-label="Мобильная навигация">{items.map(({ id, label, icon: Icon }) => { const active = isActive(view, id); return <button key={label} onClick={() => setView(id)} aria-current={active ? "page" : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 transition ${active ? "text-brand-ink" : "text-ink-muted"}`}><span className={`grid h-8 w-14 place-items-center rounded-full ${active ? "bg-brand-soft" : ""}`}><Icon className={`size-5 ${active ? "text-coral" : ""}`} /></span><span className={`max-w-full truncate text-[11px] ${active ? "font-bold" : "font-medium"}`}>{label}</span></button>; })}</nav>;
}
