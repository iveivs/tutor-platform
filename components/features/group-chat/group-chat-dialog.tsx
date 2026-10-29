"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, MoreHorizontal, Pin, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { appFetch } from "@/lib/client-fetch";
import { refreshGroupChatUnread } from "./use-group-chat-unread";

type Kind = "announcement" | "discussion";
type ChatMessage = { id: string; kind: Kind; body: string; pinned: boolean; createdAt: number; deleted: boolean; mine: boolean; author: { id: string; name: string; teacher: boolean }; readCount?: number };
type ChatData = {
  group: { id: string; name: string; membersVisible: boolean; memberCount: number; active: boolean };
  role: "teacher" | "member"; muted: boolean; lastReadAt: Record<Kind, number>;
  messages: ChatMessage[]; members?: Array<{ id: string; name: string; muted: boolean }>;
};

const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
function dayLabel(value: number) {
  const label = day.format(new Date(value));
  if (label === day.format(new Date())) return "Сегодня";
  if (label === day.format(new Date(Date.now() - 86_400_000))) return "Вчера";
  return label;
}
const stamp = (value: number) => `${dayLabel(value)}, ${time.format(new Date(value))}`;

async function post(body: Record<string, unknown>) {
  const response = await appFetch("/api/group-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить изменения");
}

function Composer({ placeholder, max, onSend }: { placeholder: string; max: number; onSend: (body: string) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setPending(true);
    if (await onSend(text)) setBody("");
    setPending(false);
  };
  return <footer className="border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
    <div className="flex items-end gap-2">
      <Textarea aria-label={placeholder} className="max-h-32 min-h-11 min-w-0 resize-none rounded-[22px] bg-background px-4 py-2.5 text-[15px]" value={body} maxLength={max} rows={1} placeholder={placeholder} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { event.preventDefault(); void send(); } }} />
      <Button type="button" size="icon" className="size-11 shrink-0 rounded-full" disabled={pending || !body.trim()} aria-label="Отправить" onClick={() => void send()}><Send /></Button>
    </div>
    {body.length > max - 100 && <div className="mt-1 px-1 text-right text-[11px] text-ink-subtle">{`${body.length}/${max}`}</div>}
  </footer>;
}

function MessageMenu({ items, onDark = false }: { items: Array<{ label: string; danger?: boolean; onSelect: () => void }>; onDark?: boolean }) {
  if (!items.length) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" className={`size-8 shrink-0 ${onDark ? "text-white hover:bg-white/15 hover:text-white" : "text-ink-muted"}`} aria-label="Действия с сообщением"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">{items.map((item) => <DropdownMenuItem key={item.label} className={item.danger ? "text-danger-text" : ""} onSelect={item.onSelect}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>;
}

function GroupChat({ groupId, onDirectMessage }: { groupId: string; onDirectMessage?: () => void }) {
  const [data, setData] = useState<ChatData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Kind>("announcement");
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const response = await appFetch(`/api/group-chat?groupId=${encodeURIComponent(groupId)}`, { cache: "no-store" });
      const result = await response.json() as ChatData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить чат");
      setData(result); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить чат"); }
  }, [groupId]);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  const teacher = data?.role === "teacher";
  const discussionOn = Boolean(data?.group.membersVisible);
  const activeTab: Kind = discussionOn ? tab : "announcement";
  const announcements = (data?.messages ?? []).filter((message) => message.kind === "announcement" && !message.deleted).reverse();
  const pinned = announcements.find((message) => message.pinned);
  const discussion = (data?.messages ?? []).filter((message) => message.kind === "discussion");
  const unread = (kind: Kind) => (data?.messages ?? []).filter((message) => message.kind === kind && !message.mine && !message.deleted && message.createdAt > (data?.lastReadAt[kind] ?? 0)).length;
  const latest = (data?.messages ?? []).filter((message) => message.kind === activeTab).at(-1)?.createdAt ?? 0;

  // Opening a tab marks it read up to its newest message.
  useEffect(() => {
    if (!data || !latest || latest <= data.lastReadAt[activeTab]) return;
    const readAt = Date.now();
    void post({ action: "read", groupId, kind: activeTab }).then(() => {
      setData((current) => current && { ...current, lastReadAt: { ...current.lastReadAt, [activeTab]: readAt } });
      void refreshGroupChatUnread();
    }).catch(() => undefined);
  }, [activeTab, data, groupId, latest]);
  useEffect(() => { if (activeTab === "discussion") endRef.current?.scrollIntoView({ block: "end" }); }, [activeTab, discussion.length]);

  const act = async (body: Record<string, unknown>, success?: string) => {
    try { await post(body); if (success) toast.success(success); await load(); return true; }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось сохранить изменения"); return false; }
  };
  const close = <DialogClose asChild><Button type="button" size="icon" variant="ghost" className="size-10 shrink-0 text-ink-muted" aria-label="Закрыть"><X className="size-5" /></Button></DialogClose>;
  if (!data) return <div className="flex h-full flex-col"><div className="flex justify-end p-3">{close}</div><div className="grid flex-1 place-items-center p-6 text-center text-sm text-ink-muted">{error || "Загружаю чат…"}</div></div>;

  const mutedIds = new Set(data.members?.filter((member) => member.muted).map((member) => member.id));
  const readOf = (message: ChatMessage) => teacher && message.readCount !== undefined ? ` · прочитали ${message.readCount} из ${data.group.memberCount}` : "";
  const announcementMenu = (message: ChatMessage) => teacher ? [
    { label: message.pinned ? "Открепить" : "Закрепить", onSelect: () => void act({ action: "pin", messageId: message.id, pinned: !message.pinned }) },
    { label: "Удалить объявление", danger: true, onSelect: () => { if (window.confirm("Удалить объявление у всех участников?")) void act({ action: "delete", messageId: message.id }, "Объявление удалено"); } },
  ] : [];
  const discussionMenu = (message: ChatMessage) => [
    ...(teacher || message.mine ? [{ label: "Удалить сообщение", danger: true, onSelect: () => void act({ action: "delete", messageId: message.id }, "Сообщение удалено") }] : []),
    ...(teacher && !message.author.teacher ? [mutedIds.has(message.author.id)
      ? { label: "Разрешить писать", onSelect: () => void act({ action: "mute", groupId, memberId: message.author.id, muted: false }, "Участник снова может писать") }
      : { label: "Запретить писать", danger: true, onSelect: () => void act({ action: "mute", groupId, memberId: message.author.id, muted: true }, "Участник больше не может писать в обсуждении") }] : []),
  ];

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex items-center gap-3 border-b border-line py-3 pl-4 pr-3">
      <span className="flex min-w-0 flex-1 flex-col"><strong className="truncate text-base" data-no-translate>{data.group.name}</strong><span className="truncate text-xs text-ink-muted">{discussionOn ? `Чат группы · участников: ${data.group.memberCount}` : "Объявления преподавателя"}</span></span>
      {close}
    </header>
    {discussionOn && <div role="tablist" aria-label="Разделы чата" className="grid grid-cols-2 gap-1.5 px-3 pt-3">
      {(["announcement", "discussion"] as const).map((kind) => { const count = unread(kind); return <button key={kind} type="button" role="tab" aria-selected={activeTab === kind} onClick={() => setTab(kind)} className={`h-10 rounded-full text-sm font-semibold ${activeTab === kind ? "bg-brand-solid text-white" : "border border-line bg-surface text-ink-muted"}`}>{kind === "announcement" ? "Объявления" : "Обсуждение"}{count ? ` · ${count}` : ""}</button>; })}
    </div>}

    {activeTab === "announcement" ? <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-background p-4">
      {!discussionOn && <p className="flex gap-2.5 rounded-2xl bg-brand-soft px-4 py-3 text-[13px] leading-snug text-brand-ink"><EyeOff aria-hidden className="mt-0.5 size-[18px] shrink-0" /><span>{teacher ? "Участники этой группы не видят друг друга, поэтому обсуждения нет — только ваши объявления. Включите «Участники видят друг друга» в группе, чтобы открыть обсуждение." : "В этой группе участники не видят друг друга, поэтому здесь только объявления преподавателя."}</span></p>}
      {pinned && <section className="flex flex-col gap-2 rounded-2xl bg-hero-start p-4 text-white">
        <span className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-xs font-bold text-coral"><Pin className="size-3.5" />Закреплено</span><span className="flex items-center gap-1"><span className="text-xs text-hero-muted">{stamp(pinned.createdAt)}</span>{teacher && <MessageMenu onDark items={announcementMenu(pinned)} />}</span></span>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]" data-no-translate>{pinned.body}</p>
        {teacher && <span className="text-xs text-hero-muted">{`Прочитали ${pinned.readCount ?? 0} из ${data.group.memberCount}`}</span>}
      </section>}
      {announcements.filter((message) => !message.pinned).map((message) => <article key={message.id} className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5">
        <span className="flex items-center justify-between gap-2"><span className={`text-xs font-semibold ${message.createdAt > data.lastReadAt.announcement && !message.mine ? "text-coral-text" : "text-ink-muted"}`}>{`${stamp(message.createdAt)}${readOf(message)}`}</span><MessageMenu items={announcementMenu(message)} /></span>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]" data-no-translate>{message.body}</p>
        {!teacher && !discussionOn && onDirectMessage && <Button type="button" variant="outline" size="sm" className="mt-1 self-start rounded-xl text-brand-text" onClick={onDirectMessage}>Ответить лично</Button>}
      </article>)}
      {!announcements.length && <div className="grid flex-1 place-items-center text-center text-sm text-ink-muted">{teacher ? "Объявлений пока нет. Напишите первое — его увидит каждый участник и получит уведомление." : "Объявлений пока нет"}</div>}
    </div> : <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-background p-4">
      {discussion.map((message, index) => {
        const label = dayLabel(message.createdAt);
        const showDay = index === 0 || label !== dayLabel(discussion[index - 1].createdAt);
        return <div key={message.id} className="contents">
          {showDay && <span className="my-1 self-center rounded-full bg-surface px-2.5 py-0.5 text-xs text-ink-muted">{label}</span>}
          <div className={`flex max-w-[85%] items-start gap-1 ${message.mine ? "self-end flex-row-reverse" : "self-start"}`}>
            <div className={`flex min-w-0 flex-col gap-1 rounded-2xl px-3 py-2 text-[15px] leading-5 ${message.mine ? "rounded-br-md bg-brand-solid text-white" : message.author.teacher ? "rounded-bl-md bg-brand-soft text-brand-ink-strong" : "rounded-bl-md border border-line bg-surface"}`}>
              {!message.mine && <span className="text-xs font-semibold opacity-80"><span data-no-translate>{message.author.name}</span>{message.author.teacher ? " · преподаватель" : ""}</span>}
              {message.deleted ? <p className="italic opacity-70">Сообщение удалено</p> : <p className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-no-translate>{message.body}</p>}
              <time className="self-end text-[11px] opacity-70">{time.format(new Date(message.createdAt))}</time>
            </div>
            {!message.deleted && <MessageMenu items={discussionMenu(message)} />}
          </div>
        </div>;
      })}
      {!discussion.length && <div className="grid flex-1 place-items-center text-center text-sm text-ink-muted">Сообщений пока нет. Здесь участники и преподаватель обсуждают занятия группы.</div>}
      <div ref={endRef} />
    </div>}

    {!data.group.active ? <p className="border-t border-line bg-surface px-4 py-3 text-center text-sm text-ink-muted">Группа в архиве, писать в чат нельзя.</p>
      : activeTab === "announcement" ? (teacher ? <Composer placeholder="Новое объявление для группы" max={1000} onSend={(body) => act({ action: "send", groupId, kind: "announcement", body }, "Объявление отправлено")} /> : null)
      : data.muted ? <p className="border-t border-line bg-surface px-4 py-3 text-center text-sm text-ink-muted">Преподаватель ограничил вам сообщения в этой группе.</p>
      : <Composer placeholder="Сообщение группе" max={500} onSend={(body) => act({ action: "send", groupId, kind: "discussion", body })} />}
  </div>;
}

// Full-screen on phones, a centred window on larger screens, like the direct messages.
export function GroupChatDialog({ groupId, open, onOpenChange, onDirectMessage }: { groupId: string | null; open: boolean; onOpenChange: (open: boolean) => void; onDirectMessage?: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-fullscreen="" showCloseButton={false} className="inset-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-surface p-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(760px,calc(100dvh-4rem))] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
    <DialogTitle className="sr-only">Чат группы</DialogTitle><DialogDescription className="sr-only">Объявления преподавателя и обсуждение участников группы.</DialogDescription>
    {open && groupId && <GroupChat key={groupId} groupId={groupId} onDirectMessage={onDirectMessage} />}
  </DialogContent></Dialog>;
}
