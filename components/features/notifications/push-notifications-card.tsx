"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import type { NotificationPreferences } from "@/components/features/app/types";
import { SettingsGroup, settingsRowClass } from "@/components/features/settings/settings-group";
import { defaultPreferences, savePreference } from "@/components/features/telegram/telegram-notifications-card";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { appFetch } from "@/lib/client-fetch";
import { disablePushOnThisDevice, enablePushOnThisDevice, isIosDevice, readPushDeviceState, type PushDeviceState } from "@/lib/push-client";

const stateLabel: Record<PushDeviceState, string> = {
  unsupported: "Этот браузер не поддерживает уведомления",
  "ios-home-screen": "Откройте Тьюттори с экрана «Домой»",
  "not-configured": "Ещё не настроены на сервере",
  denied: "Запрещены в настройках браузера",
  off: "Выключены",
  on: "Включены",
};

type PushPreferenceKey = "pushSchedule" | "pushMessages" | "pushMaterials";

// Web Push for this browser or home-screen app, with the push categories and device hints.
export function PushNotificationsCard({ audience }: { audience: "teacher" | "student" }) {
  const { language } = useLanguage();
  const [device, setDevice] = useState<{ state: PushDeviceState; publicKey: string | null } | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      readPushDeviceState(),
      appFetch("/api/notification-preferences", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<NotificationPreferences> : defaultPreferences),
    ]).then(([nextDevice, nextPreferences]) => {
      if (!active) return;
      setDevice(nextDevice);
      setPreferences(nextPreferences);
    }).catch(() => { if (active) setDevice({ state: "unsupported", publicKey: null }); });
    return () => { active = false; };
  }, []);

  const enable = async () => {
    if (!device?.publicKey) return;
    setPending(true);
    try {
      const state = await enablePushOnThisDevice(device.publicKey, language);
      setDevice({ ...device, state });
      if (state === "on") toast.success("Уведомления на этом устройстве включены");
      else if (state === "denied") toast.error("Уведомления запрещены в настройках браузера");
    } catch (error) {
      // Browser errors (DOMException) are not user-facing; server answers are.
      toast.error(error instanceof Error && !(error instanceof DOMException) ? error.message : "Не удалось включить уведомления");
    } finally {
      setPending(false);
    }
  };

  const disable = async () => {
    if (!device) return;
    setPending(true);
    try {
      await disablePushOnThisDevice();
      setDevice({ ...device, state: "off" });
      toast.success("Уведомления на этом устройстве выключены");
    } catch {
      toast.error("Не удалось выключить уведомления");
    } finally {
      setPending(false);
    }
  };

  const sendTest = async () => {
    setPending(true);
    try {
      const response = await appFetch("/api/push/test", { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось отправить проверку");
      toast.success("Проверка отправлена — уведомление придёт через несколько секунд");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить проверку");
    } finally {
      setPending(false);
    }
  };

  const changePreference = async (key: PushPreferenceKey, checked: boolean) => {
    const previous = preferences ?? defaultPreferences;
    setPreferences({ ...previous, [key]: checked });
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

  const preferenceRow = (key: PushPreferenceKey, title: string) => <label className={`${settingsRowClass} cursor-pointer`}>
    <span className="min-w-0 text-[15px]">{title}</span>
    <Switch checked={(preferences ?? defaultPreferences)[key]} disabled={pending} onCheckedChange={(checked) => void changePreference(key, checked)} aria-label={title} />
  </label>;

  const state = device?.state;
  const iosHint = isIosDevice();
  return <>
    <SettingsGroup title="Уведомления на устройстве">
      <div className={settingsRowClass}>
        <span className="flex min-w-0 items-center gap-3"><BellRing className="size-5 shrink-0 text-brand-text" /><span className="flex min-w-0 flex-col"><span className="text-[15px]">Уведомления на этом устройстве</span><span className="text-xs text-ink-muted">{state ? stateLabel[state] : "Проверяем…"}</span></span></span>
        {state === "off" && <Button type="button" size="sm" className="shrink-0" disabled={pending} onClick={() => void enable()}>{pending ? "Включаю…" : "Включить"}</Button>}
        {state === "on" && <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={pending} onClick={() => void disable()}>{pending ? "Выключаю…" : "Выключить"}</Button>}
      </div>
      {state === "on" && <>
        {preferenceRow("pushSchedule", "Расписание и запросы")}
        {preferenceRow("pushMessages", "Новые сообщения")}
        {preferenceRow("pushMaterials", "Материалы и домашние задания")}
        <div className={settingsRowClass}>
          <span className="min-w-0 text-[15px]">Проверочное уведомление</span>
          <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={pending} onClick={() => void sendTest()}>Отправить</Button>
        </div>
      </>}
    </SettingsGroup>
    <div className="flex flex-col gap-1.5 px-1 text-xs leading-5 text-ink-muted">
      <p>{audience === "teacher" ? "Цифра на значке приложения — непрочитанные уведомления и запросы учеников." : "Цифра на значке приложения — непрочитанные уведомления."}</p>
      {state === "denied" && <p>Чтобы включить, разрешите уведомления для этого сайта в настройках браузера или телефона.</p>}
      <p className={iosHint ? "font-semibold text-foreground" : undefined}>iPhone и iPad: уведомления работают только в приложении на экране «Домой», iOS 16.4 или новее. В Safari нажмите «Поделиться» → «На экран „Домой“», откройте Тьюттори с иконки и включите уведомления здесь.</p>
      <p>Android: Chrome обычно показывает на значке точку вместо цифры.</p>
    </div>
  </>;
}
