"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Link2, LogOut, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand-icon";
import { FilterChips } from "@/components/common/filter-chips";
import {
  accessState, auditText, chipText, formatDate, formatDateTime, rubles, stateChip,
  type AccessState, type AdminAuditEvent, type AdminPayment, type AdminWorkspace, type TeacherInvitation,
} from "@/components/features/admin/admin-model";
import { WorkspaceDialog } from "@/components/features/admin/workspace-dialog";
import { PlatformStats } from "@/components/features/admin/platform-stats";
import { AdminCommunication } from "@/components/features/admin/admin-communication";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";

type Filter = "all" | "unlimited" | "paid" | "trial" | "free" | "ending" | "read_only" | "blocked";

async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  let response = await fetch(input, init);
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await fetch(input, init);
  }
  return response;
}

function SummaryTile({ label, value, hint, tone = "" }: { label: string; value: number; hint: string; tone?: string }) {
  return <div className={`flex flex-col gap-1 rounded-2xl px-4 py-3.5 ${tone || "border border-line bg-surface"}`}><span className="text-[13px] font-semibold opacity-80">{label}</span><span className="text-2xl font-extrabold">{value}</span><span className="text-xs opacity-80">{hint}</span></div>;
}

export function AdminDashboard({ standalone = false, onLogout }: { standalone?: boolean; onLogout?: () => void } = {}) {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [invitations, setInvitations] = useState<TeacherInvitation[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<"workspaces" | "stats" | "communication">("workspaces");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await adminFetch("/api/admin/workspaces", { cache: "no-store" });
      const data = await response.json() as { error?: string; currentWorkspaceId?: string; priceCents?: number | null; workspaces?: AdminWorkspace[]; invitations?: TeacherInvitation[]; payments?: AdminPayment[]; audit?: AdminAuditEvent[] };
      if (!response.ok || !data.workspaces) throw new Error(data.error ?? "Не удалось загрузить кабинеты");
      setWorkspaces(data.workspaces); setInvitations(data.invitations ?? []); setPayments(data.payments ?? []); setAudit(data.audit ?? []);
      setPriceCents(data.priceCents ?? null); setCurrentWorkspaceId(data.currentWorkspaceId ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить кабинеты"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const post = useCallback(async (body: Record<string, unknown>, success: string) => {
    try {
      const response = await adminFetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить изменения");
      toast.success(success);
      await load();
      return true;
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Не удалось сохранить изменения");
      return false;
    }
  }, [load]);

  const states = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, accessState(workspace)])), [workspaces]);
  const count = (state: AccessState) => workspaces.filter((workspace) => states.get(workspace.id) === state).length;
  const paidCount = workspaces.filter((workspace) => workspace.accessGrant === "paid" && workspace.accessStatus === "active" && states.get(workspace.id) !== "read_only").length;
  const trialCount = workspaces.filter((workspace) => workspace.accessGrant === "trial" && states.get(workspace.id) !== "read_only" && workspace.accessStatus === "active").length;
  const freeCount = workspaces.filter((workspace) => (workspace.accessGrant === "complimentary" || workspace.accessGrant === "legacy") && workspace.accessStatus === "active").length;
  const unlimitedCount = workspaces.filter((workspace) => workspace.accessGrant === "unlimited" && workspace.accessStatus === "active").length;
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const monthIncome = payments.filter((payment) => payment.status === "paid" && payment.paidOn >= monthStart).reduce((sum, payment) => sum + payment.amountCents, 0);
  const paidTotal = (workspaceId: string) => payments.filter((payment) => payment.workspaceId === workspaceId && payment.status === "paid").reduce((sum, payment) => sum + payment.amountCents, 0);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workspaces.filter((workspace) => {
      const state = states.get(workspace.id);
      const matchesFilter = filter === "all"
        || filter === "paid" && workspace.accessGrant === "paid"
        || filter === "trial" && workspace.accessGrant === "trial"
        || filter === "free" && (workspace.accessGrant === "complimentary" || workspace.accessGrant === "legacy")
        || filter === state;
      return matchesFilter && (!normalized || `${workspace.name} ${workspace.ownerName} ${workspace.ownerEmail}`.toLowerCase().includes(normalized));
    });
  }, [filter, query, states, workspaces]);

  const changeStatus = async (workspace: AdminWorkspace) => {
    const next = workspace.accessStatus === "active" ? "blocked" : "active";
    if (next === "blocked" && !window.confirm(`Приостановить доступ к кабинету «${workspace.name}»? Данные останутся сохранены.`)) return;
    setPendingId(workspace.id);
    await post({ action: "setWorkspaceAccess", workspaceId: workspace.id, accessStatus: next }, next === "blocked" ? "Доступ к кабинету приостановлен" : "Доступ к кабинету восстановлен");
    setPendingId(null);
  };

  const revokeInvitation = async (invitation: TeacherInvitation) => {
    setPendingId(invitation.id);
    await post({ action: "revokeTeacherInvite", invitationId: invitation.id }, "Приглашение отозвано");
    setPendingId(null);
  };

  const opened = workspaces.find((workspace) => workspace.id === openId) ?? null;
  const filters = [
    { value: "all", label: `Все · ${workspaces.length}` }, { value: "unlimited", label: "Бессрочный" }, { value: "paid", label: "Платят" }, { value: "trial", label: "Пробный" }, { value: "free", label: "Бесплатно" },
    { value: "ending", label: "Заканчивается" }, { value: "read_only", label: "Только просмотр" }, { value: "blocked", label: "Заблокированы" },
  ] as const;

  return <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8 md:py-10">
    <div className="fixed bottom-4 right-4 z-50"><ThemeToggle compact /></div>
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><BrandIcon className="size-12" /><div><p className="flex items-center gap-2 text-sm font-semibold text-brand-text"><ShieldCheck className="size-4" />Администрирование</p><h1 className="text-3xl font-bold">Кабинеты преподавателей</h1></div></div><div className="flex flex-wrap gap-2"><CreateTeacherInvitation onCreated={() => void load()} />{standalone ? <Button variant="outline" onClick={onLogout}><LogOut />Выйти</Button> : <Button asChild variant="outline"><Link href="/"><ArrowLeft />Вернуться в кабинет</Link></Button>}</div></header>

      <div className="mb-6"><FilterChips label="Раздел" items={[{ value: "workspaces", label: "Кабинеты" }, { value: "stats", label: "Статистика" }, { value: "communication", label: "Связь" }] as const} value={tab} onChange={setTab} /></div>
      {tab === "stats" ? <PlatformStats /> : tab === "communication" ? <AdminCommunication workspaces={workspaces} /> : <>

      {!loading && !error && <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryTile label="Платят" value={paidCount} hint={monthIncome ? `${rubles(monthIncome)} за этот месяц` : "оплат в этом месяце нет"} />
        <SummaryTile label="Пробный период" value={trialCount} hint="30 дней без оплаты" />
        <SummaryTile label="Без оплаты" value={freeCount + unlimitedCount} hint={`бессрочных: ${unlimitedCount}`} />
        <SummaryTile label="Заканчивается" value={count("ending")} hint="за 7 дней" tone="bg-warning-soft text-warning-ink" />
        <SummaryTile label="Только просмотр" value={count("read_only")} hint="срок закончился" tone="bg-danger-soft text-danger-ink" />
      </div>}

      {invitations.length > 0 && <section className="card mb-6 p-5 md:p-6"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-bold">Ожидают активации</h2><p className="mt-1 text-sm text-ink-muted">Ссылка показывается при создании. Если она потеряна, отзовите приглашение и создайте новое.</p></div><span className="text-sm font-semibold text-brand-text">{invitations.length}</span></div><div className="mt-4 grid gap-3">{invitations.map((invitation) => <article key={invitation.id} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><strong className="block truncate" data-no-translate>{invitation.name}</strong><span className="block truncate text-sm text-ink-muted">{`${invitation.email} · ${invitation.accessGrant === "trial" ? "пробный период" : invitation.accessGrant === "unlimited" ? "бессрочный" : "бесплатно"} · ссылка до ${formatDateTime(invitation.expiresAt)}`}</span></div><Button variant="outline" disabled={pendingId !== null} onClick={() => void revokeInvitation(invitation)}>Отозвать</Button></article>)}</div></section>}

      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="relative"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-subtle" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени или email" className="h-12 rounded-xl pl-11" /></div><Button variant="outline" onClick={() => { setLoading(true); void load(); }}><RefreshCw />Обновить</Button></div>
      <div className="mb-4"><FilterChips label="Доступ" items={filters} value={filter} onChange={setFilter} /></div>

      {loading ? <div className="card p-8 text-center text-ink-muted">Загружаю кабинеты…</div> : error ? <div className="card p-8 text-center"><p className="font-semibold text-danger-text">{error}</p><Button className="mt-4" onClick={() => { setLoading(true); void load(); }}>Повторить</Button></div> : <>
        <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface lg:block">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="bg-surface-subtle text-left text-[13px] text-ink-muted"><th className="px-4 py-3 font-semibold">Преподаватель</th><th className="px-4 py-3 font-semibold">Доступ</th><th className="px-4 py-3 font-semibold">До</th><th className="px-4 py-3 font-semibold">Учеников</th><th className="px-4 py-3 font-semibold">Последний вход</th><th className="px-4 py-3 font-semibold">Оплачено всего</th></tr></thead>
            <tbody>{visible.map((workspace) => { const state = states.get(workspace.id)!; const total = paidTotal(workspace.id); return <tr key={workspace.id} className="cursor-pointer border-t border-line hover:bg-surface-subtle" onClick={() => setOpenId(workspace.id)}>
              <td className="px-4 py-3"><button type="button" className="flex flex-col text-left" onClick={(event) => { event.stopPropagation(); setOpenId(workspace.id); }}><span className="font-semibold" data-no-translate>{workspace.ownerName}</span><span className="text-xs text-ink-muted">{workspace.id === currentWorkspaceId ? "это вы" : workspace.ownerEmail}</span></button></td>
              <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${stateChip[state].className}`}>{chipText(workspace, state)}</span></td>
              <td className="px-4 py-3">{formatDate(workspace.accessExpiresAt)}</td>
              <td className="px-4 py-3">{workspace.studentCount}</td>
              <td className="px-4 py-3 text-ink-muted">{formatDateTime(workspace.lastActivityAt)}</td>
              <td className="px-4 py-3">{total ? rubles(total) : "—"}</td>
            </tr>; })}</tbody>
          </table>
          {visible.length === 0 && <p className="p-8 text-center text-ink-muted">Кабинеты не найдены</p>}
        </div>
        <div className="flex flex-col gap-2.5 lg:hidden">{visible.map((workspace) => { const state = states.get(workspace.id)!; return <button key={workspace.id} type="button" onClick={() => setOpenId(workspace.id)} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-left">
          <span className="flex items-start justify-between gap-3"><span className="flex min-w-0 flex-col"><strong className="truncate text-base" data-no-translate>{workspace.ownerName}</strong><span className="truncate text-[13px] text-ink-muted">{workspace.id === currentWorkspaceId ? "это вы" : workspace.ownerEmail}</span></span><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${stateChip[state].className}`}>{chipText(workspace, state)}</span></span>
          <span className="text-[13px] text-ink-muted">{`Учеников: ${workspace.studentCount} · вход: ${formatDateTime(workspace.lastActivityAt)}${workspace.accessExpiresAt ? ` · до ${formatDate(workspace.accessExpiresAt)}` : ""}`}</span>
        </button>; })}{visible.length === 0 && <div className="card p-8 text-center text-ink-muted">Кабинеты не найдены</div>}</div>
      </>}

      {!loading && !error && <section className="card mt-8 overflow-hidden"><div className="border-b p-5"><h2 className="text-xl font-bold">Журнал административных действий</h2><p className="mt-1 text-sm text-ink-muted">Доступ, платежи и блокировки, последние 300 действий</p></div><div className="divide-y">{audit.slice(0, 50).map((event) => <article key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><span><strong data-no-translate>{event.workspaceName}</strong>{` · ${auditText(event)}`}</span><time className="text-ink-muted">{formatDateTime(event.createdAt)}</time></article>)}{audit.length === 0 && <p className="p-8 text-center text-ink-muted">Действий пока нет</p>}</div></section>}
      </>}
    </div>
    {opened && <WorkspaceDialog key={opened.id} workspace={opened} payments={payments} audit={audit} priceCents={priceCents} isOwnWorkspace={opened.id === currentWorkspaceId}
      onOpenChange={(open) => { if (!open) setOpenId(null); }} onPost={post} onToggleBlock={(workspace) => void changeStatus(workspace)}
      deleteControl={<DeleteWorkspace workspace={opened} onDeleted={() => { setOpenId(null); void load(); }} />} />}
    <Toaster position="top-right" richColors />
  </main>;
}

function CreateTeacherInvitation({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [professionalTitle, setProfessionalTitle] = useState("Преподаватель"); const [accessGrant, setAccessGrant] = useState<"trial" | "complimentary" | "unlimited">("trial"); const [pending, setPending] = useState(false); const [url, setUrl] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true);
    try {
      const response = await adminFetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "createTeacherInvite", name, email, professionalTitle, accessGrant }) });
      const data = await response.json() as { error?: string; invitation?: TeacherInvitation & { url: string } };
      if (!response.ok || !data.invitation) throw new Error(data.error ?? "Не удалось создать приглашение");
      setUrl(data.invitation.url); onCreated(); toast.success("Приглашение создано");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось создать приглашение"); }
    finally { setPending(false); }
  };
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) { setName(""); setEmail(""); setProfessionalTitle("Преподаватель"); setAccessGrant("trial"); setUrl(""); } };
  const copy = async () => { await navigator.clipboard.writeText(url); toast.success("Ссылка скопирована"); };
  const grantOption = (value: "trial" | "complimentary" | "unlimited", title: string, text: string) => <label className={`flex cursor-pointer gap-3 rounded-2xl border p-3.5 ${accessGrant === value ? "border-brand-solid bg-brand-soft" : "border-line"}`}><input type="radio" name="teacher-access" className="mt-1 accent-[var(--color-brand-solid)]" checked={accessGrant === value} onChange={() => setAccessGrant(value)} /><span className="flex flex-col"><strong className="text-[15px]">{title}</strong><span className="text-[13px] text-ink-muted">{text}</span></span></label>;
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button className="bg-brand-solid"><Plus />Пригласить преподавателя</Button></DialogTrigger><DialogContent className="rounded-3xl sm:max-w-lg"><DialogHeader><DialogTitle>Пригласить преподавателя</DialogTitle><DialogDescription>Создайте персональную ссылку. Преподаватель задаст пароль и получит отдельный кабинет.</DialogDescription></DialogHeader>{url ? <div className="space-y-4"><div className="rounded-2xl bg-success-soft p-4 text-sm text-success-ink-strong"><strong className="block">{accessGrant === "trial" ? "Пробный период 30 дней" : accessGrant === "unlimited" ? "Бессрочный тариф" : "Бесплатный доступ без срока"}</strong>Ссылка действует 14 дней и показывается только сейчас.</div><div className="flex gap-2"><Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /><Button type="button" onClick={() => void copy()}><Copy />Копировать</Button></div></div> : <form id="teacher-invite-form" className="space-y-4" onSubmit={submit}><div className="space-y-2"><Label htmlFor="teacher-name">Имя *</Label><Input id="teacher-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></div><div className="space-y-2"><Label htmlFor="teacher-email">Email *</Label><Input id="teacher-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="teacher-title">Название или роль</Label><Input id="teacher-title" value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} maxLength={50} /></div><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Доступ</legend>{grantOption("trial", "Пробный период 30 дней", "Отсчёт начнётся, когда преподаватель примет приглашение.")}{grantOption("complimentary", "Бесплатно", "Без срока; дату окончания можно поставить позже в карточке кабинета.")}{grantOption("unlimited", "Бессрочный", "Для тестирования по вашему решению: без срока и без оплаты, не продаётся.")}</fieldset></form>}<DialogFooter><Button variant="outline" onClick={() => changeOpen(false)}>Закрыть</Button>{!url && <Button type="submit" form="teacher-invite-form" disabled={pending || name.trim().length < 2 || !email.trim()} className="bg-brand-solid"><Link2 />{pending ? "Создаю…" : "Создать ссылку"}</Button>}</DialogFooter></DialogContent></Dialog>;
}

function DeleteWorkspace({ workspace, onDeleted }: { workspace: AdminWorkspace; onDeleted: () => void }) {
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
