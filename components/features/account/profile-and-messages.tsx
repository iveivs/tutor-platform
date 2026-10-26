"use client";
/* eslint-disable @next/next/no-img-element -- protected avatars use a session-bound API URL and are resized server-side. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MessageCircle, Send, Trash2, Upload, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { AppCard, AppCardDescription, AppCardTitle } from "@/components/common/app-card";
import { SearchableSelect } from "@/components/common/searchable-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useVisiblePolling } from "@/hooks/use-visible-polling";
import { appFetch as apiFetch } from "@/lib/client-fetch";

export const avatarColors = ["indigo", "violet", "rose", "amber", "emerald", "cyan", "slate"] as const;
export type AvatarColor = typeof avatarColors[number];

const avatarClasses: Record<string, string> = {
  indigo: "bg-brand-soft-strong text-brand-ink",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200",
  rose: "bg-rose-100 text-danger-ink dark:bg-rose-950",
  amber: "bg-warning-soft-strong text-amber-800 dark:text-amber-200",
  emerald: "bg-emerald-100 text-success-ink dark:bg-emerald-950",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200",
  slate: "bg-slate-200 text-ink-body dark:bg-slate-700",
};

export function MemberAvatar({ name, initials, color = "indigo", url, className = "size-12" }: { name: string; initials: string; color?: string; url?: string | null; className?: string }) {
  return <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full font-bold ${avatarClasses[color] ?? avatarClasses.indigo} ${className}`}>
    {url ? <img src={url} alt={`Фото профиля ${name}`} className="size-full object-cover" /> : initials}
  </span>;
}

export function AvatarColorPicker({ value, ownValue, onChange, allowReset = false, disabled = false }: { value: string; ownValue?: string; onChange: (value: AvatarColor | null) => void; allowReset?: boolean; disabled?: boolean }) {
  return <div className="flex flex-wrap items-center gap-2">
    {avatarColors.map((color) => <button key={color} type="button" disabled={disabled} onClick={() => onChange(color)} aria-label={`Цвет аватара: ${color}`} aria-pressed={value === color}
      className={`size-9 rounded-full border-2 transition ${avatarClasses[color]} ${value === color ? "border-indigo-600 ring-2 ring-indigo-200 dark:ring-indigo-800" : "border-transparent hover:border-slate-400"}`} />)}
    {allowReset && <Button type="button" size="sm" variant="ghost" disabled={disabled || value === ownValue} onClick={() => onChange(null)}>Использовать цвет ученика</Button>}
  </div>;
}

export function ProfilePersonalizationCard({ name, initials, avatarColor, avatarUrl, onChanged, embedded = false }: { name: string; initials: string; avatarColor: string; avatarUrl?: string; onChanged: () => Promise<void> | void; embedded?: boolean }) {
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const changeColor = async (color: AvatarColor | null) => {
    if (!color) return;
    setPending(true);
    try {
      const response = await apiFetch("/api/app-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "updateOwnAvatarColor", color }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить цвет аватара");
      await onChanged(); toast.success("Цвет аватара сохранён");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить цвет аватара"); }
    finally { setPending(false); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Фотография профиля должна быть не больше 2 МБ"); return; }
    setPending(true);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await apiFetch("/api/profile/avatar", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить фотографию профиля");
      await onChanged(); toast.success("Фотография профиля обновлена");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить фотографию профиля"); }
    finally { setPending(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const remove = async () => {
    setPending(true);
    try {
      const response = await apiFetch("/api/profile/avatar", { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось удалить фотографию профиля");
      await onChanged(); toast.success("Фотография профиля удалена");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось удалить фотографию профиля"); }
    finally { setPending(false); }
  };
  const content = <>
    <div className="flex items-center gap-4"><MemberAvatar name={name} initials={initials} color={avatarColor} url={avatarUrl} className="size-16 text-xl" /><div><AppCardTitle>{embedded ? "Ваш профиль" : "Персонализация"}</AppCardTitle><AppCardDescription>Фото профиля и цвет кружка с инициалами</AppCardDescription></div></div>
    <div className="mt-5"><p className="mb-2 text-sm font-semibold">Цвет аватара</p><AvatarColorPicker value={avatarColor} onChange={changeColor} disabled={pending} /></div>
    <div className="mt-5 flex min-w-0 flex-col gap-2"><Button type="button" variant="outline" size="control" className="h-auto min-h-[var(--control-height)] w-full min-w-0 whitespace-normal py-2 text-center leading-5" disabled={pending} onClick={() => fileRef.current?.click()}><Upload /><span className="min-w-0">Загрузить фотографию</span></Button>{avatarUrl && <Button type="button" variant="ghost" size="control" className="h-auto min-h-[var(--control-height)] w-full min-w-0 whitespace-normal py-2 text-center leading-5" disabled={pending} onClick={() => void remove()}><Trash2 /><span className="min-w-0">Удалить фотографию</span></Button>}</div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />
    <p className="mt-3 text-xs leading-5 text-ink-muted">JPEG, PNG или WebP до 2 МБ. Перед загрузкой применяются правила размещения контента.</p>
  </>;
  return embedded ? <div>{content}</div> : <AppCard>{content}</AppCard>;
}

export function StudentAvatarPreferenceCard({ studentId, name, initials, avatarColor, ownAvatarColor, avatarUrl, onChanged }: { studentId: string; name: string; initials: string; avatarColor: string; ownAvatarColor: string; avatarUrl?: string; onChanged: () => Promise<void> | void }) {
  const [pending, setPending] = useState(false);
  const change = async (color: AvatarColor | null) => {
    setPending(true);
    try {
      const response = await apiFetch("/api/app-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "updateStudentAvatarColor", studentId, color }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить цвет карточки");
      await onChanged(); toast.success(color ? "Ваш цвет карточки сохранён" : "Будет использоваться цвет ученика");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить цвет карточки"); }
    finally { setPending(false); }
  };
  return <AppCard><div className="flex items-center gap-4"><MemberAvatar name={name} initials={initials} color={avatarColor} url={avatarUrl} className="size-14" /><div><AppCardTitle>Вид карточки</AppCardTitle><AppCardDescription>Этот цвет видите только вы. Фото ученика, если оно есть, остаётся общим.</AppCardDescription></div></div><div className="mt-5"><AvatarColorPicker value={avatarColor} ownValue={ownAvatarColor} onChange={change} allowReset disabled={pending} /></div></AppCard>;
}

type MessagePeer = { id: string; name: string; role: string; initials: string; avatarColor: string; avatarUrl: string | null; unreadCount: number; lastMessage: string | null; lastAt: number | null };
type DirectMessage = { id: string; senderId: string; recipientId: string; body: string; read: boolean; createdAt: number };
type MessagesData = { currentMemberId: string; peers: MessagePeer[]; messages: DirectMessage[] };

// Messages data and actions, shared by the card/dialog layout and the v2 chat layout.
function useMessages(initialPeerId?: string) {
  const [data, setData] = useState<MessagesData | null>(null);
  const [selectedId, setSelectedId] = useState(initialPeerId ?? "");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const response = await apiFetch("/api/messages", { cache: "no-store" });
    const result = await response.json() as MessagesData & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить сообщения");
    setData(result);
    setSelectedId((current) => current && result.peers.some((peer) => peer.id === current) ? current : initialPeerId && result.peers.some((peer) => peer.id === initialPeerId) ? initialPeerId : result.peers[0]?.id ?? "");
  }, [initialPeerId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => toast.error(error instanceof Error ? error.message : "Не удалось загрузить сообщения")), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useVisiblePolling(async () => { await load().catch(() => undefined); });
  useEffect(() => {
    const refresh = () => { void load().catch(() => undefined); };
    window.addEventListener("tyuttori:realtime", refresh);
    return () => window.removeEventListener("tyuttori:realtime", refresh);
  }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    void apiFetch("/api/messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ peerId: selectedId }) }).then(() => load()).catch(() => undefined);
  }, [selectedId, load]);
  const selected = data?.peers.find((peer) => peer.id === selectedId);
  const thread = useMemo(() => (data?.messages.filter((message) => message.senderId === selectedId || message.recipientId === selectedId) ?? []).slice(-50), [data, selectedId]);
  const send = async () => {
    const text = body.trim(); if (!selectedId || !text) return;
    setPending(true);
    try {
      const response = await apiFetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientId: selectedId, body: text }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось отправить сообщение");
      setBody(""); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отправить сообщение"); }
    finally { setPending(false); }
  };
  return { data, selectedId, setSelectedId, selected, thread, body, setBody, pending, send };
}

const messageTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const messageDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const messageDayLabel = (value: number) => {
  const day = messageDay.format(new Date(value));
  if (day === messageDay.format(new Date())) return "Сегодня";
  if (day === messageDay.format(new Date(Date.now() - 86_400_000))) return "Вчера";
  return day;
};

function MessagesChat({ initialPeerId }: { initialPeerId?: string }) {
  const { data, selectedId, setSelectedId, selected, thread, body, setBody, pending, send } = useMessages(initialPeerId);
  const [showPeers, setShowPeers] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread.length, selectedId]);
  const close = <DialogClose asChild><Button type="button" size="icon" variant="ghost" className="size-10 shrink-0 text-ink-muted" aria-label="Закрыть"><X className="size-5" /></Button></DialogClose>;
  if (!data || !data.peers.length) return <div className="flex h-full flex-col"><div className="flex justify-end p-3">{close}</div><div className="grid flex-1 place-items-center p-6 text-center text-sm text-ink-muted">{!data ? "Загружаю сообщения…" : <span><UserRound className="mx-auto mb-2 size-7" />Доступных собеседников пока нет</span>}</div></div>;
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex items-center gap-3 border-b border-line py-3 pl-4 pr-3">
      {selected && <MemberAvatar name={selected.name} initials={selected.initials} color={selected.avatarColor} url={selected.avatarUrl} className="size-10 text-sm" />}
      <span className="flex min-w-0 flex-1 flex-col"><strong className="truncate text-base">{selected?.name}</strong><span className="truncate text-xs text-ink-muted">Сообщения видны только вам двоим</span></span>
      {data.peers.length > 1 && <Button type="button" size="sm" variant="ghost" className="shrink-0 px-2" aria-expanded={showPeers} onClick={() => setShowPeers((current) => !current)}>Сменить<ChevronDown className={`transition-transform ${showPeers ? "rotate-180" : ""}`} /></Button>}
      {close}
    </header>
    {showPeers && <div className="border-b border-line p-3"><SearchableSelect value={selectedId} onValueChange={(value) => { setSelectedId(value); setShowPeers(false); }} placeholder="Выберите собеседника" searchPlaceholder="Найти собеседника" emptyText="Собеседники не найдены" items={data.peers.map((peer) => ({ value: peer.id, label: peer.name, description: peer.lastMessage ?? (peer.role === "student" ? "Ученик" : "Преподаватель") }))} /></div>}
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-background p-4">
      {thread.map((message, index) => {
        const mine = message.senderId === data.currentMemberId;
        const day = messageDayLabel(message.createdAt);
        const showDay = index === 0 || day !== messageDayLabel(thread[index - 1].createdAt);
        return <div key={message.id} className="contents">
          {showDay && <span className="my-1 self-center rounded-full bg-surface px-2.5 py-0.5 text-xs text-ink-muted">{day}</span>}
          <div className={`flex max-w-[82%] flex-col gap-1 rounded-2xl px-3 py-2 text-[15px] leading-5 ${mine ? "self-end rounded-br-md bg-brand-solid text-white" : "self-start rounded-bl-md border border-line bg-surface"}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><time className="self-end text-[11px] opacity-70">{messageTime.format(new Date(message.createdAt))}</time></div>
        </div>;
      })}
      {!thread.length && <div className="grid flex-1 place-items-center text-center text-sm text-ink-muted">Сообщений пока нет</div>}
      <div ref={endRef} />
    </div>
    <footer className="border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
      <div className="flex items-end gap-2"><Textarea aria-label="Сообщение" className="max-h-32 min-h-11 min-w-0 resize-none rounded-[22px] bg-background px-4 py-2.5 text-[15px]" value={body} maxLength={500} rows={1} placeholder="Введите сообщение" onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { event.preventDefault(); void send(); } }} /><Button type="button" size="icon" className="size-11 shrink-0 rounded-full" disabled={pending || !body.trim()} aria-label="Отправить сообщение" onClick={() => void send()}><Send /></Button></div>
      <div className="mt-1 hidden justify-between gap-2 px-1 text-[11px] text-ink-subtle sm:flex"><span>Enter — отправить, Shift+Enter — новая строка</span><span>{body.length}/500</span></div>
      {body.length > 400 && <div className="mt-1 px-1 text-right text-[11px] text-ink-subtle sm:hidden">{body.length}/500</div>}
    </footer>
  </div>;
}

export function MessagesDialog({ initialPeerId, label = "Сообщения", open: controlledOpen, onOpenChange, showTrigger = true }: {
  initialPeerId?: string;
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const changeOpen = onOpenChange ?? setInternalOpen;
  const trigger = showTrigger && <DialogTrigger asChild><Button type="button" size="control" variant="outline"><MessageCircle />{label}</Button></DialogTrigger>;
  return <Dialog open={open} onOpenChange={changeOpen}>{trigger}<DialogContent data-fullscreen="" showCloseButton={false} className="inset-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-surface p-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(720px,calc(100dvh-4rem))] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"><DialogTitle className="sr-only">Сообщения</DialogTitle><DialogDescription className="sr-only">Короткие личные сообщения между учеником и преподавателем.</DialogDescription>{open && <MessagesChat key={initialPeerId} initialPeerId={initialPeerId} />}</DialogContent></Dialog>;
}
