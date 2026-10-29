"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { appFetch } from "@/lib/client-fetch";

type News = { id: string; title: string; body: string; important: boolean; publishedAt: number; read: boolean; acknowledged: boolean };
type NewsState = { news: News[]; unread: number; pendingImportant: News | null };

// One shared copy for the settings badge, the dialog and the important-news banner.
let current: NewsState | null = null;
const listeners = new Set<() => void>();
export async function refreshNews() {
  try {
    const response = await appFetch("/api/news", { cache: "no-store" });
    if (response.ok) { current = await response.json() as NewsState; listeners.forEach((listener) => listener()); }
  } catch { /* Keep the last state. */ }
}
export function useNews() {
  const state = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current, () => null);
  useEffect(() => {
    void refreshNews();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refreshNews(); }, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return state;
}
const post = (action: "read" | "acknowledge", newsId: string) => appFetch("/api/news", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, newsId }) }).then(() => refreshNews());
const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export function NewsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const state = useNews();
  const markRead = useCallback(() => { for (const item of state?.news ?? []) if (!item.read) void post("read", item.id); }, [state]);
  useEffect(() => { if (open) markRead(); }, [open, markRead]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-lg">
    <DialogHeader><DialogTitle>Новости Тьюттори</DialogTitle><DialogDescription>Изменения платформы и условий.</DialogDescription></DialogHeader>
    <div className="flex flex-col gap-3">{state?.news.length ? state.news.map((item) => <article key={item.id} className={`flex flex-col gap-1.5 rounded-2xl border p-3.5 ${item.important && !item.acknowledged ? "border-warning-ring bg-warning-soft" : "border-line bg-surface"}`}>
      <span className="flex justify-between gap-2 text-xs"><span className="font-bold text-coral-text">{item.important ? "Важное" : !item.read ? "Новое" : ""}</span><span className="text-ink-muted">{date.format(new Date(item.publishedAt))}</span></span>
      <strong className="text-base" data-no-translate>{item.title}</strong>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary" data-no-translate>{item.body}</p>
      {item.important && !item.acknowledged && <Button type="button" size="sm" className="self-start rounded-xl" onClick={() => void post("acknowledge", item.id)}>Ознакомлен</Button>}
    </article>) : <p className="py-6 text-center text-sm text-ink-muted">Новостей пока нет</p>}</div>
  </DialogContent></Dialog>;
}

// Shown on every teacher screen until an important news item is acknowledged.
export function ImportantNewsBanner() {
  const state = useNews();
  const [open, setOpen] = useState(false);
  const item = state?.pendingImportant;
  if (!item) return null;
  return <div role="status" className="mx-4 mt-4 flex flex-col gap-2.5 rounded-2xl bg-warning-soft p-3.5 text-warning-ink lg:mx-8">
    <div className="flex items-start gap-2.5"><Megaphone aria-hidden className="mt-0.5 size-5 shrink-0" /><div className="flex min-w-0 flex-col gap-0.5"><strong className="text-[15px]">Важно: <span data-no-translate>{item.title}</span></strong><span className="line-clamp-2 text-[13px] leading-snug" data-no-translate>{item.body}</span></div></div>
    <div className="flex flex-wrap gap-2 pl-7"><Button type="button" size="sm" className="h-9 rounded-xl bg-brand-solid px-4 text-white hover:bg-brand-solid-hover" onClick={() => void post("acknowledge", item.id)}>Ознакомлен</Button><Button type="button" size="sm" variant="ghost" className="h-9 rounded-xl text-current hover:bg-transparent hover:underline" onClick={() => setOpen(true)}>Читать</Button></div>
    <NewsDialog open={open} onOpenChange={setOpen} />
  </div>;
}
