"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Ban, CheckCircle2, Copy, Link2, LogOut, Plus, RefreshCw, Search, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";

type Workspace = {
  id: string; name: string; ownerName: string; ownerEmail: string; timezone: string; subscriptionStatus: string;
  accessStatus: "active" | "blocked"; accessGrant: "legacy" | "complimentary" | "trial" | "paid";
  accessExpiresAt: number | null; studentCount: number; createdAt: number; lastActivityAt: number | null;
};
type TeacherInvitation = { id: string; name: string; email: string; professionalTitle: string; accessGrant: string; expiresAt: number; createdAt: number };
type AuditEvent = { id: string; workspaceId: string; workspaceName: string; actorName: string; action: "workspace_blocked" | "workspace_unblocked"; createdAt: number };

const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const formattedDate = (value: number | null) => value ? dateTime.format(new Date(value)) : "Ещё не входили";

async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  let response = await fetch(input, init);
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await fetch(input, init);
  }
  return response;
}

export function AdminDashboard({ standalone = false, onLogout }: { standalone?: boolean; onLogout?: () => void } = {}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [invitations, setInvitations] = useState<TeacherInvitation[]>([]);
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
      const data = await response.json() as { error?: string; currentWorkspaceId?: string; workspaces?: Workspace[]; invitations?: TeacherInvitation[]; audit?: AuditEvent[] };
      if (!response.ok || !data.workspaces) throw new Error(data.error ?? "Не удалось загрузить кабинеты");
      setWorkspaces(data.workspaces); setInvitations(data.invitations ?? []); setAudit(data.audit ?? []); setCurrentWorkspaceId(data.currentWorkspaceId ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить кабинеты"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? workspaces.filter((workspace) => `${workspace.name} ${workspace.ownerName} ${workspace.ownerEmail}`.toLowerCase().includes(normalized)) : workspaces;
  }, [query, workspaces]);

  const changeStatus = async (workspace: Workspace) => {
    const next = workspace.accessStatus === "active" ? "blocked" : "active";
    if (next === "blocked" && !window.confirm(`Приостановить доступ к кабинету «${workspace.name}»? Данные останутся сохранены.`)) return;
    setPendingId(workspace.id);
    try {
      const response = await adminFetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "setWorkspaceAccess", workspaceId: workspace.id, accessStatus: next }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось изменить доступ");
      setWorkspaces((current) => current.map((item) => item.id === workspace.id ? { ...item, accessStatus: next } : item));
      toast.success(next === "blocked" ? "Доступ к кабинету приостановлен" : "Доступ к кабинету восстановлен");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось изменить доступ"); }
    finally { setPendingId(null); }
  };

  const revokeInvitation = async (invitation: TeacherInvitation) => {
    setPendingId(invitation.id);
    try {
      const response = await adminFetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revokeTeacherInvite", invitationId: invitation.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось отозвать приглашение");
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      toast.success("Приглашение отозвано");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось отозвать приглашение"); }
    finally { setPendingId(null); }
  };

  return <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8 md:py-10">
    <div className="fixed bottom-4 right-4 z-50"><ThemeToggle compact /></div>
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><BrandIcon className="size-12" /><div><p className="flex items-center gap-2 text-sm font-semibold text-indigo-600"><ShieldCheck className="size-4" />Администрирование</p><h1 className="text-3xl font-bold">Кабинеты преподавателей</h1></div></div><div className="flex flex-wrap gap-2"><CreateTeacherInvitation onCreated={(invitation) => setInvitations((current) => [invitation, ...current])} />{standalone ? <Button variant="outline" onClick={onLogout}><LogOut />Выйти</Button> : <Button asChild variant="outline"><Link href="/"><ArrowLeft />Вернуться в кабинет</Link></Button>}</div></header>

      <section className="card mb-6 p-5 md:p-6"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-bold">Ожидают активации</h2><p className="mt-1 text-sm text-slate-500">Ссылка показывается при создании. Если она потеряна, отзовите приглашение и создайте новое.</p></div><span className="text-sm font-semibold text-indigo-600">{invitations.length}</span></div><div className="mt-4 grid gap-3">{invitations.map((invitation) => <article key={invitation.id} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><strong className="block truncate">{invitation.name}</strong><span className="block truncate text-sm text-slate-500">{invitation.email} · ссылка до {formattedDate(invitation.expiresAt)}</span></div><Button variant="outline" disabled={pendingId !== null} onClick={() => void revokeInvitation(invitation)}>Отозвать</Button></article>)}{!invitations.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Активных приглашений нет.</p>}</div></section>

      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="relative"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени или email" className="h-12 rounded-xl pl-11" /></div><Button variant="outline" onClick={() => { setLoading(true); void load(); }}><RefreshCw />Обновить</Button></div>
      {loading ? <div className="card p-8 text-center text-slate-500">Загружаю кабинеты…</div> : error ? <div className="card p-8 text-center"><p className="font-semibold text-rose-600">{error}</p><Button className="mt-4" onClick={() => { setLoading(true); void load(); }}>Повторить</Button></div> : <div className="space-y-3">{visible.map((workspace) => <article key={workspace.id} className="card grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-bold">{workspace.ownerName}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${workspace.accessStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{workspace.accessStatus === "active" ? "Активен" : "Заблокирован"}</span><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{workspace.accessGrant === "complimentary" ? "Бесплатно · бессрочно" : workspace.accessGrant === "trial" ? "Пробный период" : workspace.accessGrant === "paid" ? "Оплачен" : "Ранее создан"}</span>{workspace.id === currentWorkspaceId && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">Ваш кабинет</span>}</div><p className="mt-1 truncate text-sm text-slate-500">{workspace.ownerEmail}</p><div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600"><span className="flex items-center gap-2"><UsersRound className="size-4" />Учеников: {workspace.studentCount}</span><span>Создан: {formattedDate(workspace.createdAt)}</span><span>Активность: {formattedDate(workspace.lastActivityAt)}</span></div></div>
        <div className="flex flex-wrap gap-2"><Button variant={workspace.accessStatus === "active" ? "outline" : "default"} disabled={pendingId !== null || workspace.id === currentWorkspaceId && workspace.accessStatus === "active"} onClick={() => void changeStatus(workspace)} className={workspace.accessStatus === "active" ? "text-rose-600 hover:bg-rose-50 hover:text-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}>{workspace.accessStatus === "active" ? <><Ban />Приостановить доступ</> : <><CheckCircle2 />Восстановить доступ</>}</Button>{workspace.accessStatus === "blocked" && workspace.id !== currentWorkspaceId && <DeleteWorkspace workspace={workspace} onDeleted={() => setWorkspaces((current) => current.filter((item) => item.id !== workspace.id))} />}</div>
      </article>)}{visible.length === 0 && <div className="card p-8 text-center text-slate-500">Кабинеты не найдены</div>}</div>}
      {!loading && !error && <section className="card mt-8 overflow-hidden"><div className="border-b p-5"><h2 className="text-xl font-bold">Журнал административных действий</h2><p className="mt-1 text-sm text-slate-500">Последние 100 блокировок и разблокировок</p></div><div className="divide-y">{audit.map((event) => <article key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><span><strong>{event.actorName}</strong> {event.action === "workspace_blocked" ? "заблокировал" : "разблокировал"} «{event.workspaceName}»</span><time className="text-slate-500">{formattedDate(event.createdAt)}</time></article>)}{audit.length === 0 && <p className="p-8 text-center text-slate-500">Действий пока нет</p>}</div></section>}
    </div><Toaster position="top-right" richColors />
  </main>;
}

function CreateTeacherInvitation({ onCreated }: { onCreated: (invitation: TeacherInvitation) => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [professionalTitle, setProfessionalTitle] = useState("Преподаватель"); const [pending, setPending] = useState(false); const [url, setUrl] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true);
    try {
      const response = await adminFetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "createTeacherInvite", name, email, professionalTitle, accessGrant: "complimentary" }) });
      const data = await response.json() as { error?: string; invitation?: TeacherInvitation & { url: string } };
      if (!response.ok || !data.invitation) throw new Error(data.error ?? "Не удалось создать приглашение");
      setUrl(data.invitation.url); onCreated(data.invitation); toast.success("Приглашение создано");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось создать приглашение"); }
    finally { setPending(false); }
  };
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) { setName(""); setEmail(""); setProfessionalTitle("Преподаватель"); setUrl(""); } };
  const copy = async () => { await navigator.clipboard.writeText(url); toast.success("Ссылка скопирована"); };
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button className="bg-indigo-600"><Plus />Добавить преподавателя</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Пригласить преподавателя</DialogTitle><DialogDescription>Создайте персональную ссылку. Преподаватель задаст пароль и получит отдельный кабинет.</DialogDescription></DialogHeader>{url ? <div className="space-y-4"><div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800"><strong className="block">Бессрочный бесплатный доступ</strong>Ссылка действует 14 дней и показывается только сейчас.</div><div className="flex gap-2"><Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /><Button type="button" onClick={() => void copy()}><Copy />Копировать</Button></div></div> : <form id="teacher-invite-form" className="space-y-4" onSubmit={submit}><div className="space-y-2"><Label htmlFor="teacher-name">Имя *</Label><Input id="teacher-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></div><div className="space-y-2"><Label htmlFor="teacher-email">Email *</Label><Input id="teacher-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="teacher-title">Название или роль</Label><Input id="teacher-title" value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} maxLength={50} /></div><div className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-800"><strong className="block">Доступ: бесплатно и бессрочно</strong>Позже здесь можно будет подключить пробный период и платные тарифы.</div></form>}<DialogFooter><Button variant="outline" onClick={() => changeOpen(false)}>Закрыть</Button>{!url && <Button type="submit" form="teacher-invite-form" disabled={pending || name.trim().length < 2 || !email.trim()} className="bg-indigo-600"><Link2 />{pending ? "Создаю…" : "Создать ссылку"}</Button>}</DialogFooter></DialogContent></Dialog>;
}

function DeleteWorkspace({ workspace, onDeleted }: { workspace: Workspace; onDeleted: () => void }) {
  const [open, setOpen] = useState(false); const [confirmation, setConfirmation] = useState(""); const [pending, setPending] = useState(false);
  const remove = async () => {
    setPending(true);
    try {
      const response = await adminFetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "deleteWorkspace", workspaceId: workspace.id, confirmationEmail: confirmation }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось удалить кабинет");
      onDeleted(); setOpen(false); toast.success("Кабинет и связанные данные удалены");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось удалить кабинет"); }
    finally { setPending(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setConfirmation(""); }}><DialogTrigger asChild><Button variant="destructive"><Trash2 />Удалить</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Удалить кабинет безвозвратно?</DialogTitle><DialogDescription>Будут удалены аккаунт преподавателя, ученики, уроки, оплаты и вся история. Восстановить данные будет невозможно. Для подтверждения введите email преподавателя.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor={`delete-${workspace.id}`}>{workspace.ownerEmail}</Label><Input id={`delete-${workspace.id}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button variant="destructive" disabled={pending || confirmation.trim().toLowerCase() !== workspace.ownerEmail.toLowerCase()} onClick={() => void remove()}>{pending ? "Удаляю…" : "Удалить безвозвратно"}</Button></DialogFooter></DialogContent></Dialog>;
}
