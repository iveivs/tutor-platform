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
  requests?: Record<string, { requests: number; errors: number; slow: number; avgMs: number; bytes: number; peakOpen: number; peakHour: number }>;
};
type RequestHour = { hour: number; kind: string; requests: number; errors: number; totalMs: number; buckets: number[]; bytes: number; peakOpen: number };
type StatsData = { days: Day[]; hours: Hour[]; rates: Rates; requestHours: RequestHour[]; alertMemberId: string | null; owners: Array<{ id: string; name: string }> };
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

function Economics({ latest, rates, monthlyFileBytes, onSaved }: { latest?: Day; rates: Rates; monthlyFileBytes: number | null; onSaved: () => void }) {
  const [draft, setDraft] = useState(rates);
  const [pending, setPending] = useState(false);
  const storageGb = totalBytes(latest) / 1e9;
  // Measured: bytes of file downloads served by the app over the last 30 days (scaled if fewer
  // days are recorded). Until then assume every stored file is downloaded once a month.
  const trafficGb = monthlyFileBytes !== null ? monthlyFileBytes / 1e9 : storageGb;
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
        <Tile label="Трафик файлов" value={`${trafficGb.toFixed(1).replace(".", ",")} ГБ`} hint={monthlyFileBytes !== null ? "за 30 дней, измерено" : "оценка: замер начался недавно"} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {field("serverRubPerMonth", "Сервер, ₽/мес")}{field("storageRubPerGbMonth", "Хранилище, ₽/ГБ")}{field("trafficRubPerGb", "Трафик, ₽/ГБ")}{field("feePercent", "Налог + комиссия, %")}{field("proPriceRub", "«Про», ₽")}{field("maxPriceRub", "«Макс», ₽")}
        <Button type="button" className="col-span-2 rounded-xl" disabled={pending} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить ставки"}</Button>
      </div>
    </div>
  </Card>;
}

function monthlyFileBytes(days: Day[]) {
  const measured = days.slice(-30).filter((day) => day.requests);
  if (measured.length < 3) return null;
  const bytes = measured.reduce((sum, day) => sum + (day.requests?.file?.bytes ?? 0), 0);
  return bytes * 30 / measured.length;
}

function Requests({ hours, latest }: { hours: RequestHour[]; latest: Day }) {
  const web = hours.filter((row) => row.kind !== "realtime");
  const byHour = new Map<number, number>();
  for (const row of web) byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + row.requests);
  const series = [...byHour.entries()].sort((a, b) => a[0] - b[0]).slice(-48).map(([, value]) => value);
  const total = web.reduce((sum, row) => sum + row.requests, 0);
  const slow = web.reduce((sum, row) => sum + (row.buckets[3] ?? 0) + (row.buckets[4] ?? 0), 0);
  const errors = web.reduce((sum, row) => sum + row.errors, 0);
  const avgMs = total ? Math.round(web.reduce((sum, row) => sum + row.totalMs, 0) / total) : 0;
  const peakOpen = Math.max(0, ...hours.filter((row) => row.kind === "realtime").map((row) => row.peakOpen));
  const today = latest.requests ?? {};
  const todayRequests = Object.entries(today).filter(([kind]) => kind !== "realtime").reduce((sum, [, value]) => sum + value.requests, 0);
  return <Card title="Запросы к сайту · 7 дней" className="lg:col-span-2">
    {series.length ? <Bars values={series} label="Запросы по часам за последние двое суток" /> : <p className="text-sm text-ink-muted">Замер запросов начался недавно, первые данные появятся в течение часа.</p>}
    <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
      <span className="rounded-xl bg-surface-subtle p-2.5">{`Сегодня: ${todayRequests}`}</span>
      <span className="rounded-xl bg-surface-subtle p-2.5">{`Средний ответ: ${avgMs} мс`}</span>
      <span className={`rounded-xl p-2.5 ${total && slow / total > 0.1 ? "bg-warning-soft text-warning-ink" : "bg-surface-subtle"}`}>{`Дольше секунды: ${percent(slow, total)}`}</span>
      <span className={`rounded-xl p-2.5 ${total && errors / total > 0.05 ? "bg-danger-soft text-danger-ink" : "bg-surface-subtle"}`}>{`Ошибок: ${percent(errors, total)}`}</span>
    </div>
    <span className="text-xs text-ink-muted">{`Живых соединений одновременно, максимум: ${peakOpen}`}</span>
  </Card>;
}

function Alerts({ owners, memberId, onSaved }: { owners: StatsData["owners"]; memberId: string | null; onSaved: () => void }) {
  const save = async (value: string) => {
    try {
      const response = await fetch("/api/admin/stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alertMemberId: value || null }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось сохранить");
      toast.success("Сохранено"); onSaved();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Не удалось сохранить"); }
  };
  return <Card title="Оповещения">
    <p className="text-[13px] text-ink-muted">Диск больше 80%, процессор загружен три часа подряд, память больше 90%, медленные ответы или ошибки сайта, очередь уведомлений. Не чаще раза в 6 часов на каждую проблему.</p>
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">Присылать в кабинет (уведомление, Telegram, push)
      <select value={memberId ?? ""} onChange={(event) => void save(event.target.value)} className="h-10 rounded-xl border border-line bg-surface px-3 text-[15px] font-normal text-ink-strong"><option value="">Не присылать</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select>
    </label>
  </Card>;
}

// Admin «Статистика» tab: anonymized numbers collected by the worker (scripts/platform-stats.mjs).
export function PlatformStats() {
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"7" | "30" | "90">("30");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      const result = await response.json() as StatsData & { error?: string };
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
      <Requests hours={data.requestHours} latest={latest} />
      <Alerts owners={data.owners} memberId={data.alertMemberId} onSaved={() => void load()} />
      <Economics latest={latest} rates={data.rates} monthlyFileBytes={monthlyFileBytes(data.days)} onSaved={() => void load()} />
    </div>
  </div>;
}
