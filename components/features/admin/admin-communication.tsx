"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FilterChips } from "@/components/common/filter-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { topicLabel } from "@/components/features/support/support-dialog";
import { formatBytes, formatDateTime, type AdminWorkspace } from "./admin-model";

type Thread = { workspaceId: string; status: "open" | "waiting" | "resolved"; lastMessageAt: number; ownerName: string; lastBody: string; topic: keyof typeof topicLabel | null; unread: number };
type Report = { id: string; workspaceId: string; resourceType: string; reason: string; comment: string; status: "open" | "dismissed" | "removed"; createdAt: number; ownerName: string; title: string; filename: string; contentType: string; byteSize: number; uploadedAt: number | null; uploaderName: string; uploaderRole: string; fileAvailable: boolean; lessonLinks: number; studentLinks: number };
type News = { id: string; title: string; body: string; important: boolean; publishedAt: number; reads: number; acknowledged: number };
type Data = { teachers: number; threads: Thread[]; reports: Report[]; news: News[] };
type Message = { id: string; fromAdmin: boolean; topic: keyof typeof topicLabel | null; body: string; device: string | null; createdAt: number };

const statusLabel = { open: "новое", waiting: "ждёт ответа", resolved: "решено" } as const;
const reasonLabel: Record<string, string> = { copyright: "авторские права", inappropriate: "неприемлемое содержание", personal_data: "личные данные без согласия", other: "другое" };

async function adminPost(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/communication", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось сохранить");
}

function Conversation({ workspaceId, title, onChanged }: { workspaceId: string; title: string; onChanged: () => void }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/communication?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    if (response.ok) setMessages(((await response.json()) as { messages: Message[] }).messages);
  }, [workspaceId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const act = async (payload: Record<string, unknown>, success: string) => {
    setPending(true);
    try { await adminPost(payload); toast.success(success); await load(); onChanged(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить"); return false; }
    finally { setPending(false); }
  };
  const device = messages?.filter((message) => !message.fromAdmin && message.device).at(-1)?.device;
  return <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3"><span className="flex min-w-0 flex-col"><strong className="truncate" data-no-translate>{title}</strong>{device && <span className="text-xs text-ink-muted" data-no-translate>{device}</span>}</span><span className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => void act({ action: "setThreadStatus", workspaceId, status: "resolved" }, "Отмечено как решено")}>Решено</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => void act({ action: "setThreadStatus", workspaceId, status: "open" }, "Снова открыто")}>Открыть снова</Button></span></header>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-background p-4">
      {messages === null ? <p className="m-auto text-sm text-ink-muted">Загружаю…</p> : messages.length === 0 ? <p className="m-auto text-sm text-ink-muted">Сообщений пока нет. Напишите первым — преподаватель получит уведомление.</p>
        : messages.map((message) => <div key={message.id} className={`flex max-w-[80%] flex-col gap-1 rounded-2xl px-3 py-2 text-sm ${message.fromAdmin ? "self-end rounded-br-md bg-brand-solid text-white" : "self-start rounded-bl-md border border-line bg-surface"}`}>{message.topic && <span className="text-xs font-semibold opacity-80">{topicLabel[message.topic]}</span>}<p className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-no-translate>{message.body}</p><time className="self-end text-[11px] opacity-70">{formatDateTime(message.createdAt)}</time></div>)}
    </div>
    <footer className="flex items-end gap-2 border-t border-line p-3"><Textarea value={body} maxLength={2000} rows={2} placeholder="Ответ преподавателю" onChange={(event) => setBody(event.target.value)} className="min-w-0 resize-none rounded-xl" /><Button disabled={pending || !body.trim()} onClick={() => void act({ action: "reply", workspaceId, body: body.trim() }, "Ответ отправлен").then((ok) => { if (ok) setBody(""); })}>Отправить</Button></footer>
  </section>;
}

function NewsEditor({ teachers, news, onChanged }: { teachers: number; news: News[]; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [pending, setPending] = useState(false);
  const publish = async () => {
    if (important && !window.confirm("Важная новость придёт всем преподавателям уведомлением, в Telegram и push и будет висеть баннером, пока её не подтвердят. Опубликовать?")) return;
    setPending(true);
    try { await adminPost({ action: "publishNews", title: title.trim(), body: body.trim(), important }); toast.success("Новость опубликована"); setTitle(""); setBody(""); setImportant(false); onChanged(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось опубликовать"); }
    finally { setPending(false); }
  };
  const remove = async (item: News) => {
    if (!window.confirm(`Удалить новость «${item.title}»?`)) return;
    try { await adminPost({ action: "deleteNews", newsId: item.id }); toast.success("Новость удалена"); onChanged(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось удалить"); }
  };
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"><strong>Новая новость</strong>
      <Input value={title} maxLength={120} placeholder="Заголовок" onChange={(event) => setTitle(event.target.value)} className="h-11 rounded-xl" />
      <Textarea value={body} maxLength={4000} rows={5} placeholder="Текст новости" onChange={(event) => setBody(event.target.value)} className="rounded-xl" />
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"><span className="flex flex-col"><span className="text-[15px] font-semibold">Важная</span><span className="text-xs text-ink-muted">Баннер до «Ознакомлен» и уведомление на телефон</span></span><Switch aria-label="Важная" checked={important} onCheckedChange={setImportant} /></div>
      <Button disabled={pending || !title.trim() || !body.trim()} onClick={() => void publish()}>{pending ? "Публикую…" : "Опубликовать для всех преподавателей"}</Button>
    </section>
    <section className="flex flex-col gap-2">{news.length ? news.map((item) => <article key={item.id} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-3.5">
      <span className="flex items-center justify-between gap-2 text-xs text-ink-muted"><span>{`${formatDateTime(item.publishedAt)}${item.important ? " · важная" : ""}`}</span><button type="button" className="font-semibold text-danger-text hover:underline" onClick={() => void remove(item)}>Удалить</button></span>
      <strong data-no-translate>{item.title}</strong><p className="line-clamp-3 whitespace-pre-wrap text-sm text-ink-muted" data-no-translate>{item.body}</p>
      <span className="text-xs font-semibold text-brand-text">{item.important ? `Ознакомились ${item.acknowledged} из ${teachers}` : `Прочитали ${item.reads} из ${teachers}`}</span>
    </article>) : <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">Новостей пока нет</p>}</section>
  </div>;
}

function Reports({ reports, onChanged }: { reports: Report[]; onChanged: () => void }) {
  const decide = async (report: Report, decision: "dismiss" | "remove") => {
    if (decision === "remove" && !window.confirm(`Удалить «${report.title}» у всех учеников и уроков? Автор получит уведомление с причиной.`)) return;
    try { await adminPost({ action: "resolveReport", reportId: report.id, decision }); toast.success(decision === "remove" ? "Файл удалён" : "Жалоба отклонена"); onChanged(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить"); }
  };
  if (!reports.length) return <p className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-ink-muted">Жалоб нет</p>;
  return <div className="flex flex-col gap-3">{reports.map((report) => <article key={report.id} className={`flex flex-col gap-2 rounded-2xl border bg-surface p-4 ${report.status === "open" ? "border-danger-ring" : "border-line opacity-80"}`}>
    <span className="flex flex-wrap items-center justify-between gap-2"><strong data-no-translate>{report.title}</strong><span className="text-xs text-ink-muted">{`${formatDateTime(report.createdAt)} · ${report.status === "open" ? "открыта" : report.status === "removed" ? "файл удалён" : "отклонена"}`}</span></span>
    <span className="text-[13px] text-ink-muted"><span data-no-translate>{`${report.ownerName} · ${report.uploaderName}`}</span>{` (${report.uploaderRole === "student" ? "ученик" : "преподаватель"}) · ${formatBytes(report.byteSize)} · открыт у уроков: ${report.lessonLinks}, учеников: ${report.studentLinks}`}</span>
    <span className="text-[13px]">{`Причина: ${reasonLabel[report.reason] ?? report.reason}`}{report.comment && <span className="text-ink-muted" data-no-translate>{` — «${report.comment}»`}</span>}</span>
    {report.status === "open" && <span className="flex flex-wrap gap-2">{report.fileAvailable && <Button asChild size="sm" variant="outline"><a href={`/api/admin/reports/${report.id}/file`} target="_blank" rel="noopener noreferrer">Открыть файл</a></Button>}<Button size="sm" variant="outline" onClick={() => void decide(report, "dismiss")}>Отклонить</Button>{report.fileAvailable && <Button size="sm" variant="destructive" onClick={() => void decide(report, "remove")}>Удалить файл</Button>}</span>}
    {report.status === "open" && <span className="text-xs text-ink-muted">Вам доступен только этот файл, не вся библиотека кабинета.</span>}
  </article>)}</div>;
}

// Admin «Связь»: support conversations with workspaces, complaints about files and platform news.
export function AdminCommunication({ workspaces }: { workspaces: AdminWorkspace[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [section, setSection] = useState<"threads" | "reports" | "news">("threads");
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/communication", { cache: "no-store" });
    if (response.ok) setData(await response.json() as Data);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  if (!data) return <div className="card p-8 text-center text-ink-muted">Загружаю…</div>;
  const unread = data.threads.reduce((sum, thread) => sum + thread.unread, 0);
  const openReports = data.reports.filter((report) => report.status === "open").length;
  const nameOf = (workspaceId: string) => data.threads.find((thread) => thread.workspaceId === workspaceId)?.ownerName ?? workspaces.find((workspace) => workspace.id === workspaceId)?.ownerName ?? "";
  return <div className="flex flex-col gap-4">
    <FilterChips label="Связь" items={[{ value: "threads", label: unread ? `Обращения · ${unread}` : "Обращения" }, { value: "reports", label: openReports ? `Жалобы · ${openReports}` : "Жалобы" }, { value: "news", label: "Новости" }] as const} value={section} onChange={setSection} />
    {section === "threads" && <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <select aria-label="Написать кабинету первым" value="" onChange={(event) => { if (event.target.value) setSelected(event.target.value); }} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm"><option value="">Написать кабинету первым…</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.ownerName}</option>)}</select>
        {data.threads.length ? data.threads.map((thread) => <button key={thread.workspaceId} type="button" onClick={() => setSelected(thread.workspaceId)} className={`flex flex-col gap-1 rounded-2xl border p-3 text-left ${selected === thread.workspaceId ? "border-brand-solid bg-brand-soft" : "border-line bg-surface"}`}>
          <span className="flex justify-between gap-2"><strong className="truncate text-sm" data-no-translate>{thread.ownerName}</strong><span className="shrink-0 text-xs text-ink-muted">{formatDateTime(thread.lastMessageAt)}</span></span>
          <span className={`text-xs font-bold ${thread.status === "resolved" ? "text-success-text" : thread.unread ? "text-coral-text" : "text-ink-muted"}`}>{`${thread.topic ? `${topicLabel[thread.topic]} · ` : ""}${thread.unread ? `новых: ${thread.unread}` : statusLabel[thread.status]}`}</span>
          <span className="line-clamp-1 text-xs text-ink-muted" data-no-translate>{thread.lastBody}</span>
        </button>) : <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">Обращений пока нет</p>}
      </div>
      {selected ? <Conversation key={selected} workspaceId={selected} title={nameOf(selected)} onChanged={() => void load()} /> : <div className="grid place-items-center rounded-2xl border border-dashed border-line p-8 text-sm text-ink-muted">Выберите обращение слева</div>}
    </div>}
    {section === "reports" && <Reports reports={data.reports} onChanged={() => void load()} />}
    {section === "news" && <NewsEditor teachers={data.teachers} news={data.news} onChanged={() => void load()} />}
  </div>;
}
