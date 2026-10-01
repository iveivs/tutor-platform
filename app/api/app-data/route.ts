import { getD1 } from "@/db/d1";
import { buildAvailableSlots, normalizeAvailabilityWindow } from "@/lib/availability";
import { assertSameOrigin, getAuthConfig, getAuthMember, randomToken, sha256 } from "@/lib/auth";
import { isLocalDemoRequest } from "@/lib/demo-mode";
import { settlePastLessons } from "@/lib/lesson-maintenance";
import { collectChangedSections, incrementalDataSections, type IncrementalDataSection } from "@/lib/incremental-sync";
import { groupDoubleLessonCharges, groupDoubleLessonEvents } from "@/lib/double-lesson-history";
import { enforceRateLimit, readLimitedJson } from "@/lib/request-security";
import { env } from "cloudflare:workers";
import { z } from "zod";

const MOSCOW_OFFSET = "+03:00";

const id = z.string().min(1).max(128);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const duration = z.number().int().min(15).max(240).optional();
const lessonCount = z.union([z.literal(1), z.literal(2)]).optional();
const email = z.union([z.literal(""), z.string().email().max(254)]).optional();
const actionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createLesson"), studentId: id, date, time, durationMinutes: duration, lessonCount, lessonType: z.enum(["regular", "trial"]).optional(), repeat: z.enum(["once", "weekly"]).optional() }).strict(),
  z.object({ action: z.literal("updateLesson"), lessonId: id, date, time, durationMinutes: duration }).strict(),
  z.object({ action: z.literal("deleteLesson"), lessonId: id }).strict(),
  z.object({ action: z.literal("stopLessonSeries"), seriesId: id }).strict(),
  z.object({ action: z.literal("createStudent"), name: z.string().trim().min(1).max(80), email, floating: z.boolean(), weekday: z.number().int().min(1).max(7).optional(), time: time.optional(), durationMinutes: duration }).strict(),
  z.object({ action: z.literal("updateStudent"), studentId: id, name: z.string().trim().min(1).max(80), email, canViewAvailability: z.boolean() }).strict(),
  z.object({ action: z.literal("createStudentInvite"), studentId: id }).strict(),
  z.object({ action: z.literal("addPayment"), studentId: id, count: z.number().int().min(1).max(100), paymentDate: date.optional() }).strict(),
  z.object({ action: z.literal("adjustBalance"), studentId: id, units: z.number().int().min(-100).max(100).refine((value) => value !== 0), note: z.string().trim().min(3).max(200) }).strict(),
  z.object({ action: z.literal("reversePayment"), paymentId: id }).strict(),
  z.object({ action: z.literal("resolveRequest"), requestId: id, decision: z.enum(["approved", "declined"]) }).strict(),
  z.object({ action: z.literal("submitStudentRequest"), requestType: z.enum(["cancel", "reschedule", "new_lesson"]), lessonId: id.optional(), proposedDate: date.optional(), proposedTime: time.optional(), lessonCount, message: z.string().trim().max(500).optional(), studentId: id.optional() }).strict(),
  z.object({ action: z.literal("updateProfile"), name: z.string().trim().min(2).max(80), professionalTitle: z.string().trim().max(50) }).strict(),
  z.object({ action: z.literal("replaceAvailability"), windows: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: time, end: time }).strict()).max(50) }).strict(),
  z.object({ action: z.literal("markNotificationsRead") }).strict(),
]);
type ActionBody = z.infer<typeof actionBodySchema>;

const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });
const timeLabel = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" });
const historyMomentLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" });

export async function GET(request: Request) {
  try {
    const auth = await requireMember(request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const includePastLessons = url.searchParams.get("includePastLessons") === "1";
    const cursorValue = url.searchParams.get("cursor");
    if (cursorValue !== null && !/^\d+$/.test(cursorValue)) return invalid();
    const requestedCursor = cursorValue === null ? null : Number(cursorValue);
    if (requestedCursor !== null && !Number.isSafeInteger(requestedCursor)) return invalid();
    const db = getD1();
    let sections = new Set<IncrementalDataSection>(incrementalDataSections);
    let syncCursor = 0;
    if (requestedCursor === null) {
      await ensureSeriesLessons(db, auth.workspaceId);
      await settlePastLessons(db, auth.workspaceId);
      const latest = await db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM data_changes WHERE workspace_id = ? AND audience_member_id = ?")
        .bind(auth.workspaceId, auth.memberId).first<{ id: number }>();
      syncCursor = Number(latest?.id ?? 0);
    } else {
      const changedRows = await db.prepare(`SELECT sections, MAX(id) AS id FROM data_changes
        WHERE workspace_id = ? AND audience_member_id = ? AND id > ? GROUP BY sections`)
        .bind(auth.workspaceId, auth.memberId, requestedCursor).all<{ sections: string; id: number }>();
      if (!changedRows.results.length) return Response.json({ syncCursor: requestedCursor });
      const changed = collectChangedSections(changedRows.results, requestedCursor);
      sections = changed.sections;
      syncCursor = changed.cursor;
    }
    const ownStudentId = auth.role === "student" ? auth.memberId : null;
    const needs = (...values: IncrementalDataSection[]) => values.some((value) => sections.has(value));
    const availabilityAccess = auth.role !== "student" || !needs("availability") ? auth.role !== "student" : Boolean(await db.prepare("SELECT can_view_availability FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status = 'active'").bind(auth.memberId, auth.workspaceId).first<{ can_view_availability: number }>()?.then((row) => row?.can_view_availability));
    const availabilityHorizon = Date.now() + 16 * 24 * 60 * 60_000;
    const loadRows = (enabled: boolean, load: () => Promise<unknown>) => enabled
      ? load().then((result) => result as { results: Array<Record<string, unknown>> })
      : Promise.resolve({ results: [] as Array<Record<string, unknown>> });
    const [studentRows, seriesRows, lessonRows, requestRows, balanceRows, notificationRows, teacherRow, viewerRow, lessonEventRows, historyRequestRows, historyBalanceRows, availabilityRows, availabilityBusyRows] = await Promise.all([
      loadRows(needs("students"), () => db.prepare(`SELECT m.id, m.display_name, m.email, m.status, m.schedule_type, m.can_view_availability,
        COALESCE((SELECT SUM(b.lesson_units) FROM balance_entries b WHERE b.student_id = m.id), 0) AS balance,
        (SELECT MIN(l.starts_at) FROM lessons l WHERE l.student_id = m.id AND l.status = 'scheduled' AND l.starts_at >= ?) AS next_lesson
        FROM members m
        WHERE m.workspace_id = ? AND m.role = 'student' AND m.status != 'archived' AND (? IS NULL OR m.id = ?)
        ORDER BY m.display_name`).bind(Date.now(), auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("students", "lessons"), () => db.prepare(`SELECT id, student_id, weekday, start_minutes, duration_minutes FROM lesson_series
        WHERE workspace_id = ? AND is_active = 1 AND (? IS NULL OR student_id = ?) ORDER BY weekday, start_minutes`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("lessons"), () => db.prepare(`SELECT l.id, l.student_id, l.group_id, l.lesson_type, l.starts_at, l.ends_at, l.status AS lesson_status, m.display_name,
        COALESCE((SELECT SUM(be.lesson_units) FROM balance_entries be WHERE be.student_id = l.student_id), 0) AS balance,
        (SELECT r.type FROM lesson_requests r LEFT JOIN lessons requested ON requested.id = r.lesson_id
          WHERE r.status = 'pending' AND (r.lesson_id = l.id OR (l.group_id IS NOT NULL AND requested.group_id = l.group_id))
          ORDER BY r.created_at LIMIT 1) AS request_type
        FROM lessons l JOIN members m ON m.id = l.student_id
        WHERE l.workspace_id = ?
          AND ((l.status = 'scheduled' AND l.ends_at > ?)
            OR (l.group_id IS NOT NULL AND l.status = 'completed' AND EXISTS (
              SELECT 1 FROM lessons peer WHERE peer.group_id = l.group_id AND peer.status = 'scheduled' AND peer.ends_at > ?
            ))
            OR (? = 1 AND l.status = 'completed'))
          AND (? IS NULL OR l.student_id = ?)
        ORDER BY l.starts_at`).bind(auth.workspaceId, Date.now(), Date.now(), includePastLessons ? 1 : 0, ownStudentId, ownStudentId).all()),
      loadRows(needs("requests"), () => db.prepare(`SELECT r.id, r.type, r.message, r.proposed_starts_at, r.proposed_ends_at, l.starts_at,
        m.display_name FROM lesson_requests r
        JOIN members m ON m.id = r.student_id
        LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.workspace_id = ? AND r.status = 'pending' AND (? IS NULL OR r.student_id = ?) ORDER BY r.created_at`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("balanceEntries"), () => db.prepare(`SELECT b.id, b.student_id, b.kind, b.lesson_units, b.note, b.occurred_at,
        EXISTS(SELECT 1 FROM balance_entries reversal WHERE reversal.reverses_entry_id = b.id) AS reversed
        FROM balance_entries b
        WHERE b.workspace_id = ? AND (? IS NULL OR b.student_id = ?) ORDER BY b.occurred_at DESC, b.created_at DESC`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("notifications"), () => db.prepare(`SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at,
        student.display_name AS student_name,
        request.type AS request_type, request.status AS request_status, request.message AS request_message,
        request.proposed_starts_at, request.proposed_ends_at,
        lesson.starts_at AS lesson_starts_at, lesson.ends_at AS lesson_ends_at,
        balance.lesson_units
        FROM notifications n
        LEFT JOIN lesson_requests request ON request.id = n.request_id
        LEFT JOIN lessons lesson ON lesson.id = COALESCE(n.lesson_id, request.lesson_id)
        LEFT JOIN balance_entries balance ON balance.id = n.balance_entry_id
        LEFT JOIN members student ON student.id = COALESCE(n.student_id, request.student_id, lesson.student_id, balance.student_id)
        WHERE n.member_id = ? ORDER BY n.created_at DESC LIMIT 30`).bind(auth.memberId).all()),
      needs("profile") ? db.prepare(`SELECT display_name, professional_title FROM members WHERE workspace_id = ? AND role IN ('owner', 'teacher') AND status = 'active'
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1`).bind(auth.workspaceId).first<{ display_name: string; professional_title: string }>() : Promise.resolve(null),
      needs("profile") ? db.prepare(`SELECT m.display_name, m.professional_title, COALESCE(m.email, u.email, '') AS email FROM members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = ? AND m.workspace_id = ? LIMIT 1`).bind(auth.memberId, auth.workspaceId).first<{ display_name: string; professional_title: string; email: string }>() : Promise.resolve(null),
      loadRows(needs("historyEvents"), () => db.prepare(`SELECT e.id, e.student_id, e.event_type, e.previous_starts_at, e.starts_at, e.ends_at, e.note, e.occurred_at,
        lesson.group_id AS lesson_group_id, lesson.lesson_type, student.display_name, actor.display_name AS actor_name
        FROM lesson_events e
        JOIN members student ON student.id = e.student_id
        LEFT JOIN lessons lesson ON lesson.id = e.lesson_id
        LEFT JOIN members actor ON actor.id = e.actor_member_id
        WHERE e.workspace_id = ? AND (? IS NULL OR e.student_id = ?)
        ORDER BY e.occurred_at DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("historyEvents"), () => db.prepare(`SELECT r.id, r.student_id, r.type, r.status, r.proposed_starts_at, r.message, r.created_at, r.resolved_at,
        student.display_name, resolver.display_name AS actor_name, l.starts_at AS lesson_starts_at
        FROM lesson_requests r
        JOIN members student ON student.id = r.student_id
        LEFT JOIN members resolver ON resolver.id = r.resolved_by_id
        LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.workspace_id = ? AND (? IS NULL OR r.student_id = ?)
        ORDER BY COALESCE(r.resolved_at, r.created_at) DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("historyEvents"), () => db.prepare(`SELECT b.id, b.student_id, b.kind, b.lesson_units, b.note, b.occurred_at, b.reverses_entry_id,
        EXISTS(SELECT 1 FROM balance_entries reversal WHERE reversal.reverses_entry_id = b.id) AS reversed,
        lesson.group_id AS lesson_group_id, student.display_name, actor.display_name AS actor_name
        FROM balance_entries b
        JOIN members student ON student.id = b.student_id
        LEFT JOIN lessons lesson ON lesson.id = b.lesson_id
        LEFT JOIN members actor ON actor.id = b.recorded_by_id
        WHERE b.workspace_id = ? AND (? IS NULL OR b.student_id = ?)
        ORDER BY b.occurred_at DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("availability") && availabilityAccess, () => db.prepare("SELECT id, weekday, start_minutes, end_minutes FROM availability_windows WHERE workspace_id = ? ORDER BY weekday, start_minutes").bind(auth.workspaceId).all()),
      loadRows(needs("availability") && auth.role === "student" && availabilityAccess, () => db.prepare("SELECT starts_at, ends_at FROM lessons WHERE workspace_id = ? AND status = 'scheduled' AND ends_at > ? AND starts_at < ? ORDER BY starts_at").bind(auth.workspaceId, Date.now(), availabilityHorizon).all()),
    ]);

    const seriesByStudent = new Map<string, Array<{ weekday: number; start: number }>>();
    for (const row of seriesRows.results as Array<Record<string, unknown>>) {
      const id = String(row.student_id);
      seriesByStudent.set(id, [...(seriesByStudent.get(id) ?? []), { weekday: Number(row.weekday), start: Number(row.start_minutes) }]);
    }
    const weekdays = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const recurringSlots = (seriesRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), studentId: String(row.student_id),
      label: `${weekdays[Number(row.weekday)]} ${minutesToTime(Number(row.start_minutes))}`,
      durationMinutes: Number(row.duration_minutes),
    }));
    const students = (studentRows.results as Array<Record<string, unknown>>).map((row) => {
      const floating = row.schedule_type === "floating";
      const series = seriesByStudent.get(String(row.id)) ?? [];
      const schedule = floating ? "Плавающее" : series.length ? series.map(({ weekday, start }) => `${weekdays[weekday]} ${minutesToTime(start)}`).join(", ") : "Постоянное расписание не задано";
      return {
        id: String(row.id), name: String(row.display_name), email: row.email ? String(row.email) : undefined, initials: initials(String(row.display_name)),
        schedule, next: row.next_lesson ? `${dateLabel.format(new Date(Number(row.next_lesson)))}, ${timeLabel.format(new Date(Number(row.next_lesson)))}` : "Не назначен",
        balance: Number(row.balance), floating, canViewAvailability: Boolean(row.can_view_availability), accountStatus: row.status === "active" ? "active" : "invited",
      };
    });
    const remainingByStudent = new Map<string, number>();
    const lessonParts = (lessonRows.results as Array<Record<string, unknown>>).map((row) => {
      const studentId = String(row.student_id);
      const balance = Number(row.balance);
      const remaining = remainingByStudent.get(studentId) ?? Math.max(0, balance);
      const requestType = row.request_type ? String(row.request_type) : null;
      const past = row.lesson_status === "completed";
      const trial = row.lesson_type === "trial";
      const covered = trial || remaining > 0;
      if (!past && !trial && requestType !== "cancel") remainingByStudent.set(studentId, Math.max(0, remaining - 1));
      const status = trial ? "trial" : past ? "paid" : requestType ? "request" : balance < 0 ? "debt" : covered ? "paid" : "low";
      const label = trial ? (past ? "Пробное · проведено" : "Пробное · бесплатно") : past ? "Проведён" : status === "request" ? "Ожидает ответа" : balance < 0 ? `Баланс ${balance}` : covered ? "Оплачен" : "Не оплачен";
      const start = new Date(Number(row.starts_at));
      return { id: String(row.id), groupId: row.group_id ? String(row.group_id) : undefined, studentId, date: toMoscowDate(start), time: timeLabel.format(start), end: timeLabel.format(new Date(Number(row.ends_at))), name: String(row.display_name), status, label, lessonType: trial ? "trial" : "regular", past, startsAt: Number(row.starts_at), units: 1 };
    });
    const lessons = groupLessonParts(lessonParts);
    const requests = (requestRows.results as Array<Record<string, unknown>>).map((row) => {
      const kind = String(row.type);
      const sourceDate = row.starts_at ? new Date(Number(row.starts_at)) : null;
      const proposedDate = row.proposed_starts_at ? new Date(Number(row.proposed_starts_at)) : null;
      const title = kind === "cancel" ? "Отмена · требует решения" : kind === "reschedule" ? "Перенос" : "Новое занятие";
      const doubleLesson = kind === "new_lesson" && row.proposed_starts_at && row.proposed_ends_at && Number(row.proposed_ends_at) - Number(row.proposed_starts_at) === 120 * 60_000;
      const detail = kind === "reschedule" && sourceDate && proposedDate
        ? `${dateLabel.format(sourceDate)}, ${timeLabel.format(sourceDate)} → ${dateLabel.format(proposedDate)}, ${timeLabel.format(proposedDate)}`
        : proposedDate ? `${dateLabel.format(proposedDate)} · ${timeLabel.format(proposedDate)}${doubleLesson ? " · двойной урок, 2 часа" : ""}` : sourceDate ? `${dateLabel.format(sourceDate)}, ${timeLabel.format(sourceDate)}` : "Время не выбрано";
      return { id: String(row.id), type: title, kind, name: String(row.display_name), detail, note: String(row.message ?? "Без комментария") };
    });
    const balanceEntries = (balanceRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), studentId: String(row.student_id), kind: String(row.kind), units: Number(row.lesson_units),
      note: String(row.note ?? (row.kind === "payment" ? "Оплата занятий" : "Урок проведён")), date: toMoscowDate(new Date(Number(row.occurred_at))), reversed: Boolean(row.reversed),
    }));
    const lessonHistory = groupDoubleLessonEvents(lessonEventRows.results as Array<Record<string, unknown>>).map((row) => {
      const eventType = String(row.event_type);
      const titles: Record<string, string> = { scheduled: "Урок назначен", rescheduled: "Урок перенесён", cancelled: "Урок отменён", completed: "Урок проведён", series_stopped: "Постоянное расписание остановлено" };
      const doubleLesson = Number(row.lesson_units) === 2;
      const current = row.starts_at ? formatHistoryLesson(Number(row.starts_at), row.ends_at ? Number(row.ends_at) : null) : "";
      const previous = row.previous_starts_at ? historyMomentLabel.format(new Date(Number(row.previous_starts_at))) : "";
      const detail = eventType === "rescheduled" && previous ? `${previous} → ${current}` : [current, row.note ? String(row.note) : ""].filter(Boolean).join(" · ");
      const title = row.lesson_type === "trial" ? `Пробное занятие ${eventType === "completed" ? "проведено" : eventType === "cancelled" ? "отменено" : eventType === "rescheduled" ? "перенесено" : "назначено"}` : titles[eventType] ?? "Изменение урока";
      return { id: `lesson:${row.id}`, studentId: String(row.student_id), studentName: String(row.display_name), category: "lesson", type: eventType, title: doubleLesson ? `Двойной ${title.toLocaleLowerCase("ru-RU")}` : title, detail, actor: row.actor_name ? String(row.actor_name) : eventType === "completed" ? "Автоматически" : undefined, occurredAt: Number(row.occurred_at) };
    });
    const requestTypeNames: Record<string, string> = { cancel: "отмену", reschedule: "перенос", new_lesson: "новый урок" };
    const requestStatusNames: Record<string, string> = { pending: "ожидает решения", approved: "подтверждён", declined: "отклонён", expired: "истёк" };
    const requestHistory = (historyRequestRows.results as Array<Record<string, unknown>>).map((row) => {
      const requestType = String(row.type);
      const status = String(row.status);
      const target = row.proposed_starts_at ?? row.lesson_starts_at;
      const detail = [target ? historyMomentLabel.format(new Date(Number(target))) : "", row.message ? String(row.message) : ""].filter(Boolean).join(" · ");
      return { id: `request:${row.id}`, studentId: String(row.student_id), studentName: String(row.display_name), category: "request", type: status, title: `Запрос на ${requestTypeNames[requestType] ?? "изменение"} ${requestStatusNames[status] ?? status}`, detail, actor: status === "pending" ? String(row.display_name) : row.actor_name ? String(row.actor_name) : undefined, occurredAt: Number(row.resolved_at ?? row.created_at) };
    });
    const balanceHistory = groupDoubleLessonCharges(historyBalanceRows.results as Array<Record<string, unknown>>).map((row) => {
      const kind = String(row.kind);
      const units = Number(row.lesson_units);
      const titles: Record<string, string> = { payment: "Оплата учтена", lesson_charge: "Списание за урок", adjustment: "Корректировка баланса", refund: "Отмена оплаты" };
      const reversed = Boolean(row.reversed);
      const title = row.double_lesson ? "Списание за двойной урок" : titles[kind] ?? "Операция баланса";
      return { id: `balance:${row.id}`, sourceId: String(row.id), studentId: String(row.student_id), studentName: String(row.display_name), category: "payment", type: kind, title: `${title}${reversed ? " · отменена" : ""}`, detail: [units > 0 ? `+${units} занятий` : `${units} занятий`, row.note ? String(row.note) : ""].filter(Boolean).join(" · "), actor: kind === "lesson_charge" ? "Автоматически" : row.actor_name ? String(row.actor_name) : undefined, units, canReverse: kind === "payment" && !reversed, occurredAt: Number(row.occurred_at) };
    });
    const historyEvents = [...lessonHistory, ...requestHistory, ...balanceHistory].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 500);
    const availabilityWindows = (availabilityRows.results as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), weekday: Number(row.weekday), startMinutes: Number(row.start_minutes), endMinutes: Number(row.end_minutes) }));
    const availableSlots = auth.role === "student" && availabilityAccess
      ? buildAvailableSlots(availabilityWindows, (availabilityBusyRows.results as Array<Record<string, unknown>>).map((row) => ({ start: Number(row.starts_at), end: Number(row.ends_at) })), Date.now())
      : [];
    const notifications = (notificationRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), type: String(row.type), title: String(row.title), body: String(row.body), read: Boolean(row.read_at), createdAt: Number(row.created_at),
      studentName: row.student_name ? String(row.student_name) : undefined,
      requestType: row.request_type ? String(row.request_type) : undefined,
      requestStatus: row.request_status ? String(row.request_status) : undefined,
      requestMessage: row.request_message ? String(row.request_message) : undefined,
      lessonStartsAt: row.lesson_starts_at ? Number(row.lesson_starts_at) : undefined,
      lessonEndsAt: row.lesson_ends_at ? Number(row.lesson_ends_at) : undefined,
      proposedStartsAt: row.proposed_starts_at ? Number(row.proposed_starts_at) : undefined,
      proposedEndsAt: row.proposed_ends_at ? Number(row.proposed_ends_at) : undefined,
      lessonUnits: row.lesson_units === null || row.lesson_units === undefined ? undefined : Number(row.lesson_units),
    }));
    const payload: Record<string, unknown> = { syncCursor };
    if (needs("students")) payload.students = students;
    if (needs("lessons")) { payload.lessons = lessons; payload.recurringSlots = recurringSlots; }
    if (needs("requests")) payload.requests = requests;
    if (needs("balanceEntries")) payload.balanceEntries = balanceEntries;
    if (needs("historyEvents")) payload.historyEvents = historyEvents;
    if (needs("notifications")) payload.notifications = notifications;
    if (needs("availability")) {
      if (auth.role === "student") payload.availableSlots = availableSlots;
      else payload.availabilityWindows = availabilityWindows;
    }
    if (needs("profile")) {
      payload.currentStudentId = ownStudentId;
      payload.teacherName = teacherRow?.display_name ?? "Преподаватель";
      payload.teacherTitle = teacherRow?.professional_title ?? "Репетитор";
      payload.profile = viewerRow ? { name: viewerRow.display_name, professionalTitle: viewerRow.professional_title, email: viewerRow.email } : undefined;
    }
    return Response.json(payload);
  } catch (error) {
    console.error("Failed to load app data", error);
    return Response.json({ error: "Не удалось загрузить данные" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const json = await readLimitedJson<unknown>(request);
    if (!json.ok) return json.response;
    const parsed = actionBodySchema.safeParse(json.value);
    if (!parsed.success) return invalid();
    const body: ActionBody = parsed.data;
    const auth = await requireMember(request);
    if (auth instanceof Response) return auth;
    if (auth.role === "student" && body.action === "submitStudentRequest") {
      const limited = await enforceRateLimit(env.STUDENT_REQUEST_RATE_LIMITER, `${auth.workspaceId}:${auth.memberId}`, "student_request");
      if (limited) return limited;
    }
    if (!["submitStudentRequest", "markNotificationsRead"].includes(body.action) && !["owner", "teacher"].includes(auth.role)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    const db = getD1();
    const id = crypto.randomUUID();

    if (body.action === "updateProfile") {
      const name = body.name?.trim();
      const professionalTitle = body.professionalTitle.trim();
      if (!name || name.length < 2 || name.length > 80) return invalid();
      const statements = [
        db.prepare("UPDATE members SET display_name = ?, professional_title = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(name, professionalTitle, Date.now(), auth.memberId, auth.workspaceId),
        db.prepare("UPDATE users SET full_name = ?, updated_at = ? WHERE id = (SELECT user_id FROM members WHERE id = ?)").bind(name, Date.now(), auth.memberId),
      ];
      if (auth.role === "owner") statements.push(db.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").bind(`Кабинет: ${name}`, Date.now(), auth.workspaceId));
      await db.batch(statements);
    } else if (body.action === "replaceAvailability") {
      const windows = body.windows.map((window) => normalizeAvailabilityWindow(window.weekday, window.start, window.end));
      if (windows.some((window) => !window)) return invalid();
      const statements = [db.prepare("DELETE FROM availability_windows WHERE workspace_id = ?").bind(auth.workspaceId)];
      for (const window of windows) statements.push(db.prepare("INSERT INTO availability_windows (id, workspace_id, weekday, start_minutes, end_minutes) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), auth.workspaceId, window!.weekday, window!.startMinutes, window!.endMinutes));
      await db.batch(statements);
    } else if (body.action === "createLesson") {
      const count = body.lessonCount ?? 1;
      const lessonType = body.lessonType ?? "regular";
      if (lessonType === "trial" && (count !== 1 || body.repeat === "weekly")) return Response.json({ error: "Пробное занятие может быть только разовым и длиться один час" }, { status: 400 });
      const range = lessonRange(body.date, body.time, lessonType === "trial" ? 60 : count === 2 ? 120 : body.durationMinutes);
      if (!body.studentId || !range || range.start <= Date.now() || ![undefined, "once", "weekly"].includes(body.repeat)) return invalid();
      if (count === 2 && toMoscowDate(new Date(range.end - 1)) !== body.date) return Response.json({ error: "Двойной урок должен завершиться в тот же день" }, { status: 400 });
      const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'").bind(body.studentId, auth.workspaceId).first<{ id: string }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      if (await hasConflict(db, auth.workspaceId, range.start, range.end)) return conflict();
      const seriesId = body.repeat === "weekly" ? crypto.randomUUID() : null;
      const groupId = count === 2 ? crypto.randomUUID() : null;
      const lessonIds = [id, ...(count === 2 ? [crypto.randomUUID()] : [])];
      const lessonRanges = count === 2
        ? [lessonRange(body.date, body.time, 60)!, { start: range.start + 60 * 60_000, end: range.end, duration: 60 }]
        : [range];
      const statements = [];
      if (body.repeat === "weekly") {
        const weekday = new Date(`${body.date}T12:00:00Z`).getUTCDay() || 7;
        const [hours, minutes] = body.time.split(":").map(Number);
        statements.push(db.prepare(`INSERT INTO lesson_series (id, workspace_id, student_id, weekday, start_minutes, duration_minutes, active_from)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(seriesId, auth.workspaceId, student.id, weekday, hours * 60 + minutes, range.duration, body.date));
        statements.push(db.prepare("UPDATE members SET schedule_type = 'fixed', updated_at = ? WHERE id = ? AND workspace_id = ?").bind(Date.now(), student.id, auth.workspaceId));
      }
      lessonRanges.forEach((lessonRange, index) => {
        const lessonId = lessonIds[index];
        statements.push(db.prepare(`INSERT INTO lessons (id, workspace_id, student_id, series_id, group_id, lesson_type, starts_at, ends_at, created_by_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(lessonId, auth.workspaceId, student.id, seriesId, groupId, lessonType, lessonRange.start, lessonRange.end, auth.memberId));
        statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: student.id, lessonId, actorMemberId: auth.memberId, sourceKey: `lesson-created:${lessonId}`, eventType: "scheduled", startsAt: lessonRange.start, endsAt: lessonRange.end, note: lessonType === "trial" ? "Пробное занятие · бесплатно" : count === 2 ? `Двойной урок · часть ${index + 1} из 2` : body.repeat === "weekly" ? "Создано постоянное расписание" : null }));
      });
      statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_created', ?, ?)")
        .bind(crypto.randomUUID(), student.id, student.id, id, lessonType === "trial" ? "Назначено пробное занятие" : "Назначен урок", lessonType === "trial" ? `Пробное занятие назначено на ${body.date} в ${body.time}. Оно бесплатное.` : `${count === 2 ? "Двойной урок" : "Урок"} назначен на ${body.date} в ${body.time}.`));
      await db.batch(statements);
    } else if (body.action === "updateLesson") {
      if (!body.lessonId) return invalid();
      const lessonGroup = await getScheduledLessonGroup(db, auth.workspaceId, body.lessonId);
      if (!lessonGroup.length) return Response.json({ error: "Урок не найден" }, { status: 404 });
      const totalDuration = lessonGroup.reduce((sum, lesson) => sum + Math.round((lesson.ends_at - lesson.starts_at) / 60_000), 0);
      const range = lessonRange(body.date, body.time, lessonGroup.length > 1 ? totalDuration : body.durationMinutes ?? totalDuration);
      if (!range || range.start <= Date.now()) return invalid();
      if (lessonGroup.length > 1 && toMoscowDate(new Date(range.end - 1)) !== body.date) return Response.json({ error: "Двойной урок должен завершиться в тот же день" }, { status: 400 });
      if (await hasConflict(db, auth.workspaceId, range.start, range.end, lessonGroup.map((lesson) => lesson.id))) return conflict();
      const now = Date.now();
      const statements: ReturnType<typeof db.prepare>[] = [];
      const movedIds: string[] = [];
      let offset = 0;
      for (const lesson of lessonGroup) {
        const durationMinutes = Math.round((lesson.ends_at - lesson.starts_at) / 60_000);
        const movedStart = range.start + offset * 60_000;
        const movedEnd = movedStart + durationMinutes * 60_000;
        const movedLessonId = lesson.series_id ? crypto.randomUUID() : lesson.id;
        movedIds.push(movedLessonId);
        if (lesson.series_id) {
          statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(now, now, lesson.id, auth.workspaceId));
          statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, group_id, lesson_type, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(movedLessonId, auth.workspaceId, lesson.student_id, lesson.group_id, lesson.lesson_type, movedStart, movedEnd, auth.memberId));
        } else {
          statements.push(db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(movedStart, movedEnd, now, lesson.id, auth.workspaceId));
        }
        statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: lesson.student_id, lessonId: movedLessonId, actorMemberId: auth.memberId, eventType: "rescheduled", previousStartsAt: lesson.starts_at, startsAt: movedStart, endsAt: movedEnd, occurredAt: now, note: lessonGroup.length > 1 ? "Перенесён двойной урок" : null }));
        offset += durationMinutes;
      }
      statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_rescheduled', 'Урок перенесён', ?)").bind(crypto.randomUUID(), lessonGroup[0].student_id, lessonGroup[0].student_id, movedIds[0], `Новое время: ${body.date}, ${body.time}.${lessonGroup.length > 1 ? " Перенесены оба занятия." : ""}`));
      await db.batch(statements);
    } else if (body.action === "deleteLesson") {
      if (!body.lessonId) return invalid();
      const lessonGroup = await getScheduledLessonGroup(db, auth.workspaceId, body.lessonId);
      if (!lessonGroup.length) return Response.json({ error: "Урок не найден" }, { status: 404 });
      const now = Date.now();
      const lessonIds = lessonGroup.map((lesson) => lesson.id);
      const placeholders = lessonIds.map(() => "?").join(", ");
      const statements: ReturnType<typeof db.prepare>[] = [
        db.prepare(`UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE workspace_id = ? AND status = 'scheduled' AND id IN (${placeholders})`).bind(now, now, auth.workspaceId, ...lessonIds),
        db.prepare(`UPDATE lesson_requests SET status = 'approved', resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE lesson_id IN (${placeholders}) AND status = 'pending'`).bind(auth.memberId, now, now, ...lessonIds),
      ];
      for (const lesson of lessonGroup) statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: lesson.student_id, lessonId: lesson.id, actorMemberId: auth.memberId, sourceKey: `lesson-cancelled:${lesson.id}`, eventType: "cancelled", startsAt: lesson.starts_at, endsAt: lesson.ends_at, occurredAt: now, note: lessonGroup.length > 1 ? "Отменён двойной урок без списания" : null }));
      statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_cancelled', 'Урок отменён', ?)").bind(crypto.randomUUID(), lessonGroup[0].student_id, lessonGroup[0].student_id, lessonGroup[0].id, lessonGroup.length > 1 ? "Двойной урок отменён без списания двух занятий." : "Преподаватель отменил урок без списания."));
      await db.batch(statements);
    } else if (body.action === "stopLessonSeries") {
      if (!body.seriesId) return invalid();
      const series = await db.prepare("SELECT student_id FROM lesson_series WHERE id = ? AND workspace_id = ? AND is_active = 1").bind(body.seriesId, auth.workspaceId).first<{ student_id: string }>();
      if (!series) return Response.json({ error: "Постоянное занятие не найдено" }, { status: 404 });
      const now = Date.now();
      await db.batch([
        db.prepare("UPDATE lesson_series SET is_active = 0, active_until = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(toMoscowDate(new Date(now)), now, body.seriesId, auth.workspaceId),
        db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE series_id = ? AND workspace_id = ? AND status = 'scheduled' AND starts_at > ?").bind(now, now, body.seriesId, auth.workspaceId, now),
        db.prepare("UPDATE lesson_requests SET status = 'declined', resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE lesson_id IN (SELECT id FROM lessons WHERE series_id = ?) AND status = 'pending'").bind(auth.memberId, now, now, body.seriesId),
        lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: series.student_id, actorMemberId: auth.memberId, sourceKey: `series-stopped:${body.seriesId}`, eventType: "series_stopped", note: "Будущие уроки постоянного расписания отменены", occurredAt: now }),
        db.prepare("INSERT INTO notifications (id, member_id, student_id, type, title, body) VALUES (?, ?, ?, 'series_stopped', 'Постоянное занятие отменено', 'Будущие уроки этого времени удалены из расписания без списания.')").bind(crypto.randomUUID(), series.student_id, series.student_id),
      ]);
    } else if (body.action === "createStudent") {
      if (!body.name?.trim() || body.name.trim().length > 80 || (body.email && !/^\S+@\S+\.\S+$/.test(body.email.trim()))) return invalid();
      const email = body.email?.trim() || null;
      const statements = [db.prepare(`INSERT INTO members (id, workspace_id, role, status, display_name, email, schedule_type)
        VALUES (?, ?, 'student', 'invited', ?, ?, ?)`).bind(id, auth.workspaceId, body.name.trim(), email, body.floating ? "floating" : "fixed")];
      if (!body.floating) {
        const weekday = Number(body.weekday);
        const time = body.time ?? "";
        const duration = body.durationMinutes ?? 60;
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return invalid();
        const activeFrom = nextOccurrenceDate(weekday, time);
        const firstRange = lessonRange(activeFrom, time, duration);
        if (!firstRange) return invalid();
        const [hours, minutes] = time.split(":").map(Number);
        const startMinutes = hours * 60 + minutes;
        const seriesConflict = await db.prepare(`SELECT id FROM lesson_series
          WHERE workspace_id = ? AND is_active = 1 AND weekday = ?
          AND start_minutes < ? AND start_minutes + duration_minutes > ? LIMIT 1`)
          .bind(auth.workspaceId, weekday, startMinutes + duration, startMinutes).first();
        if (seriesConflict || await hasConflict(db, auth.workspaceId, firstRange.start, firstRange.end)) return conflict();
        statements.push(db.prepare(`INSERT INTO lesson_series (id, workspace_id, student_id, weekday, start_minutes, duration_minutes, active_from)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), auth.workspaceId, id, weekday, startMinutes, duration, activeFrom));
      }
      let inviteUrl: string | undefined;
      if (email) {
        const inviteToken = randomToken();
        statements.push(db.prepare(`INSERT INTO invitations (id, workspace_id, member_id, token_hash, expires_at)
          VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), auth.workspaceId, id, await sha256(inviteToken), Date.now() + 1000 * 60 * 60 * 24 * 14));
        inviteUrl = new URL(`/invite/${inviteToken}`, request.url).toString();
      }
      await db.batch(statements);
      return Response.json({ ok: true, id, inviteUrl });
    } else if (body.action === "updateStudent") {
      const name = body.name?.trim();
      const email = body.email?.trim() || null;
      if (!body.studentId || !name || name.length > 80 || (email && !/^\S+@\S+\.\S+$/.test(email))) return invalid();
      const student = await db.prepare("SELECT id, status, email FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'").bind(body.studentId, auth.workspaceId).first<{ id: string; status: string; email: string | null }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      if (student.status === "active" && (student.email ?? "").toLowerCase() !== (email ?? "").toLowerCase()) return Response.json({ error: "Email подключённого аккаунта меняется через поддержку" }, { status: 409 });
      await db.prepare("UPDATE members SET display_name = ?, email = ?, can_view_availability = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
        .bind(name, email, body.canViewAvailability ? 1 : 0, Date.now(), student.id, auth.workspaceId).run();
    } else if (body.action === "createStudentInvite") {
      if (!body.studentId) return invalid();
      const student = await db.prepare("SELECT id, email, status FROM members WHERE id = ? AND workspace_id = ? AND role = 'student'").bind(body.studentId, auth.workspaceId).first<{ id: string; email: string | null; status: string }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      if (student.status === "active") return Response.json({ error: "Ученик уже подключил аккаунт" }, { status: 409 });
      if (!student.email) return Response.json({ error: "Сначала укажите email ученика" }, { status: 409 });
      const inviteToken = randomToken();
      await db.batch([
        db.prepare("UPDATE invitations SET expires_at = ? WHERE member_id = ? AND accepted_at IS NULL").bind(Date.now() - 1, student.id),
        db.prepare("INSERT INTO invitations (id, workspace_id, member_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)").bind(id, auth.workspaceId, student.id, await sha256(inviteToken), Date.now() + 1000 * 60 * 60 * 24 * 14),
      ]);
      return Response.json({ ok: true, inviteUrl: new URL(`/invite/${inviteToken}`, request.url).toString() });
    } else if (body.action === "addPayment") {
      if (!body.studentId || !Number.isInteger(body.count) || body.count <= 0 || body.count > 100 || (body.paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate))) return invalid();
      const occurredAt = body.paymentDate ? new Date(`${body.paymentDate}T12:00:00${MOSCOW_OFFSET}`).getTime() : Date.now();
      if (!Number.isFinite(occurredAt) || occurredAt > Date.now()) return Response.json({ error: "Дата оплаты не может быть в будущем" }, { status: 400 });
      const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student'").bind(body.studentId, auth.workspaceId).first();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      await db.batch([
        db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, note, occurred_at, recorded_by_id)
          VALUES (?, ?, ?, 'payment', ?, 'Оплата занятий', ?, ?)`).bind(id, auth.workspaceId, body.studentId, body.count, occurredAt, auth.memberId),
        db.prepare("INSERT INTO notifications (id, member_id, student_id, balance_entry_id, type, title, body) VALUES (?, ?, ?, ?, 'payment_recorded', 'Оплата учтена', ?)")
          .bind(crypto.randomUUID(), body.studentId, body.studentId, id, `Баланс пополнен на ${body.count} занятий.`),
      ]);
    } else if (body.action === "adjustBalance") {
      const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'").bind(body.studentId, auth.workspaceId).first();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      const occurredAt = Date.now();
      await db.batch([
        db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, note, occurred_at, recorded_by_id)
          VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)`).bind(id, auth.workspaceId, body.studentId, body.units, body.note.trim(), occurredAt, auth.memberId),
        db.prepare("INSERT INTO notifications (id, member_id, student_id, balance_entry_id, type, title, body) VALUES (?, ?, ?, ?, 'balance_adjusted', 'Баланс скорректирован', ?)")
          .bind(crypto.randomUUID(), body.studentId, body.studentId, id, `Изменение баланса: ${body.units > 0 ? "+" : ""}${body.units} занятий. ${body.note.trim()}`),
      ]);
    } else if (body.action === "reversePayment") {
      const payment = await db.prepare(`SELECT b.id, b.student_id, b.lesson_units
        FROM balance_entries b
        JOIN members student ON student.id = b.student_id
        WHERE b.id = ? AND b.workspace_id = ? AND b.kind = 'payment' AND b.lesson_units > 0
          AND student.workspace_id = ? AND student.role = 'student' LIMIT 1`)
        .bind(body.paymentId, auth.workspaceId, auth.workspaceId)
        .first<{ id: string; student_id: string; lesson_units: number }>();
      if (!payment) return Response.json({ error: "Оплата не найдена" }, { status: 404 });
      const existingReversal = await db.prepare("SELECT id FROM balance_entries WHERE reverses_entry_id = ? LIMIT 1").bind(payment.id).first();
      if (existingReversal) return Response.json({ error: "Эта оплата уже отменена" }, { status: 409 });
      await db.batch([
        db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, reverses_entry_id, note, occurred_at, recorded_by_id)
          VALUES (?, ?, ?, 'refund', ?, ?, 'Отмена ошибочной оплаты', ?, ?)`)
          .bind(id, auth.workspaceId, payment.student_id, -payment.lesson_units, payment.id, Date.now(), auth.memberId),
        db.prepare("INSERT INTO notifications (id, member_id, student_id, balance_entry_id, type, title, body) VALUES (?, ?, ?, ?, 'payment_reversed', 'Оплата отменена', ?)")
          .bind(crypto.randomUUID(), payment.student_id, payment.student_id, id, `Ошибочная оплата на ${payment.lesson_units} занятий отменена.`),
      ]);
    } else if (body.action === "resolveRequest") {
      if (!body.requestId || !["approved", "declined"].includes(body.decision)) return invalid();
      const row = await db.prepare(`SELECT r.type, r.student_id, r.lesson_id, r.proposed_starts_at, r.proposed_ends_at, l.series_id, l.starts_at, l.ends_at
        FROM lesson_requests r LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.id = ? AND r.workspace_id = ? AND r.status = 'pending'`).bind(body.requestId, auth.workspaceId).first<Record<string, unknown>>();
      if (!row) return Response.json({ error: "Запрос уже обработан" }, { status: 409 });
      const lessonGroup = row.lesson_id ? await getScheduledLessonGroup(db, auth.workspaceId, String(row.lesson_id)) : [];
      if (body.decision === "approved" && row.lesson_id && !lessonGroup.length) {
        const resolvedAt = Date.now();
        await db.batch([
          db.prepare("UPDATE lesson_requests SET status = 'expired', resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(auth.memberId, resolvedAt, resolvedAt, body.requestId),
          db.prepare("INSERT INTO notifications (id, member_id, student_id, request_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, ?, 'request_resolved', 'Запрос больше не актуален', 'Исходный урок уже был изменён или отменён.')").bind(crypto.randomUUID(), row.student_id, row.student_id, body.requestId, row.lesson_id),
        ]);
        return Response.json({ ok: true, id, expired: true });
      }
      if (body.decision === "approved" && row.proposed_starts_at && Number(row.proposed_starts_at) <= Date.now()) return Response.json({ error: "Предложенное время уже прошло" }, { status: 409 });
      if (body.decision === "approved" && row.proposed_starts_at && row.proposed_ends_at && await hasConflict(db, auth.workspaceId, Number(row.proposed_starts_at), Number(row.proposed_ends_at), lessonGroup.map((lesson) => lesson.id))) return conflict();
      const resolvedAt = Date.now();
      const statements = [db.prepare("UPDATE lesson_requests SET status = ?, resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.decision, auth.memberId, resolvedAt, resolvedAt, body.requestId), db.prepare("INSERT INTO notifications (id, member_id, student_id, request_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, ?, 'request_resolved', ?, ?)").bind(crypto.randomUUID(), row.student_id, row.student_id, body.requestId, row.lesson_id ?? null, body.decision === "approved" ? "Запрос подтверждён" : "Запрос отклонён", body.decision === "approved" ? "Изменение появилось в расписании" : "Расписание осталось без изменений")];
      if (body.decision === "approved" && lessonGroup.length) {
        const lessonIds = lessonGroup.map((lesson) => lesson.id);
        const siblingRequests = await db.prepare(`SELECT id FROM lesson_requests WHERE workspace_id = ? AND student_id = ? AND status = 'pending' AND id != ? AND lesson_id IN (${lessonIds.map(() => "?").join(", ")})`).bind(auth.workspaceId, row.student_id, body.requestId, ...lessonIds).all<{ id: string }>();
        for (const sibling of siblingRequests.results) {
          statements.push(db.prepare("UPDATE lesson_requests SET status = 'expired', resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(auth.memberId, resolvedAt, resolvedAt, sibling.id));
          statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, request_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, ?, 'request_resolved', 'Другой запрос по уроку закрыт', 'Расписание уже изменено по другому подтверждённому запросу.')").bind(crypto.randomUUID(), row.student_id, row.student_id, sibling.id, row.lesson_id));
        }
      }
      if (body.decision === "approved" && row.lesson_id && row.type === "cancel") {
        const ids = lessonGroup.map((lesson) => lesson.id);
        statements.push(db.prepare(`UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(resolvedAt, resolvedAt, ...ids));
        for (const lesson of lessonGroup) statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: String(row.student_id), lessonId: lesson.id, actorMemberId: auth.memberId, sourceKey: `lesson-cancelled:${lesson.id}`, eventType: "cancelled", startsAt: lesson.starts_at, endsAt: lesson.ends_at, occurredAt: resolvedAt, note: lessonGroup.length > 1 ? "Отменён двойной урок без списания" : null }));
      }
      if (body.decision === "approved" && row.lesson_id && row.type === "reschedule" && row.proposed_starts_at && row.proposed_ends_at) {
        let offset = 0;
        for (const lesson of lessonGroup) {
          const durationMinutes = Math.round((lesson.ends_at - lesson.starts_at) / 60_000);
          const movedStart = Number(row.proposed_starts_at) + offset * 60_000;
          const movedEnd = movedStart + durationMinutes * 60_000;
          const movedLessonId = lesson.series_id ? crypto.randomUUID() : lesson.id;
          if (lesson.series_id) {
            statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(resolvedAt, resolvedAt, lesson.id));
            statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, group_id, lesson_type, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(movedLessonId, auth.workspaceId, row.student_id, lesson.group_id, lesson.lesson_type, movedStart, movedEnd, auth.memberId));
          } else {
            statements.push(db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?").bind(movedStart, movedEnd, resolvedAt, lesson.id));
          }
          statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: String(row.student_id), lessonId: movedLessonId, actorMemberId: auth.memberId, eventType: "rescheduled", previousStartsAt: lesson.starts_at, startsAt: movedStart, endsAt: movedEnd, occurredAt: resolvedAt, note: lessonGroup.length > 1 ? "Перенесён двойной урок" : null }));
          offset += durationMinutes;
        }
      }
      if (body.decision === "approved" && row.type === "new_lesson" && row.student_id && row.proposed_starts_at && row.proposed_ends_at) {
        const requestedDuration = Number(row.proposed_ends_at) - Number(row.proposed_starts_at);
        if (![60, 120].includes(requestedDuration / 60_000)) return invalid();
        const requestedUnits = requestedDuration === 120 * 60_000 ? 2 : 1;
        const groupId = requestedUnits === 2 ? crypto.randomUUID() : null;
        for (let index = 0; index < requestedUnits; index += 1) {
          const lessonId = index === 0 ? id : crypto.randomUUID();
          const startsAt = Number(row.proposed_starts_at) + index * 60 * 60_000;
          const endsAt = startsAt + 60 * 60_000;
          statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, group_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(lessonId, auth.workspaceId, row.student_id, groupId, startsAt, endsAt, auth.memberId));
          statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: String(row.student_id), lessonId, actorMemberId: auth.memberId, sourceKey: `lesson-created:${lessonId}`, eventType: "scheduled", startsAt, endsAt, occurredAt: resolvedAt, note: requestedUnits === 2 ? `Двойной урок · часть ${index + 1} из 2` : null }));
        }
      }
      await db.batch(statements);
    } else if (body.action === "submitStudentRequest") {
      if (!(["cancel", "reschedule", "new_lesson"] as const).includes(body.requestType)) return invalid();
      const studentId = auth.role === "student" ? auth.memberId : (!getAuthConfig() ? body.studentId : null);
      if (!studentId) return Response.json({ error: "Запрос может создать только ученик" }, { status: 403 });
      const student = await db.prepare("SELECT id, schedule_type, can_view_availability FROM members WHERE id = ? AND workspace_id = ? AND role = 'student'").bind(studentId, auth.workspaceId).first<{ id: string; schedule_type: string; can_view_availability: number }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      let lesson: { id: string; starts_at: number; ends_at: number } | null = null;
      if (body.requestType !== "new_lesson") {
        if (!body.lessonId) return invalid();
        const lessonGroup = await getScheduledLessonGroup(db, auth.workspaceId, body.lessonId);
        if (!lessonGroup.length || lessonGroup[0].student_id !== studentId || lessonGroup[0].starts_at <= Date.now()) return Response.json({ error: "Можно изменить только будущий урок" }, { status: 409 });
        lesson = { id: lessonGroup[0].id, starts_at: lessonGroup[0].starts_at, ends_at: lessonGroup.at(-1)?.ends_at ?? lessonGroup[0].ends_at };
      } else if (student.schedule_type !== "floating" && !student.can_view_availability) return Response.json({ error: "Для выбора нового времени нужен доступ преподавателя" }, { status: 409 });
      const proposal = body.requestType === "cancel" ? null : lessonRange(body.proposedDate ?? "", body.proposedTime ?? "", lesson ? Math.round((lesson.ends_at - lesson.starts_at) / 60_000) : body.lessonCount === 2 ? 120 : 60);
      if (body.requestType !== "cancel" && (!proposal || proposal.start <= Date.now())) return invalid();
      if (body.requestType === "new_lesson" && body.lessonCount === 2 && proposal && toMoscowDate(new Date(proposal.end - 1)) !== body.proposedDate) return Response.json({ error: "Двойной урок должен завершиться в тот же день" }, { status: 400 });
      if (body.requestType === "new_lesson" && student.schedule_type !== "floating" && proposal) {
        const [windowRows, busyRows] = await Promise.all([
          db.prepare("SELECT weekday, start_minutes, end_minutes FROM availability_windows WHERE workspace_id = ?").bind(auth.workspaceId).all<Record<string, unknown>>(),
          db.prepare("SELECT starts_at, ends_at FROM lessons WHERE workspace_id = ? AND status = 'scheduled' AND ends_at > ? AND starts_at < ?").bind(auth.workspaceId, Date.now(), Date.now() + 16 * 24 * 60 * 60_000).all<Record<string, unknown>>(),
        ]);
        const allowedSlots = buildAvailableSlots(windowRows.results.map((row) => ({ weekday: Number(row.weekday), startMinutes: Number(row.start_minutes), endMinutes: Number(row.end_minutes) })), busyRows.results.map((row) => ({ start: Number(row.starts_at), end: Number(row.ends_at) })), Date.now());
        const selected = allowedSlots.find((slot) => slot.startsAt === proposal.start && slot.maxUnits >= (body.lessonCount === 2 ? 2 : 1));
        if (!selected) return Response.json({ error: "Этот свободный слот уже недоступен" }, { status: 409 });
      }
      let deadline: number | null = null;
      if (body.requestType === "cancel" && lesson) {
        const lessonDate = toMoscowDate(new Date(lesson.starts_at));
        deadline = new Date(`${lessonDate}T00:00:00${MOSCOW_OFFSET}`).getTime() - 1;
        if (Date.now() > deadline) return Response.json({ error: "Отмену можно запросить только до 23:59 предыдущего дня" }, { status: 409 });
      }
      const duplicate = lesson
        ? await db.prepare(`SELECT request.id FROM lesson_requests request LEFT JOIN lessons requested_lesson ON requested_lesson.id = request.lesson_id
          WHERE request.student_id = ? AND request.status = 'pending' AND request.lesson_id IS NOT NULL
          AND (request.lesson_id = ? OR (requested_lesson.group_id IS NOT NULL AND requested_lesson.group_id = (SELECT group_id FROM lessons WHERE id = ?))) LIMIT 1`).bind(studentId, lesson.id, lesson.id).first()
        : await db.prepare("SELECT id FROM lesson_requests WHERE student_id = ? AND status = 'pending' AND type = 'new_lesson' AND lesson_id IS NULL LIMIT 1").bind(studentId).first();
      if (duplicate) return Response.json({ error: lesson ? "По этому уроку уже есть запрос, ожидающий решения" : "Запрос на новый урок уже ожидает решения" }, { status: 409 });
      const owner = await db.prepare("SELECT id FROM members WHERE workspace_id = ? AND role = 'owner' AND status = 'active' LIMIT 1").bind(auth.workspaceId).first<{ id: string }>();
      if (!owner) return Response.json({ error: "Преподаватель не найден" }, { status: 409 });
      await db.batch([db.prepare(`INSERT INTO lesson_requests (id, workspace_id, student_id, lesson_id, type, proposed_starts_at, proposed_ends_at, message, cancellation_deadline_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, auth.workspaceId, studentId, lesson?.id ?? null, body.requestType, proposal?.start ?? null, proposal?.end ?? null, body.message?.trim() || null, deadline), db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, request_id, type, title, body) VALUES (?, ?, ?, ?, ?, 'new_request', 'Новый запрос ученика', ?)").bind(crypto.randomUUID(), owner.id, studentId, lesson?.id ?? null, id, `${body.requestType === "cancel" ? "Отмена" : body.requestType === "reschedule" ? "Перенос" : "Новое занятие"}: запрос требует ответа`)]);
    } else if (body.action === "markNotificationsRead") {
      await db.prepare("UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL").bind(Date.now(), auth.memberId).run();
    } else return invalid();

    return Response.json({ ok: true, id });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: lesson_requests.")) return Response.json({ error: "Такой запрос уже ожидает решения" }, { status: 409 });
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: balance_entries.reverses_entry_id")) return Response.json({ error: "Эта оплата уже отменена" }, { status: 409 });
    console.error("Failed to update app data", error);
    return Response.json({ error: "Не удалось сохранить изменения" }, { status: 500 });
  }
}

async function requireMember(request?: Request) {
  if (!getAuthConfig()) {
    if (isLocalDemoRequest(request)) return { role: "owner" as const, memberId: "1", workspaceId: "1", userId: "1", name: "Преподаватель", email: "" };
    return Response.json({ error: "Авторизация не настроена" }, { status: 503 });
  }
  if (!request) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const member = await getAuthMember(request);
  if (!member) return Response.json({ error: "Требуется вход" }, { status: 401 });
  return member;
}

function invalid() { return Response.json({ error: "Проверьте заполненные данные" }, { status: 400 }); }
function conflict() { return Response.json({ error: "На это время уже назначен другой урок" }, { status: 409 }); }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function minutesToTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function formatHistoryLesson(start: number, end: number | null) {
  const startLabel = historyMomentLabel.format(new Date(start));
  return end ? `${startLabel}–${timeLabel.format(new Date(end))}` : startLabel;
}
function lessonEventStatement(db: ReturnType<typeof getD1>, input: {
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
function toMoscowDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Moscow" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function lessonRange(date: string, time: string, durationMinutes = 60) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) return null;
  const start = new Date(`${date}T${time}:00${MOSCOW_OFFSET}`).getTime();
  if (!Number.isFinite(start)) return null;
  return { start, end: start + durationMinutes * 60_000, duration: durationMinutes };
}
type LessonPart = {
  id: string; groupId?: string; studentId: string; date: string; time: string; end: string; name: string;
  status: "paid" | "low" | "debt" | "request" | "trial"; label: string; lessonType: "regular" | "trial"; past: boolean; startsAt: number; units: number;
};
function groupLessonParts(parts: LessonPart[]) {
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
    const label = units === 1 ? first.label : past ? "Проведён · списано 2"
      : status === "request" ? "Двойной · ожидает ответа"
        : status === "debt" ? `Двойной · ${first.label}`
          : members.every((member) => member.status === "paid") ? "Двойной · оплачен" : "Двойной · частично оплачен";
    const { startsAt: _startsAt, ...lesson } = first;
    void _startsAt;
    return { ...lesson, id: actionable.id, end: last.end, status, label, past, units };
  }).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}
type ScheduledLessonRow = { id: string; student_id: string; series_id: string | null; group_id: string | null; lesson_type: "regular" | "trial"; starts_at: number; ends_at: number };
async function getScheduledLessonGroup(db: ReturnType<typeof getD1>, workspaceId: string, lessonId: string) {
  const lesson = await db.prepare("SELECT id, student_id, series_id, group_id, lesson_type, starts_at, ends_at FROM lessons WHERE id = ? AND workspace_id = ? AND status = 'scheduled'")
    .bind(lessonId, workspaceId).first<ScheduledLessonRow>();
  if (!lesson) return [];
  if (!lesson.group_id) return [lesson];
  const rows = await db.prepare("SELECT id, student_id, series_id, group_id, lesson_type, starts_at, ends_at FROM lessons WHERE group_id = ? AND workspace_id = ? AND status = 'scheduled' ORDER BY starts_at")
    .bind(lesson.group_id, workspaceId).all<ScheduledLessonRow>();
  return rows.results;
}
async function hasConflict(db: ReturnType<typeof getD1>, workspaceId: string, start: number, end: number, exceptIds: string[] = []) {
  const exclusion = exceptIds.length ? `AND id NOT IN (${exceptIds.map(() => "?").join(", ")})` : "";
  const row = await db.prepare(`SELECT id FROM lessons WHERE workspace_id = ? AND status = 'scheduled' ${exclusion} AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(workspaceId, ...exceptIds, end, start).first();
  return Boolean(row);
}
async function ensureSeriesLessons(db: ReturnType<typeof getD1>, workspaceId: string) {
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

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextOccurrenceDate(weekday: number, time: string) {
  const currentDate = toMoscowDate(new Date());
  const currentWeekday = new Date(`${currentDate}T12:00:00Z`).getUTCDay() || 7;
  let candidate = shiftIsoDate(currentDate, (weekday - currentWeekday + 7) % 7);
  const range = lessonRange(candidate, time);
  if (!range || range.start <= Date.now()) candidate = shiftIsoDate(candidate, 7);
  return candidate;
}
