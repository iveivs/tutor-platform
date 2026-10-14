"use client";
/* eslint-disable @next/next/no-img-element -- protected avatars use a session-bound API URL and are resized server-side. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const avatarColors = ["indigo", "violet", "rose", "amber", "emerald", "cyan", "slate"] as const;
export type AvatarColor = typeof avatarColors[number];

const avatarClasses: Record<string, string> = {
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200",
  slate: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100",
};

export function MemberAvatar({ name, initials, color = "indigo", url, className = "size-12" }: { name: string; initials: string; color?: string; url?: string | null; className?: string }) {
  return <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full font-bold ${avatarClasses[color] ?? avatarClasses.indigo} ${className}`}>
    {url ? <img src={url} alt={`Фото профиля ${name}`} className="size-full object-cover" /> : initials}
  </span>;
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  let response = await fetch(input, init);
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await fetch(input, init);
  }
  return response;
}

export function AvatarColorPicker({ value, ownValue, onChange, allowReset = false, disabled = false }: { value: string; ownValue?: string; onChange: (value: AvatarColor | null) => void; allowReset?: boolean; disabled?: boolean }) {
  return <div className="flex flex-wrap items-center gap-2">
    {avatarColors.map((color) => <button key={color} type="button" disabled={disabled} onClick={() => onChange(color)} aria-label={`Цвет аватара: ${color}`} aria-pressed={value === color}
      className={`size-9 rounded-full border-2 transition ${avatarClasses[color]} ${value === color ? "border-indigo-600 ring-2 ring-indigo-200 dark:ring-indigo-800" : "border-transparent hover:border-slate-400"}`} />)}
    {allowReset && <Button type="button" size="sm" variant="ghost" disabled={disabled || value === ownValue} onClick={() => onChange(null)}>Использовать цвет ученика</Button>}
  </div>;
}

export function ProfilePersonalizationCard({ name, initials, avatarColor, avatarUrl, onChanged }: { name: string; initials: string; avatarColor: string; avatarUrl?: string; onChanged: () => Promise<void> | void }) {
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
  return <section className="card p-5 md:p-6">
    <div className="flex items-center gap-4"><MemberAvatar name={name} initials={initials} color={avatarColor} url={avatarUrl} className="size-16 text-xl" /><div><h2 className="text-lg font-bold">Персонализация</h2><p className="mt-1 text-sm text-slate-500">Фото профиля и цвет кружка с инициалами</p></div></div>
    <div className="mt-5"><p className="mb-2 text-sm font-semibold">Цвет аватара</p><AvatarColorPicker value={avatarColor} onChange={changeColor} disabled={pending} /></div>
    <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><Button type="button" variant="outline" disabled={pending} onClick={() => fileRef.current?.click()}><Upload />Загрузить фотографию</Button>{avatarUrl && <Button type="button" variant="ghost" disabled={pending} onClick={() => void remove()}><Trash2 />Удалить фотографию</Button>}</div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />
    <p className="mt-3 text-xs leading-5 text-slate-500">JPEG, PNG или WebP до 2 МБ. Перед загрузкой применяются правила размещения контента.</p>
  </section>;
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
  return <section className="card p-6"><div className="flex items-center gap-4"><MemberAvatar name={name} initials={initials} color={avatarColor} url={avatarUrl} className="size-14" /><div><h2 className="text-lg font-bold">Вид карточки</h2><p className="mt-1 text-sm text-slate-500">Этот цвет видите только вы. Фото ученика, если оно есть, остаётся общим.</p></div></div><div className="mt-5"><AvatarColorPicker value={avatarColor} ownValue={ownAvatarColor} onChange={change} allowReset disabled={pending} /></div></section>;
}

type MessagePeer = { id: string; name: string; role: string; initials: string; avatarColor: string; avatarUrl: string | null; unreadCount: number; lastMessage: string | null; lastAt: number | null };
type DirectMessage = { id: string; senderId: string; recipientId: string; body: string; read: boolean; createdAt: number };
type MessagesData = { currentMemberId: string; peers: MessagePeer[]; messages: DirectMessage[] };

function MessagesContent({ initialPeerId }: { initialPeerId?: string }) {
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
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load().catch(() => undefined); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    void apiFetch("/api/messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ peerId: selectedId }) }).then(() => load()).catch(() => undefined);
  }, [selectedId, load]);
  const selected = data?.peers.find((peer) => peer.id === selectedId);
  const thread = useMemo(() => data?.messages.filter((message) => message.senderId === selectedId || message.recipientId === selectedId) ?? [], [data, selectedId]);
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
  if (!data) return <div className="grid min-h-56 place-items-center text-sm text-slate-500">Загружаю сообщения…</div>;
  if (!data.peers.length) return <div className="grid min-h-56 place-items-center text-center text-sm text-slate-500"><span><UserRound className="mx-auto mb-2 size-7" />Доступных собеседников пока нет</span></div>;
  return <div className="grid min-h-[420px] gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
    <aside className="max-h-[480px] space-y-1 overflow-y-auto md:border-r md:pr-3">{data.peers.map((peer) => <button key={peer.id} type="button" onClick={() => setSelectedId(peer.id)} className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left ${selectedId === peer.id ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}><MemberAvatar name={peer.name} initials={peer.initials} color={peer.avatarColor} url={peer.avatarUrl} className="size-10 text-sm" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{peer.name}</strong><span className="block truncate text-xs text-slate-500">{peer.lastMessage ?? (peer.role === "student" ? "Ученик" : "Преподаватель")}</span></span>{peer.unreadCount > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs font-bold text-white">{peer.unreadCount}</span>}</button>)}</aside>
    <section className="flex min-w-0 flex-col"><div className="flex items-center gap-3 border-b pb-3">{selected && <MemberAvatar name={selected.name} initials={selected.initials} color={selected.avatarColor} url={selected.avatarUrl} className="size-10 text-sm" />}<strong>{selected?.name}</strong></div><div className="flex max-h-[330px] min-h-52 flex-1 flex-col gap-2 overflow-y-auto py-4">{thread.map((message) => <div key={message.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${message.senderId === data.currentMemberId ? "ml-auto bg-indigo-600 text-white" : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><time className={`mt-1 block text-right text-[10px] ${message.senderId === data.currentMemberId ? "text-indigo-100" : "text-slate-400"}`}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></div>)}{!thread.length && <div className="grid flex-1 place-items-center text-sm text-slate-500">Сообщений пока нет</div>}</div><div className="flex items-end gap-2"><Textarea value={body} maxLength={1000} rows={2} placeholder="Введите сообщение" onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><Button type="button" size="icon" className="shrink-0 bg-indigo-600" disabled={pending || !body.trim()} aria-label="Отправить сообщение" onClick={() => void send()}><Send className="size-4" /></Button></div><p className="mt-1 text-right text-xs text-slate-400">{body.length}/1000</p></section>
  </div>;
}

export function MessagesDialog({ initialPeerId, label = "Сообщения" }: { initialPeerId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button type="button" variant="outline"><MessageCircle />{label}</Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Сообщения</DialogTitle><DialogDescription>Короткие личные сообщения между учеником и преподавателем.</DialogDescription></DialogHeader>{open && <MessagesContent initialPeerId={initialPeerId} />}</DialogContent></Dialog>;
}

export function MessagesCard() {
  return <section className="card p-5 md:p-6"><div className="mb-4 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><MessageCircle className="size-5" /></span><div><h2 className="text-lg font-bold">Сообщения</h2><p className="text-sm text-slate-500">Связь с преподавателем внутри кабинета</p></div></div><MessagesContent /></section>;
}
