"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { appFetch } from "@/lib/client-fetch";

type Topic = "bug" | "question" | "idea" | "payment";
type Message = { id: string; fromAdmin: boolean; topic: Topic | null; body: string; createdAt: number };
export const topicLabel: Record<Topic, string> = { bug: "Что-то не работает", question: "Вопрос", idea: "Идея", payment: "Оплата" };
const time = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function SupportChat() {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [topic, setTopic] = useState<Topic>("bug");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const response = await appFetch("/api/support?markRead=1", { cache: "no-store" });
    if (response.ok) setMessages(((await response.json()) as { messages: Message[] }).messages);
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages?.length]);
  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setPending(true);
    try {
      const response = await appFetch("/api/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, body: text }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось отправить сообщение");
      setBody(""); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отправить сообщение"); }
    finally { setPending(false); }
  };
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex items-center gap-3 border-b border-line py-3 pl-4 pr-3">
      <span className="flex min-w-0 flex-1 flex-col"><strong className="text-base">Поддержка Тьюттори</strong><span className="text-xs text-ink-muted">Обычно отвечаем в течение дня. Содержимое кабинета поддержке не видно.</span></span>
      <DialogClose asChild><Button type="button" size="icon" variant="ghost" className="size-10 shrink-0 text-ink-muted" aria-label="Закрыть"><X className="size-5" /></Button></DialogClose>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-background p-4">
      {messages === null ? <p className="m-auto text-sm text-ink-muted">Загружаю…</p> : messages.length === 0 ? <p className="m-auto max-w-xs text-center text-sm text-ink-muted">Напишите, если что-то не работает, есть вопрос или идея. К сообщению добавится только тип устройства и браузер.</p>
        : messages.map((message) => <div key={message.id} className={`flex max-w-[85%] flex-col gap-1 rounded-2xl px-3 py-2 text-[15px] leading-5 ${message.fromAdmin ? "self-start rounded-bl-md border border-line bg-surface" : "self-end rounded-br-md bg-brand-solid text-white"}`}>
          {message.fromAdmin ? <span className="text-xs font-semibold text-ink-muted">Поддержка Тьюттори</span> : message.topic ? <span className="text-xs font-semibold opacity-80">{topicLabel[message.topic]}</span> : null}
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-no-translate>{message.body}</p>
          <time className="self-end text-[11px] opacity-70">{time.format(new Date(message.createdAt))}</time>
        </div>)}
      <div ref={endRef} />
    </div>
    <footer className="flex flex-col gap-2 border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
      <div role="radiogroup" aria-label="Тема" className="flex flex-wrap gap-1.5">{(Object.keys(topicLabel) as Topic[]).map((value) => <button key={value} type="button" role="radio" aria-checked={topic === value} onClick={() => setTopic(value)} className={`h-8 rounded-full px-3 text-xs font-semibold ${topic === value ? "bg-brand-soft text-brand-ink" : "border border-line text-ink-muted"}`}>{topicLabel[value]}</button>)}</div>
      <div className="flex items-end gap-2"><Textarea aria-label="Сообщение в поддержку" className="max-h-32 min-h-11 min-w-0 resize-none rounded-[22px] bg-background px-4 py-2.5 text-[15px]" value={body} maxLength={2000} rows={1} placeholder="Опишите, что случилось" onChange={(event) => setBody(event.target.value)} /><Button type="button" size="icon" className="size-11 shrink-0 rounded-full" disabled={pending || !body.trim()} aria-label="Отправить" onClick={() => void send()}><Send /></Button></div>
    </footer>
  </div>;
}

export function SupportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-fullscreen="" showCloseButton={false} className="inset-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-surface p-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(720px,calc(100dvh-4rem))] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
    <DialogTitle className="sr-only">Поддержка Тьюттори</DialogTitle><DialogDescription className="sr-only">Переписка с администрацией Тьюттори.</DialogDescription>
    {open && <SupportChat />}
  </DialogContent></Dialog>;
}
