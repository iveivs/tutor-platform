import { getD1 } from "@/db/d1";
import { getAuthConfig, getAuthMember } from "@/lib/auth";
import { isLocalDemoRequest } from "@/lib/demo-mode";

export const MOSCOW_OFFSET = "+03:00";
export const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });
export const timeLabel = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" });
export const historyMomentLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" });

export function databaseConstraintName(error: unknown) {
  if (!error || typeof error !== "object" || !("constraint" in error)) return null;
  return typeof error.constraint === "string" ? error.constraint : null;
}

export async function requireMember(request?: Request) {
  if (!getAuthConfig()) {
    if (isLocalDemoRequest(request)) return { role: "owner" as const, memberId: "1", workspaceId: "1", userId: "1", name: "Преподаватель", email: "" };
    return Response.json({ error: "Авторизация не настроена" }, { status: 503 });
  }
  if (!request) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const member = await getAuthMember(request);
  if (!member) return Response.json({ error: "Требуется вход" }, { status: 401 });
  return member;
}

export function invalid() { return Response.json({ error: "Проверьте заполненные данные" }, { status: 400 }); }
export function conflict() { return Response.json({ error: "На это время уже назначен другой урок" }, { status: 409 }); }
export function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
export function minutesToTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
export function formatHistoryLesson(start: number, end: number | null) {
  const startLabel = historyMomentLabel.format(new Date(start));
  return end ? `${startLabel}–${timeLabel.format(new Date(end))}` : startLabel;
}
export function lessonEventStatement(db: ReturnType<typeof getD1>, input: {
  workspaceId: string;
  studentId: string;
  lessonId?: string | null;
  actorMemberId?: string | null;
  sourceKey?: string;
  eventType: "scheduled" | "rescheduled" | "cancelled" | "completed" | "series_stopped";
  previousStartsAt?: number | null;
  startsAt?: number | null;
  endsAt?: number | null;
  note?: string | null;
  occurredAt?: number;
}) {
  const eventId = crypto.randomUUID();
  return db.prepare(`INSERT INTO lesson_events (id, workspace_id, student_id, lesson_id, actor_member_id, source_key, event_type, previous_starts_at, starts_at, ends_at, note, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    eventId, input.workspaceId, input.studentId, input.lessonId ?? null, input.actorMemberId ?? null, input.sourceKey ?? eventId,
    input.eventType, input.previousStartsAt ?? null, input.startsAt ?? null, input.endsAt ?? null, input.note ?? null, input.occurredAt ?? Date.now(),
  );
}
export function toMoscowDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Moscow" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
export function lessonRange(date: string, time: string, durationMinutes = 60) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) return null;
  const start = new Date(`${date}T${time}:00${MOSCOW_OFFSET}`).getTime();
  if (!Number.isFinite(start)) return null;
  return { start, end: start + durationMinutes * 60_000, duration: durationMinutes };
}
export type LessonPart = {
  id: string; groupId?: string; studentId: string; date: string; time: string; end: string; name: string;
  status: "paid" | "low" | "debt" | "request" | "trial"; label: string; lessonType: "regular" | "trial"; past: boolean; startsAt: number; units: number; hasFile?: boolean; hasNote?: boolean;
};
export function groupLessonParts(parts: LessonPart[]) {
  const grouped = new Map<string, LessonPart[]>();
  for (const part of parts) {
    const key = part.groupId ? `group:${part.groupId}` : `lesson:${part.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), part]);
  }
  return [...grouped.values()].map((members) => {
    members.sort((a, b) => a.startsAt - b.startsAt);
    const first = members[0];
    const last = members.at(-1) ?? first;
    const actionable = members.find((member) => !member.past) ?? first;
    const units = members.length;
    const past = members.every((member) => member.past);
    const status = members.some((member) => member.status === "request") ? "request"
      : members.some((member) => member.status === "debt") ? "debt"
        : members.some((member) => member.status === "low") ? "low"
          : members.some((member) => member.status === "trial") ? "trial" : "paid";
    const label = units === 1 ? first.label : past ? (status === "debt" ? "Проведён · не оплачен" : "Проведён · оплачен")
      : status === "request" ? "Двойной · ожидает ответа"
        : status === "debt" ? `Двойной · ${first.label}`
          : members.every((member) => member.status === "paid") ? "Двойной · оплачен" : "Двойной · частично оплачен";
    const { startsAt: _startsAt, ...lesson } = first;
    void _startsAt;
    return { ...lesson, id: actionable.id, end: last.end, status, label, past, units, hasFile: members.some((member) => member.hasFile), hasNote: members.some((member) => member.hasNote) };
  }).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}
export type ScheduledLessonRow = { id: string; student_id: string; series_id: string | null; group_id: string | null; lesson_type: "regular" | "trial"; starts_at: number; ends_at: number };
export async function getScheduledLessonGroup(db: ReturnType<typeof getD1>, workspaceId: string, lessonId: string) {
  const lesson = await db.prepare("SELECT id, student_id, series_id, group_id, lesson_type, starts_at, ends_at FROM lessons WHERE id = ? AND workspace_id = ? AND status = 'scheduled'")
    .bind(lessonId, workspaceId).first<ScheduledLessonRow>();
  if (!lesson) return [];
  if (!lesson.group_id) return [lesson];
  const rows = await db.prepare("SELECT id, student_id, series_id, group_id, lesson_type, starts_at, ends_at FROM lessons WHERE group_id = ? AND workspace_id = ? AND status = 'scheduled' ORDER BY starts_at")
    .bind(lesson.group_id, workspaceId).all<ScheduledLessonRow>();
  return rows.results;
}
export async function hasConflict(db: ReturnType<typeof getD1>, workspaceId: string, start: number, end: number, exceptIds: string[] = []) {
  const exclusion = exceptIds.length ? `AND id NOT IN (${exceptIds.map(() => "?").join(", ")})` : "";
  const row = await db.prepare(`SELECT id FROM lessons WHERE workspace_id = ? AND status = 'scheduled' ${exclusion} AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(workspaceId, ...exceptIds, end, start).first();
  return Boolean(row);
}
export async function ensureSeriesLessons(db: ReturnType<typeof getD1>, workspaceId: string) {
  const owner = await db.prepare("SELECT id FROM members WHERE workspace_id = ? AND role IN ('owner', 'teacher') AND status = 'active' ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1").bind(workspaceId).first<{ id: string }>();
  if (!owner) return;
  const series = await db.prepare(`SELECT id, student_id, weekday, start_minutes, duration_minutes, active_from, active_until
    FROM lesson_series WHERE workspace_id = ? AND is_active = 1`).bind(workspaceId).all<Record<string, unknown>>();
  const startDate = toMoscowDate(new Date());
  const horizon = new Date(`${startDate}T12:00:00Z`); horizon.setUTCDate(horizon.getUTCDate() + 90);
  const horizonDate = horizon.toISOString().slice(0, 10);
  const horizonEnd = new Date(`${horizonDate}T23:59:59${MOSCOW_OFFSET}`).getTime();
  const dayStart = new Date(`${startDate}T00:00:00${MOSCOW_OFFSET}`).getTime();
  const existing = await db.prepare(`SELECT id, series_id, group_id, student_id, starts_at, ends_at, status FROM lessons
    WHERE workspace_id = ? AND starts_at <= ? AND ends_at >= ?`)
    .bind(workspaceId, horizonEnd, dayStart).all<Record<string, unknown>>();
  const occurrenceKey = (lesson: Record<string, unknown>) => `${String(lesson.series_id)}:${Number(lesson.starts_at)}`;
  const cancelledOccurrences = new Set(existing.results.filter((lesson) => lesson.series_id && lesson.status === "cancelled").map(occurrenceKey));
  const knownOccurrences = new Set(existing.results.filter((lesson) => lesson.series_id).map(occurrenceKey));
  const occupied = existing.results
    .filter((lesson) => lesson.status === "scheduled" && !(lesson.series_id && cancelledOccurrences.has(occurrenceKey(lesson))))
    .map((lesson) => ({ studentId: String(lesson.student_id), start: Number(lesson.starts_at), end: Number(lesson.ends_at) }));
  const statements: ReturnType<typeof db.prepare>[] = [];
  for (const lesson of existing.results) {
    if (lesson.status === "scheduled" && lesson.series_id && cancelledOccurrences.has(occurrenceKey(lesson))) {
      statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'")
        .bind(Date.now(), Date.now(), lesson.id));
    }
  }
  for (const row of series.results) {
    const firstDate = String(row.active_from) > startDate ? String(row.active_from) : startDate;
    const activeUntil = row.active_until ? String(row.active_until) : null;
    for (let date = firstDate; date <= horizonDate; date = shiftIsoDate(date, 1)) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
      if (weekday !== Number(row.weekday) || (activeUntil && date > activeUntil)) continue;
      const totalRange = lessonRange(date, minutesToTime(Number(row.start_minutes)), Number(row.duration_minutes));
      if (!totalRange) continue;
      const studentId = String(row.student_id);
      const count = Number(row.duration_minutes) === 120 ? 2 : 1;
      const ranges = count === 2
        ? [{ start: totalRange.start, end: totalRange.start + 60 * 60_000 }, { start: totalRange.start + 60 * 60_000, end: totalRange.end }]
        : [{ start: totalRange.start, end: totalRange.end }];
      const missing = ranges.filter((range) => !knownOccurrences.has(`${String(row.id)}:${range.start}`));
      if (!missing.length) continue;
      if (missing.some((range) => occupied.some((lesson) => lesson.start < range.end && lesson.end > range.start))) continue;
      const existingGroup = existing.results.find((lesson) => lesson.series_id === row.id && ranges.some((range) => Number(lesson.starts_at) === range.start) && lesson.group_id)?.group_id;
      const groupId = count === 2 ? String(existingGroup ?? crypto.randomUUID()) : null;
      for (const range of missing) {
        statements.push(db.prepare(`INSERT OR IGNORE INTO lessons (id, workspace_id, student_id, series_id, group_id, starts_at, ends_at, created_by_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), workspaceId, row.student_id, row.id, groupId, range.start, range.end, owner.id));
        occupied.push({ studentId, start: range.start, end: range.end });
      }
    }
  }
  if (statements.length) await db.batch(statements);
}

export function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nextOccurrenceDate(weekday: number, time: string) {
  const currentDate = toMoscowDate(new Date());
  const currentWeekday = new Date(`${currentDate}T12:00:00Z`).getUTCDay() || 7;
  let candidate = shiftIsoDate(currentDate, (weekday - currentWeekday + 7) % 7);
  const range = lessonRange(candidate, time);
  if (!range || range.start <= Date.now()) candidate = shiftIsoDate(candidate, 7);
  return candidate;
}

