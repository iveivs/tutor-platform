"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/common/app-shell";
import { FilterChips } from "@/components/common/filter-chips";
import { FormField } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appFetch } from "@/lib/client-fetch";
import { dateTitle, shiftDate, shiftMonth, today } from "@/lib/date-time";
import { formatMoney } from "@/lib/money";
import { russianPlural } from "@/lib/russian-plural";
import type { TeacherStats } from "@/lib/teacher-stats";

type Mode = "week" | "month" | "year" | "custom";
const modes: ReadonlyArray<{ value: Mode; label: string }> = [{ value: "week", label: "Неделя" }, { value: "month", label: "Месяц" }, { value: "year", label: "Год" }, { value: "custom", label: "Период" }];
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const weekStart = (date: string) => { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return shiftDate(date, -((day + 6) % 7)); };
const monthEnd = (date: string) => shiftDate(shiftMonth(`${date.slice(0, 7)}-01`, 1), -1);

// Period of the selected mode around the anchor date; the current period ends today.
function periodOf(mode: Mode, anchor: string, custom: { from: string; to: string }) {
  if (mode === "custom") return custom;
  const [from, end] = mode === "week" ? [weekStart(anchor), shiftDate(weekStart(anchor), 6)] : mode === "month" ? [`${anchor.slice(0, 7)}-01`, monthEnd(anchor)] : [`${anchor.slice(0, 4)}-01-01`, `${anchor.slice(0, 4)}-12-31`];
  return { from, to: end > today() ? today() : end };
}
const shiftAnchor = (mode: Mode, anchor: string, step: number) => mode === "week" ? shiftDate(anchor, step * 7) : mode === "month" ? shiftMonth(anchor, step) : `${Number(anchor.slice(0, 4)) + step}-06-15`;

function periodTitle(mode: Mode, from: string, to: string) {
  const range = `${dateTitle(from, { day: "numeric", month: "long" })} – ${dateTitle(to, { day: "numeric", month: "long" })}`;
  if (mode === "month") return `${monthNames[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)} · ${range}`;
  if (mode === "year") return `${from.slice(0, 4)} год`;
  return range;
}

// Chart buckets: days for short periods, weeks up to three months, months beyond.
function buckets(daily: TeacherStats["daily"]) {
  const current = today();
  if (daily.length <= 14) return daily.map((day) => ({ label: dateTitle(day.date, { weekday: "short" }).replace(".", ""), sub: String(Number(day.date.slice(8))), value: day.lessons, current: day.date === current }));
  const groups = new Map<string, { label: string; sub: string; value: number; current: boolean }>();
  for (const day of daily) {
    const key = daily.length <= 93 ? weekStart(day.date) : day.date.slice(0, 7);
    const group = groups.get(key) ?? { label: daily.length <= 93 ? dateTitle(key, { day: "numeric", month: "short" }) : dateTitle(`${key}-01`, { month: "short" }), sub: "", value: 0, current: false };
    group.value += day.lessons; group.current ||= day.date === current; groups.set(key, group);
  }
  return [...groups.values()];
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "bad" }) {
  return <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-4">
    <span className="text-xs font-semibold text-ink-muted">{label}</span>
    <span className="truncate text-2xl font-bold tracking-tight">{value}</span>
    <span className={`text-xs font-semibold ${tone === "good" ? "text-success-text" : tone === "bad" ? "text-danger-text" : "text-ink-muted"}`}>{sub}</span>
  </div>;
}

export function StatsView() {
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState(() => ({ from: shiftDate(today(), -29), to: today() }));
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [error, setError] = useState("");
  const period = useMemo(() => periodOf(mode, anchor, custom), [mode, anchor, custom]);
  const customInvalid = mode === "custom" && (!custom.from || !custom.to || custom.from > custom.to);

  useEffect(() => {
    if (customInvalid) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setError("");
      void appFetch(`/api/teacher-stats?from=${period.from}&to=${period.to}`, { cache: "no-store" })
        .then(async (response) => { const result = await response.json() as TeacherStats & { error?: string }; if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить статистику"); if (active) setStats(result); })
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Не удалось загрузить статистику"));
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [period.from, period.to, customInvalid]);

  const currency = stats?.currency ?? null;
  const chart = stats ? buckets(stats.daily) : [];
  const peak = Math.max(1, ...chart.map((bucket) => bucket.value));
  const diff = stats ? stats.lessons.completed - stats.lessons.previousCompleted : 0;
  const weeks = stats ? stats.daily.length / 7 : 1;
  const atLatest = mode !== "custom" && periodOf(mode, shiftAnchor(mode, anchor, 1), custom).from > today();

  return <AppShell title="Статистика" eyebrow={periodTitle(mode, period.from, period.to)}>
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips label="Период" items={modes} value={mode} onChange={(value) => { setMode(value); setAnchor(today()); }} />
        {mode !== "custom" && <div className="flex items-center gap-1"><Button type="button" variant="outline" size="icon" aria-label="Предыдущий период" onClick={() => setAnchor((value) => shiftAnchor(mode, value, -1))}><ChevronLeft /></Button><Button type="button" variant="outline" size="icon" aria-label="Следующий период" disabled={atLatest} onClick={() => setAnchor((value) => shiftAnchor(mode, value, 1))}><ChevronRight /></Button></div>}
      </div>
      {mode === "custom" && <div className="grid max-w-md grid-cols-2 gap-3"><FormField label="С"><Input type="date" value={custom.from} max={today()} onChange={(event) => setCustom((value) => ({ ...value, from: event.target.value }))} className="h-11 rounded-xl" /></FormField><FormField label="По"><Input type="date" value={custom.to} max={today()} onChange={(event) => setCustom((value) => ({ ...value, to: event.target.value }))} className="h-11 rounded-xl" /></FormField></div>}
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink">{error}</p>}
      {!stats && !error && <div className="rounded-[var(--radius-card)] border border-line bg-surface p-8 text-center text-ink-muted">Загружаю статистику…</div>}
      {stats && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Проведено уроков" value={String(stats.lessons.completed)} sub={`${diff >= 0 ? "+" : "−"}${Math.abs(diff)} к прошлому периоду`} tone={diff > 0 ? "good" : diff < 0 ? "bad" : undefined} />
          <Tile label="Часы занятий" value={`${Math.round(stats.lessons.minutes / 6) / 10} ч`} sub={weeks >= 1 ? `в среднем ${Math.round(stats.lessons.minutes / 6 / weeks) / 10} ч в неделю` : "за выбранные дни"} />
          <Tile label="Получено оплат" value={stats.money.receivedCents ? formatMoney(stats.money.receivedCents, currency) : "—"} sub={`${russianPlural(stats.money.payments, "оплата", "оплаты", "оплат")}${stats.money.chargedCents ? ` · уроки на ${formatMoney(stats.money.chargedCents, currency)}` : ""}`} />
          <Tile label="Должны сейчас" value={stats.money.debtCents ? formatMoney(stats.money.debtCents, currency) : russianPlural(stats.money.debtLessons, "занятие", "занятия", "занятий")} sub={stats.money.debtStudents ? `${russianPlural(stats.money.debtStudents, "ученик", "ученика", "учеников")} · ${russianPlural(stats.money.debtLessons, "занятие", "занятия", "занятий")}` : "долгов нет"} tone={stats.money.debtStudents ? "bad" : "good"} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-label="Уроки по периодам" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3"><h2 className="text-base font-bold">Уроки</h2><span className="text-xs text-ink-muted">{stats.daily.length <= 14 ? "по дням" : stats.daily.length <= 93 ? "по неделям" : "по месяцам"}</span></div>
            <div className="flex h-48 items-end gap-1.5">{chart.map((bucket, index) => <div key={index} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${bucket.label} ${bucket.sub}: ${bucket.value}`}>
              <span className="text-[11px] font-bold">{bucket.value || ""}</span>
              <span className={`w-full max-w-10 rounded-t-md rounded-b-sm ${bucket.current ? "bg-coral" : "bg-brand-solid"}`} style={{ height: `${Math.max(bucket.value ? 6 : 2, (bucket.value / peak) * 140)}px`, opacity: bucket.value ? 1 : 0.25 }} />
              <span className="max-w-full truncate text-[10px] text-ink-muted">{bucket.label}</span>
              {bucket.sub && <span className="text-[10px] text-ink-subtle">{bucket.sub}</span>}
            </div>)}</div>
          </section>
          <section aria-label="Показатели" className="grid grid-cols-3 rounded-[var(--radius-card)] border border-line bg-surface p-1 text-center">
            {[[stats.people.workingDays, "рабочих дней"], [stats.people.activeStudents, "активных учеников"], [stats.people.newStudents, "новых учеников"], [stats.people.paused, "приостановили"], [stats.lessons.cancelled, "отменено"], [stats.lessons.rescheduled, "перенесено"]].map(([value, label]) => <div key={String(label)} className="flex flex-col justify-center gap-0.5 px-1 py-3"><strong className="text-xl">{value}</strong><span className="text-xs leading-tight text-ink-muted">{label}</span></div>)}
          </section>
        </div>
        <section aria-labelledby="stats-students-title" className="flex flex-col gap-2">
          <h2 id="stats-students-title" className="px-1 pt-1 text-[13px] font-bold uppercase tracking-wide text-ink-muted">Ученики за период</h2>
          {stats.students.length ? <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">{stats.students.map((student, index) => <div key={student.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${index < stats.students.length - 1 ? "border-b border-line" : ""}`}>
            <span className="flex min-w-0 flex-col"><span data-no-translate className="truncate text-[15px] font-semibold">{student.name}</span><span className="text-sm text-ink-muted">{russianPlural(student.lessons, "урок", "урока", "уроков")}{student.chargedCents ? ` · ${formatMoney(student.chargedCents, currency)}` : ""}</span></span>
            <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold ${student.balance < 0 ? "bg-status-debt text-status-debt-ink" : "bg-status-paid text-status-paid-ink"}`}>{student.balance < 0 ? `Долг ${Math.abs(student.balance)}` : russianPlural(student.balance, "занятие", "занятия", "занятий")}</span>
          </div>)}</div> : <p className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-ink-muted">За этот период уроков не было.</p>}
        </section>
      </>}
    </div>
  </AppShell>;
}
