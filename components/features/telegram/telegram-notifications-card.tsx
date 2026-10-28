"use client";

import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import type { NotificationPreferences, TelegramStatus } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup, settingsRowClass } from "@/components/features/settings/settings-group";
import { appFetch } from "@/lib/client-fetch";

export const defaultPreferences: NotificationPreferences = {
  soundEnabled: true,
  telegramSchedule: true,
  telegramMessages: false,
  telegramMaterials: false,
  pushSchedule: true,
  pushMessages: true,
  pushMaterials: true,
};

/** Saves one preference and announces the stored set to the open cabinet (sound, other cards). */
export async function savePreference(key: keyof NotificationPreferences, checked: boolean) {
  const response = await appFetch("/api/notification-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: checked }),
  });
  const result = await response.json() as Partial<NotificationPreferences> & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить настройки уведомлений");
  const stored = Object.fromEntries(Object.entries(defaultPreferences).map(([name, fallback]) => [name, result[name as keyof NotificationPreferences] ?? fallback])) as NotificationPreferences;
  window.dispatchEvent(new CustomEvent("tyuttori:notification-preferences", { detail: stored }));
  return stored;
}

// Notification preferences and the Telegram connection, as a settings group.
export function TelegramNotificationsCard() {
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
      setPreferences(await savePreference(key, checked));
    } catch (error) {
      setPreferences(previous);
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить настройки уведомлений");
    } finally {
      setPending(false);
    }
  };

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

  const groupedRow = (key: keyof NotificationPreferences, title: string) => <label className={`${settingsRowClass} cursor-pointer`}>
    <span className="min-w-0 text-[15px]">{title}</span>
    <Switch checked={(preferences ?? defaultPreferences)[key]} disabled={pending} onCheckedChange={(checked) => void changePreference(key, checked)} aria-label={title} />
  </label>;
  return <>
    <SettingsGroup title="Уведомления">
      {groupedRow("soundEnabled", "Звук в кабинете")}
      {groupedRow("telegramSchedule", "Telegram: расписание и запросы")}
      {groupedRow("telegramMessages", "Telegram: новые сообщения")}
      {groupedRow("telegramMaterials", "Telegram: материалы и домашние задания")}
      <div className={settingsRowClass}>
        <span className="flex min-w-0 items-center gap-3"><Send className="size-5 shrink-0 text-sky-600" /><span className="flex min-w-0 flex-col"><span className="text-[15px]">Telegram</span><span className="truncate text-xs text-ink-muted">{!status ? "Проверяем подключение…" : !status.configured ? "Бот ещё настраивается" : status.connected ? `Подключён${status.username ? ` · @${status.username}` : ""}` : "Не подключён"}</span></span></span>
        {status?.configured && (status.connected
          ? <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={pending} onClick={() => void disconnect()}>{pending ? "Отключаю…" : "Отключить"}</Button>
          : <Button type="button" size="sm" className="shrink-0 bg-sky-600 hover:bg-sky-700" disabled={pending} onClick={() => void connect()}>{pending ? "Создаю ссылку…" : "Подключить"}</Button>)}
      </div>
    </SettingsGroup>
    {status?.configured && !status.connected && <p className="px-1 text-xs leading-5 text-ink-muted">Откроется бот Тьюттори: нажмите «Запустить», затем вернитесь и <button type="button" className="font-semibold text-brand-text underline" disabled={pending} onClick={() => void load().catch(() => toast.error("Не удалось проверить подключение"))}>проверьте подключение</button>. Бот не получает доступ к вашим перепискам и контактам.</p>}
  </>;
}
