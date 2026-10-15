"use client";

import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import type { TelegramStatus } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { appFetch } from "@/lib/client-fetch";

export function TelegramNotificationsCard({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const response = await appFetch("/api/telegram/link", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось проверить подключение Telegram");
    setStatus(await response.json() as TelegramStatus);
  }, []);

  useEffect(() => {
    let active = true;
    void appFetch("/api/telegram/link", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<TelegramStatus> : Promise.reject(new Error("Telegram status failed")))
      .then((nextStatus) => { if (active) setStatus(nextStatus); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const connect = async () => {
    setPending(true);
    try {
      const response = await appFetch("/api/telegram/link", { method: "POST" });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Не удалось создать ссылку");
      window.open(result.url, "_blank", "noopener,noreferrer");
      toast.info("В Telegram нажмите «Запустить», затем вернитесь сюда и проверьте подключение");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось подключить Telegram");
    } finally {
      setPending(false);
    }
  };

  const disconnect = async () => {
    setPending(true);
    try {
      const response = await appFetch("/api/telegram/link", { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось отключить Telegram");
      await load();
      toast.success("Telegram отключён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отключить Telegram");
    } finally {
      setPending(false);
    }
  };

  return <section className={`card min-w-0 overflow-hidden p-5 md:p-8 ${compact ? "max-w-none" : "max-w-3xl"}`}>
    <div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-600"><Send className="size-5" /></span><div className="min-w-0 flex-1">
      <h2 className="text-xl font-bold">Уведомления в Telegram</h2>
      <p className="mt-1 text-sm text-slate-500">Подключите свой Telegram к общему боту Тьюттори. Бот отправляет только напоминания за 24 часа до урока, изменения расписания и запросы ученика.</p>
      {!status && <p className="mt-4 text-sm text-slate-500">Проверяем подключение…</p>}
      {status && !status.configured && <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Telegram-бот ещё настраивается. Здесь появится кнопка подключения, когда он будет готов.</p>}
      {status?.configured && status.connected && <><p className="mt-4 text-sm font-semibold text-emerald-700">Telegram подключён{status.username ? ` · @${status.username}` : ""}</p><Button type="button" variant="outline" className="mt-4" disabled={pending} onClick={() => void disconnect()}>{pending ? "Отключаю…" : "Отключить"}</Button></>}
      {status?.configured && !status.connected && <div className="mt-5">
        <ol className="space-y-3 text-sm text-slate-700">
          {["Нажмите «Подключить Telegram» — откроется бот Тьюттори.", "В Telegram нажмите «Запустить» или отправьте команду /start.", "Вернитесь в Тьюттори и нажмите «Проверить подключение»."].map((step, index) => <li key={step} className="flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span><span className="pt-0.5 leading-5">{step}</span></li>)}
        </ol>
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">Одноразовая ссылка действует 15 минут. Бот не получает доступ к вашим перепискам и контактам. Подключение можно отключить в любой момент.</p>
        <div className="mt-4 grid min-w-0 gap-2"><Button type="button" className="h-auto min-h-10 w-full min-w-0 whitespace-normal bg-sky-600 text-center hover:bg-sky-700" disabled={pending} onClick={() => void connect()}><Send className="shrink-0" /><span>{pending ? "Создаю ссылку…" : "Подключить Telegram"}</span></Button><Button type="button" variant="outline" className="h-auto min-h-10 w-full min-w-0 whitespace-normal text-center" disabled={pending} onClick={() => void load().catch(() => toast.error("Не удалось проверить подключение"))}>Проверить подключение</Button></div>
      </div>}
    </div></div>
  </section>;
}
