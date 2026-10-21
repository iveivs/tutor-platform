"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Send } from "lucide-react";
import { toast } from "sonner";
import type { NotificationPreferences, TelegramStatus } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { appFetch } from "@/lib/client-fetch";

const defaultPreferences: NotificationPreferences = {
  soundEnabled: true,
  telegramSchedule: true,
  telegramMessages: false,
  telegramMaterials: false,
};

export function TelegramNotificationsCard({ compact = false, embedded = false }: { compact?: boolean; embedded?: boolean }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const response = await appFetch("/api/telegram/link", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось проверить подключение Telegram");
    setStatus(await response.json() as TelegramStatus);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      appFetch("/api/telegram/link", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<TelegramStatus> : Promise.reject(new Error("Telegram status failed"))),
      appFetch("/api/notification-preferences", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<NotificationPreferences> : defaultPreferences),
    ]).then(([nextStatus, nextPreferences]) => {
      if (!active) return;
      setStatus(nextStatus);
      setPreferences(nextPreferences);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const changePreference = async (key: keyof NotificationPreferences, checked: boolean) => {
    const previous = preferences ?? defaultPreferences;
    const next = { ...previous, [key]: checked };
    setPreferences(next);
    setPending(true);
    try {
      const response = await appFetch("/api/notification-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить настройки уведомлений");
      window.dispatchEvent(new CustomEvent("tyuttori:notification-preferences", { detail: next }));
    } catch (error) {
      setPreferences(previous);
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить настройки уведомлений");
    } finally {
      setPending(false);
    }
  };

  const preferenceRow = (key: keyof NotificationPreferences, title: string, description: string) => <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4">
    <span className="min-w-0"><strong className="block text-sm">{title}</strong><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span>
    <Switch checked={(preferences ?? defaultPreferences)[key]} disabled={pending} onCheckedChange={(checked) => void changePreference(key, checked)} aria-label={title} />
  </label>;

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

  const content = <>
    <div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-600"><Send className="size-5" /></span><div className="min-w-0 flex-1">
      <h2 className="text-xl font-bold">{embedded ? "Каналы уведомлений" : "Уведомления"}</h2>
      <p className="mt-1 text-sm text-slate-500">Выберите, как Тьюттори сообщит о новых событиях. Настройки индивидуальны для каждого пользователя.</p>
      <div className="mt-5">
        <h3 className="flex items-center gap-2 text-sm font-bold"><BellRing className="size-4 text-indigo-600" />Уведомления в кабинете</h3>
        <div className="mt-3">{preferenceRow("soundEnabled", "Лёгкий звук", "Проигрывать короткий сигнал, когда открытый кабинет получает новое событие.")}</div>
      </div>
      <div className="mt-5">
        <h3 className="text-sm font-bold">Что отправлять в Telegram</h3>
        <div className="mt-3 grid gap-2">
          {preferenceRow("telegramSchedule", "Расписание и запросы", "Напоминания, отмены, переносы и запросы на изменение урока.")}
          {preferenceRow("telegramMessages", "Новые сообщения", "Только факт нового сообщения — без его текста.")}
          {preferenceRow("telegramMaterials", "Материалы и домашние задания", "Новые файлы, фотографии, задания и ответы к уроку.")}
        </div>
      </div>
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
  </>;
  return embedded ? <div className="min-w-0">{content}</div> : <section className={`card min-w-0 overflow-hidden p-5 md:p-8 ${compact ? "max-w-none" : "max-w-3xl"}`}>{content}</section>;
}
