"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Ban, CheckCircle2, LogOut, RefreshCw, Search, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";

type Workspace = {
  id: string; name: string; ownerName: string; ownerEmail: string; timezone: string; subscriptionStatus: string;
  accessStatus: "active" | "blocked"; studentCount: number; createdAt: number; lastActivityAt: number | null;
};

type AuditEvent = { id: string; workspaceId: string; workspaceName: string; actorName: string; action: "workspace_blocked" | "workspace_unblocked"; createdAt: number };

const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  let response = await fetch(input, init);
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await fetch(input, init);
  }
  return response;
}

const formattedDate = (value: number | null) => value ? dateTime.format(new Date(value)) : "Ещё не входили";

export function AdminDashboard({ standalone = false, onLogout }: { standalone?: boolean; onLogout?: () => void } = {}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await adminFetch("/api/admin/workspaces", { cache: "no-store" });
      const data = await response.json() as { error?: string; currentWorkspaceId?: string; workspaces?: Workspace[]; audit?: AuditEvent[] };
      if (!response.ok || !data.workspaces) throw new Error(data.error ?? "Не удалось загрузить кабинеты");
      setWorkspaces(data.workspaces); setAudit(data.audit ?? []); setCurrentWorkspaceId(data.currentWorkspaceId ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить кабинеты"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? workspaces.filter((workspace) => `${workspace.name} ${workspace.ownerName} ${workspace.ownerEmail}`.toLowerCase().includes(normalized)) : workspaces;
  }, [query, workspaces]);
  const changeStatus = async (workspace: Workspace) => {
    const next = workspace.accessStatus === "active" ? "blocked" : "active";
    if (next === "blocked" && !window.confirm(`Приостановить доступ к кабинету «${workspace.name}»? Данные останутся сохранены.`)) return;
    setPendingId(workspace.id);
    try {
      const response = await adminFetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: workspace.id, accessStatus: next }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось изменить доступ");
      setWorkspaces((current) => current.map((item) => item.id === workspace.id ? { ...item, accessStatus: next } : item));
      toast.success(next === "blocked" ? "Доступ к кабинету приостановлен" : "Доступ к кабинету восстановлен");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось изменить доступ"); }
    finally { setPendingId(null); }
  };
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8 md:py-10">
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><BrandIcon className="size-12" /><div><p className="flex items-center gap-2 text-sm font-semibold text-indigo-600"><ShieldCheck className="size-4" />Администрирование</p><h1 className="text-3xl font-bold">Кабинеты преподавателей</h1></div></div>{standalone ? <Button variant="outline" onClick={onLogout}><LogOut />Выйти</Button> : <Button asChild variant="outline"><Link href="/"><ArrowLeft />Вернуться в кабинет</Link></Button>}</header>
      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="relative"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени или email" className="h-12 rounded-xl pl-11" /></div><Button variant="outline" onClick={() => { setLoading(true); void load(); }}><RefreshCw />Обновить</Button></div>
      {loading ? <div className="card p-8 text-center text-slate-500">Загружаю кабинеты…</div> : error ? <div className="card p-8 text-center"><p className="font-semibold text-rose-600">{error}</p><Button className="mt-4" onClick={() => { setLoading(true); void load(); }}>Повторить</Button></div> : <div className="space-y-3">{visible.map((workspace) => <article key={workspace.id} className="card grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-bold">{workspace.ownerName}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${workspace.accessStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{workspace.accessStatus === "active" ? "Активен" : "Заблокирован"}</span>{workspace.id === currentWorkspaceId && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">Ваш кабинет</span>}</div><p className="mt-1 truncate text-sm text-slate-500">{workspace.ownerEmail}</p><div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600"><span className="flex items-center gap-2"><UsersRound className="size-4" />Учеников: {workspace.studentCount}</span><span>Создан: {formattedDate(workspace.createdAt)}</span><span>Активность: {formattedDate(workspace.lastActivityAt)}</span></div></div>
        <Button variant={workspace.accessStatus === "active" ? "outline" : "default"} disabled={pendingId !== null || workspace.id === currentWorkspaceId && workspace.accessStatus === "active"} onClick={() => void changeStatus(workspace)} className={workspace.accessStatus === "active" ? "text-rose-600 hover:bg-rose-50 hover:text-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}>{workspace.accessStatus === "active" ? <><Ban />Приостановить доступ</> : <><CheckCircle2 />Восстановить доступ</>}</Button>
      </article>)}{visible.length === 0 && <div className="card p-8 text-center text-slate-500">Кабинеты не найдены</div>}</div>}
      {!loading && !error && <section className="card mt-8 overflow-hidden"><div className="border-b p-5"><h2 className="text-xl font-bold">Журнал административных действий</h2><p className="mt-1 text-sm text-slate-500">Последние 100 блокировок и разблокировок</p></div><div className="divide-y">{audit.map((event) => <article key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><span><strong>{event.actorName}</strong> {event.action === "workspace_blocked" ? "заблокировал" : "разблокировал"} «{event.workspaceName}»</span><time className="text-slate-500">{formattedDate(event.createdAt)}</time></article>)}{audit.length === 0 && <p className="p-8 text-center text-slate-500">Действий пока нет</p>}</div></section>}
    </div><Toaster position="top-right" richColors />
  </main>;
}
