"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FilterChips } from "@/components/common/filter-chips";
import { FormField } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes, rubles } from "./admin-model";

type Counts = { day: number; week: number; month: number };
type Day = {
  day: string; workspaces: number; workspacesNew: number; students: number; studentsNew: number; groups: number; paying: number;
  active: { teachers: Counts; students: Counts };
  files: Record<string, { files: number; bytes: number }>;
  workspaceSize: { students: { median: number; p90: number; max: number }; bytes: { median: number; p90: number; max: number }; largestBytes: number[] };
  actions: Record<string, number>;
  channels: { accounts: number; telegram: number; push: number };
  load: { avg: number | null; peak: number | null };
};
type Hour = { hour: number; cores: number; load1: number; memoryUsedBytes: number | null; memoryTotalBytes: number | null; diskUsedBytes: number | null; diskTotalBytes: number | null; databaseBytes: number; pendingTelegram: number; pendingPush: number; activeUsersHour: number };
type Rates = { serverRubPerMonth: number; storageRubPerGbMonth: number; trafficRubPerGb: number; proPriceRub: number; maxPriceRub: number; feePercent: number };

const fileKinds = [["pdf", "PDF"], ["photo", "Фото уроков"], ["image", "Изображения"], ["word", "Word"], ["audio", "Аудио MP3"]] as const;
const actionLabels = [["lessons", "Уроков создано"], ["payments", "Оплат внесено"], ["requests", "Запросов учеников"], ["directMessages", "Личных сообщений"], ["groupMessages", "Сообщений в чатах групп"], ["uploads", "Загрузок материалов"], ["photos", "Фото к урокам"]] as const;
const totalBytes = (day?: Day) => Object.values(day?.files ?? {}).reduce((sum, item) => sum + item.bytes, 0);
const totalFiles = (day?: Day) => Object.values(day?.files ?? {}).reduce((sum, item) => sum + item.files, 0);
const percent = (part: number, whole: number) => whole ? `${Math.round(part / whole * 100)}%` : "—";
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;

function Tile({ label, value, hint, tone = "" }: { label: string; value: string; hint: string; tone?: string }) {
  return <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4"><span className="text-[13px] font-semibold text-ink-muted">{label}</span><span className="text-2xl font-extrabold">{value}</span><span className={`text-xs ${tone || "text-ink-muted"}`}>{hint}</span></div>;
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 ${className}`}><strong className="text-[15px]">{title}</strong>{children}</section>;
}

function Bars({ values, highlightLast = true, label }: { values: number[]; highlightLast?: boolean; label: string }) {
  const max = Math.max(1, ...values);
  return <div role="img" aria-label={label} className="flex h-28 items-end gap-1">{values.map((value, index) => <span key={index} className={`min-w-0 flex-1 rounded-t ${highlightLast && index === values.length - 1 ? "bg-coral" : "bg-brand-solid"}`} style={{ height: `${Math.max(2, value / max * 100)}%` }} />)}</div>;
}

function Economics({ latest, rates, onSaved }: { latest?: Day; rates: Rates; onSaved: () => void }) {
  const [draft, setDraft] = useState(rates);
  const [pending, setPending] = useState(false);
  const storageGb = totalBytes(latest) / 1e9;
  // Traffic is not measured yet: assume every stored file is downloaded once a month.
  const trafficGb = storageGb;
  const paying = latest?.paying ?? 0;
  const revenue = paying * draft.proPriceRub;
  const fees = revenue * draft.feePercent / 100;
  const costs = draft.serverRubPerMonth + storageGb * draft.storageRubPerGbMonth + trafficGb * draft.trafficRubPerGb;
  const net = revenue - fees - costs;
  const perPro = draft.proPriceRub * (1 - draft.feePercent / 100);
  const breakEven = perPro > 0 ? Math.ceil(costs / perPro) : 0;
  const field = (key: keyof Rates, label: string) => <FormField label={label}><Input inputMode="decimal" value={String(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value.replace(",", ".")) || 0 })} className="h-10 rounded-xl" /></FormField>;
  const save = async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось сохранить ставки");
      toast.success("Ставки сохранены"); onSaved();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось сохранить ставки"); }
    finally { setPending(false); }
  };
  return <Card title="Экономика · в месяц" className="lg:col-span-3">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3">
        <Tile label="Выручка" value={rubles(revenue * 100)} hint={`платящих: ${paying}, по цене «Про»`} />
        <Tile label="Расходы" value={rubles((costs + fees) * 100)} hint={`сервер, ${storageGb.toFixed(1).replace(".", ",")} ГБ, налог и комиссия`} />
        <Tile label="Остаётся" value={rubles(net * 100)} hint={net >= 0 ? "проект в плюсе" : "пока в минусе"} tone={net >= 0 ? "text-success-text" : "text-danger-text"} />
        <Tile label="В ноль" value={`${breakEven}`} hint="платящих «Про» нужно" />
        <Tile label="На один кабинет" value={rubles((paying ? (costs + fees) / paying : costs) * 100)} hint="себестоимость" />
        <Tile label="Трафик" value={`${trafficGb.toFixed(1).replace(".", ",")} ГБ`} hint="оценка: пока не измеряется" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {field("serverRubPerMonth", "Сервер, ₽/мес")}{field("storageRubPerGbMonth", "Хранилище, ₽/ГБ")}{field("trafficRubPerGb", "Трафик, ₽/ГБ")}{field("feePercent", "Налог + комиссия, %")}{field("proPriceRub", "«Про», ₽")}{field("maxPriceRub", "«Макс», ₽")}
        <Button type="button" className="col-span-2 rounded-xl" disabled={pending} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить ставки"}</Button>
      </div>
    </div>
  </Card>;
}

// Admin «Статистика» tab: anonymized numbers collected by the worker (scripts/platform-stats.mjs).
export function PlatformStats() {
  const [data, setData] = useState<{ days: Day[]; hours: Hour[]; rates: Rates } | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"7" | "30" | "90">("30");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      const result = await response.json() as { error?: string; days: Day[]; hours: Hour[]; rates: Rates };
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить статистику");
      setData(result); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить статистику"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const view = useMemo(() => {
    const days = data?.days ?? [];
    const window = days.slice(-Number(period));
    const latest = days.at(-1);
    const first = window[0];
    const sum = (key: string) => window.reduce((total, day) => total + (day.actions?.[key] ?? 0), 0);
    const hourly = Array.from({ length: 24 }, (_, hour) => {
      const rows = (data?.hours ?? []).filter((row) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Moscow" }).format(new Date(row.hour))) % 24 === hour);
      return rows.length ? rows.reduce((total, row) => total + row.load1, 0) / rows.length : 0;
    });
    return { window, latest, first, sum, hourly, lastHour: data?.hours.at(-1) };
  }, [data, period]);

  if (error) return <div className="card p-8 text-center"><p className="font-semibold text-danger-text">{error}</p><Button className="mt-4" onClick={() => void load()}>Повторить</Button></div>;
  if (!data) return <div className="card p-8 text-center text-ink-muted">Загружаю статистику…</div>;
  const { latest, first, window: days, sum, hourly, lastHour } = view;
  if (!latest) return <div className="card p-8 text-center text-ink-muted">Статистика начнёт копиться после первого цикла фоновой обработки (до 15 минут).</div>;
  const storage = totalBytes(latest);
  const storageGrowth = storage - totalBytes(first);
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const loadPercent = lastHour?.cores ? Math.round((latest.load.peak ?? 0) / lastHour.cores * 100) : null;
  const diskShare = lastHour?.diskTotalBytes ? Math.round((lastHour.diskUsedBytes ?? 0) / lastHour.diskTotalBytes * 100) : null;
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-muted">Обезличенно: только числа, без имён, сообщений и названий файлов</p><FilterChips label="Период" items={[{ value: "7", label: "7 дней" }, { value: "30", label: "30 дней" }, { value: "90", label: "90 дней" }] as const} value={period} onChange={setPeriod} /></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Кабинеты" value={String(latest.workspaces)} hint={`${signed(latest.workspaces - (first?.workspaces ?? latest.workspaces))} за период · платят ${latest.paying}`} />
      <Tile label="Ученики" value={String(latest.students)} hint={`${signed(latest.students - (first?.students ?? latest.students))} за период · групп ${latest.groups}`} />
      <Tile label="Активные сегодня" value={String(latest.active.teachers.day + latest.active.students.day)} hint={`за 7 дней ${latest.active.teachers.week + latest.active.students.week} · за 30 дней ${latest.active.teachers.month + latest.active.students.month}`} />
      <Tile label="Хранилище" value={formatBytes(storage)} hint={`${storageGrowth >= 0 ? "+" : "−"}${formatBytes(Math.abs(storageGrowth))} за период · файлов ${totalFiles(latest)}`} tone="text-warning-text" />
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Рост хранилища" className="lg:col-span-2"><Bars values={days.map(totalBytes)} label="Рост хранилища по дням" /><span className="text-xs text-ink-muted">{`Преподавателей активно за 30 дней: ${latest.active.teachers.month}, учеников: ${latest.active.students.month}`}</span></Card>
      <Card title="Файлы по типам">{fileKinds.map(([kind, label]) => { const item = latest.files[kind]; const share = storage ? (item?.bytes ?? 0) / storage * 100 : 0; return <div key={kind} className="grid grid-cols-[100px_minmax(0,1fr)_auto] items-center gap-2 text-[13px]"><span>{label}</span><span className="h-2.5 rounded-full bg-surface-muted"><span className="block h-2.5 rounded-full bg-brand-solid" style={{ width: `${share}%` }} /></span><span className="text-ink-muted">{`${formatBytes(item?.bytes ?? 0)} · ${item?.files ?? 0}`}</span></div>; })}</Card>
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Размер кабинетов"><div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 gap-y-2 text-[13px]"><span /><span className="text-ink-muted">медиана</span><span className="text-ink-muted">90%</span><span className="text-ink-muted">макс.</span><span>Учеников</span><strong>{latest.workspaceSize.students.median}</strong><strong>{latest.workspaceSize.students.p90}</strong><strong>{latest.workspaceSize.students.max}</strong><span>Место</span><strong>{formatBytes(latest.workspaceSize.bytes.median)}</strong><strong>{formatBytes(latest.workspaceSize.bytes.p90)}</strong><strong>{formatBytes(latest.workspaceSize.bytes.max)}</strong></div><span className="text-xs text-ink-muted">{`Самые большие: ${latest.workspaceSize.largestBytes.map(formatBytes).join(", ") || "—"}`}</span></Card>
      <Card title="Чем пользуются за период">{actionLabels.map(([key, label]) => <span key={key} className="flex justify-between text-[13px]"><span>{label}</span><strong>{sum(key)}</strong></span>)}<span className="flex justify-between text-[13px]"><span>Включили Telegram / push</span><strong>{`${percent(latest.channels.telegram, latest.channels.accounts)} / ${percent(latest.channels.push, latest.channels.accounts)}`}</strong></span></Card>
      <Card title="Нагрузка"><Bars values={hourly} highlightLast={false} label="Средняя загрузка процессора по часам" /><span className="text-xs text-ink-muted">{`Пик нагрузки около ${peakHour}:00 по Москве · за сегодня максимум ${loadPercent ?? "—"}% процессора`}</span>
        <div className="grid grid-cols-2 gap-2 text-[13px]"><span className="rounded-xl bg-surface-subtle p-2.5">{`База: ${formatBytes(lastHour?.databaseBytes ?? 0)}`}</span><span className={`rounded-xl p-2.5 ${diskShare !== null && diskShare >= 80 ? "bg-danger-soft text-danger-ink" : "bg-surface-subtle"}`}>{`Диск: ${diskShare ?? "—"}%`}</span><span className="rounded-xl bg-surface-subtle p-2.5">{`Память: ${lastHour?.memoryTotalBytes ? percent(lastHour.memoryUsedBytes ?? 0, lastHour.memoryTotalBytes) : "—"}`}</span><span className="rounded-xl bg-surface-subtle p-2.5">{`Очередь: ${(lastHour?.pendingTelegram ?? 0) + (lastHour?.pendingPush ?? 0)}`}</span></div></Card>
      <Economics latest={latest} rates={data.rates} onSaved={() => void load()} />
    </div>
  </div>;
}
