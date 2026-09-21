import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, getAuthMember, randomToken, sha256 } from "@/lib/auth";
import { isLocalDemoRequest } from "@/lib/demo-mode";
import { settlePastLessons } from "@/lib/lesson-maintenance";
import { enforceRateLimit, readLimitedJson } from "@/lib/request-security";
import { env } from "cloudflare:workers";
import { z } from "zod";

const MOSCOW_OFFSET = "+03:00";

const id = z.string().min(1).max(128);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const duration = z.number().int().min(15).max(240).optional();
const email = z.union([z.literal(""), z.string().email().max(254)]).optional();
const actionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createLesson"), studentId: id, date, time, durationMinutes: duration, repeat: z.enum(["once", "weekly"]).optional() }).strict(),
  z.object({ action: z.literal("updateLesson"), lessonId: id, date, time, durationMinutes: duration }).strict(),
  z.object({ action: z.literal("deleteLesson"), lessonId: id }).strict(),
  z.object({ action: z.literal("stopLessonSeries"), seriesId: id }).strict(),
  z.object({ action: z.literal("createStudent"), name: z.string().trim().min(1).max(80), email, floating: z.boolean(), weekday: z.number().int().min(1).max(7).optional(), time: time.optional(), durationMinutes: duration }).strict(),
  z.object({ action: z.literal("updateStudent"), studentId: id, name: z.string().trim().min(1).max(80), email }).strict(),
  z.object({ action: z.literal("createStudentInvite"), studentId: id }).strict(),
  z.object({ action: z.literal("addPayment"), studentId: id, count: z.number().int().min(1).max(100), paymentDate: date.optional() }).strict(),
  z.object({ action: z.literal("resolveRequest"), requestId: id, decision: z.enum(["approved", "declined"]) }).strict(),
  z.object({ action: z.literal("submitStudentRequest"), requestType: z.enum(["cancel", "reschedule", "new_lesson"]), lessonId: id.optional(), proposedDate: date.optional(), proposedTime: time.optional(), message: z.string().trim().max(500).optional(), studentId: id.optional() }).strict(),
  z.object({ action: z.literal("updateProfile"), name: z.string().trim().min(2).max(80) }).strict(),
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
    const db = getD1();
    await ensureSeriesLessons(db, auth.workspaceId);
    await settlePastLessons(db, auth.workspaceId);
    const ownStudentId = auth.role === "student" ? auth.memberId : null;
    const [studentRows, seriesRows, lessonRows, requestRows, balanceRows, notificationRows, teacherRow, viewerRow, lessonEventRows, historyRequestRows, historyBalanceRows] = await Promise.all([
      db.prepare(`SELECT m.id, m.display_name, m.email, m.status, m.schedule_type,
        COALESCE((SELECT SUM(b.lesson_units) FROM balance_entries b WHERE b.student_id = m.id), 0) AS balance,
        (SELECT MIN(l.starts_at) FROM lessons l WHERE l.student_id = m.id AND l.status = 'scheduled' AND l.starts_at >= ?) AS next_lesson
        FROM members m
        WHERE m.workspace_id = ? AND m.role = 'student' AND m.status != 'archived' AND (? IS NULL OR m.id = ?)
        ORDER BY m.display_name`).bind(Date.now(), auth.workspaceId, ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT id, student_id, weekday, start_minutes, duration_minutes FROM lesson_series
        WHERE workspace_id = ? AND is_active = 1 AND (? IS NULL OR student_id = ?) ORDER BY weekday, start_minutes`).bind(auth.workspaceId, ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT l.id, l.student_id, l.starts_at, l.ends_at, m.display_name,
        COALESCE((SELECT SUM(be.lesson_units) FROM balance_entries be WHERE be.student_id = l.student_id), 0) AS balance,
        (SELECT r.type FROM lesson_requests r WHERE r.lesson_id = l.id AND r.status = 'pending' ORDER BY r.created_at LIMIT 1) AS request_type
        FROM lessons l JOIN members m ON m.id = l.student_id
        WHERE l.workspace_id = ? AND l.status = 'scheduled' AND l.ends_at > ? AND (? IS NULL OR l.student_id = ?)
        ORDER BY l.starts_at`).bind(auth.workspaceId, Date.now(), ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT r.id, r.type, r.message, r.proposed_starts_at, l.starts_at,
        m.display_name FROM lesson_requests r
        JOIN members m ON m.id = r.student_id
        LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.workspace_id = ? AND r.status = 'pending' AND (? IS NULL OR r.student_id = ?) ORDER BY r.created_at`).bind(auth.workspaceId, ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT id, student_id, kind, lesson_units, note, occurred_at FROM balance_entries
        WHERE workspace_id = ? AND (? IS NULL OR student_id = ?) ORDER BY occurred_at DESC, created_at DESC`).bind(auth.workspaceId, ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT id, type, title, body, read_at, created_at FROM notifications
        WHERE member_id = ? ORDER BY created_at DESC LIMIT 30`).bind(auth.memberId).all(),
      db.prepare(`SELECT display_name FROM members WHERE workspace_id = ? AND role IN ('owner', 'teacher') AND status = 'active'
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1`).bind(auth.workspaceId).first<{ display_name: string }>(),
      db.prepare(`SELECT m.display_name, COALESCE(m.email, u.email, '') AS email FROM members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = ? AND m.workspace_id = ? LIMIT 1`).bind(auth.memberId, auth.workspaceId).first<{ display_name: string; email: string }>(),
      db.prepare(`SELECT e.id, e.student_id, e.event_type, e.previous_starts_at, e.starts_at, e.ends_at, e.note, e.occurred_at,
        student.display_name, actor.display_name AS actor_name
        FROM lesson_events e
        JOIN members student ON student.id = e.student_id
        LEFT JOIN members actor ON actor.id = e.actor_member_id
        WHERE e.workspace_id = ? AND (? IS NULL OR e.student_id = ?)
        ORDER BY e.occurred_at DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT r.id, r.student_id, r.type, r.status, r.proposed_starts_at, r.message, r.created_at, r.resolved_at,
        student.display_name, resolver.display_name AS actor_name, l.starts_at AS lesson_starts_at
        FROM lesson_requests r
        JOIN members student ON student.id = r.student_id
        LEFT JOIN members resolver ON resolver.id = r.resolved_by_id
        LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.workspace_id = ? AND (? IS NULL OR r.student_id = ?)
        ORDER BY COALESCE(r.resolved_at, r.created_at) DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT b.id, b.student_id, b.kind, b.lesson_units, b.note, b.occurred_at,
        student.display_name, actor.display_name AS actor_name
        FROM balance_entries b
        JOIN members student ON student.id = b.student_id
        LEFT JOIN members actor ON actor.id = b.recorded_by_id
        WHERE b.workspace_id = ? AND (? IS NULL OR b.student_id = ?)
        ORDER BY b.occurred_at DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all(),
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
        balance: Number(row.balance), floating, accountStatus: row.status === "active" ? "active" : "invited",
      };
    });
    const remainingByStudent = new Map<string, number>();
    const lessons = (lessonRows.results as Array<Record<string, unknown>>).map((row) => {
      const studentId = String(row.student_id);
      const balance = Number(row.balance);
      const remaining = remainingByStudent.get(studentId) ?? Math.max(0, balance);
      const requestType = row.request_type ? String(row.request_type) : null;
      const covered = remaining > 0;
      if (requestType !== "cancel") remainingByStudent.set(studentId, Math.max(0, remaining - 1));
      const status = requestType ? "request" : balance < 0 ? "debt" : covered ? "paid" : "low";
      const label = status === "request" ? "Ожидает ответа" : balance < 0 ? `Баланс ${balance}` : covered ? "Оплачен" : "Не оплачен";
      const start = new Date(Number(row.starts_at));
      return { id: String(row.id), studentId, date: toMoscowDate(start), time: timeLabel.format(start), end: timeLabel.format(new Date(Number(row.ends_at))), name: String(row.display_name), status, label };
    });
    const requests = (requestRows.results as Array<Record<string, unknown>>).map((row) => {
      const kind = String(row.type);
      const sourceDate = row.starts_at ? new Date(Number(row.starts_at)) : null;
      const proposedDate = row.proposed_starts_at ? new Date(Number(row.proposed_starts_at)) : null;
      const title = kind === "cancel" ? "Отмена · требует решения" : kind === "reschedule" ? "Перенос" : "Новое занятие";
      const detail = kind === "reschedule" && sourceDate && proposedDate
        ? `${dateLabel.format(sourceDate)}, ${timeLabel.format(sourceDate)} → ${dateLabel.format(proposedDate)}, ${timeLabel.format(proposedDate)}`
        : proposedDate ? `${dateLabel.format(proposedDate)} · ${timeLabel.format(proposedDate)}` : sourceDate ? `${dateLabel.format(sourceDate)}, ${timeLabel.format(sourceDate)}` : "Время не выбрано";
      return { id: String(row.id), type: title, kind, name: String(row.display_name), detail, note: String(row.message ?? "Без комментария") };
    });
    const balanceEntries = (balanceRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), studentId: String(row.student_id), kind: String(row.kind), units: Number(row.lesson_units),
      note: String(row.note ?? (row.kind === "payment" ? "Оплата занятий" : "Урок проведён")), date: toMoscowDate(new Date(Number(row.occurred_at))),
    }));
    const lessonHistory = (lessonEventRows.results as Array<Record<string, unknown>>).map((row) => {
      const eventType = String(row.event_type);
      const titles: Record<string, string> = { scheduled: "Урок назначен", rescheduled: "Урок перенесён", cancelled: "Урок отменён", completed: "Урок проведён", series_stopped: "Постоянное расписание остановлено" };
      const current = row.starts_at ? formatHistoryLesson(Number(row.starts_at), row.ends_at ? Number(row.ends_at) : null) : "";
      const previous = row.previous_starts_at ? historyMomentLabel.format(new Date(Number(row.previous_starts_at))) : "";
      const detail = eventType === "rescheduled" && previous ? `${previous} → ${current}` : [current, row.note ? String(row.note) : ""].filter(Boolean).join(" · ");
      return { id: `lesson:${row.id}`, studentId: String(row.student_id), studentName: String(row.display_name), category: "lesson", type: eventType, title: titles[eventType] ?? "Изменение урока", detail, actor: row.actor_name ? String(row.actor_name) : eventType === "completed" ? "Автоматически" : undefined, occurredAt: Number(row.occurred_at) };
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
    const balanceHistory = (historyBalanceRows.results as Array<Record<string, unknown>>).map((row) => {
      const kind = String(row.kind);
      const units = Number(row.lesson_units);
      const titles: Record<string, string> = { payment: "Оплата учтена", lesson_charge: "Списание за урок", adjustment: "Корректировка баланса", refund: "Возврат" };
      return { id: `balance:${row.id}`, studentId: String(row.student_id), studentName: String(row.display_name), category: "payment", type: kind, title: titles[kind] ?? "Операция баланса", detail: [units > 0 ? `+${units} занятий` : `${units} занятий`, row.note ? String(row.note) : ""].filter(Boolean).join(" · "), actor: kind === "lesson_charge" ? "Автоматически" : row.actor_name ? String(row.actor_name) : undefined, units, occurredAt: Number(row.occurred_at) };
    });
    const historyEvents = [...lessonHistory, ...requestHistory, ...balanceHistory].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 500);
    const notifications = (notificationRows.results as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), type: String(row.type), title: String(row.title), body: String(row.body), read: Boolean(row.read_at), createdAt: Number(row.created_at) }));
    return Response.json({ students, lessons, recurringSlots, requests, balanceEntries, historyEvents, notifications, currentStudentId: ownStudentId, teacherName: teacherRow?.display_name ?? "Преподаватель", profile: viewerRow ? { name: viewerRow.display_name, email: viewerRow.email } : undefined });
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
      if (!name || name.length < 2 || name.length > 80) return invalid();
      const statements = [
        db.prepare("UPDATE members SET display_name = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(name, Date.now(), auth.memberId, auth.workspaceId),
        db.prepare("UPDATE users SET full_name = ?, updated_at = ? WHERE id = (SELECT user_id FROM members WHERE id = ?)").bind(name, Date.now(), auth.memberId),
      ];
      if (auth.role === "owner") statements.push(db.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").bind(`Кабинет: ${name}`, Date.now(), auth.workspaceId));
      await db.batch(statements);
    } else if (body.action === "createLesson") {
      const range = lessonRange(body.date, body.time, body.durationMinutes);
      if (!body.studentId || !range || range.start <= Date.now() || ![undefined, "once", "weekly"].includes(body.repeat)) return invalid();
      const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'").bind(body.studentId, auth.workspaceId).first<{ id: string }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      if (await hasConflict(db, auth.workspaceId, range.start, range.end)) return conflict();
      const seriesId = body.repeat === "weekly" ? crypto.randomUUID() : null;
      const statements = [];
      if (body.repeat === "weekly") {
        const weekday = new Date(`${body.date}T12:00:00Z`).getUTCDay() || 7;
        const [hours, minutes] = body.time.split(":").map(Number);
        statements.push(db.prepare(`INSERT INTO lesson_series (id, workspace_id, student_id, weekday, start_minutes, duration_minutes, active_from)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(seriesId, auth.workspaceId, student.id, weekday, hours * 60 + minutes, range.duration, body.date));
        statements.push(db.prepare("UPDATE members SET schedule_type = 'fixed', updated_at = ? WHERE id = ? AND workspace_id = ?").bind(Date.now(), student.id, auth.workspaceId));
      }
      statements.push(db.prepare(`INSERT INTO lessons (id, workspace_id, student_id, series_id, starts_at, ends_at, created_by_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, auth.workspaceId, student.id, seriesId, range.start, range.end, auth.memberId));
      statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: student.id, lessonId: id, actorMemberId: auth.memberId, sourceKey: `lesson-created:${id}`, eventType: "scheduled", startsAt: range.start, endsAt: range.end, note: body.repeat === "weekly" ? "Создано постоянное расписание" : null }));
      statements.push(db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'lesson_created', 'Назначен урок', ?)")
        .bind(crypto.randomUUID(), student.id, `Урок назначен на ${body.date} в ${body.time}.`));
      await db.batch(statements);
    } else if (body.action === "updateLesson") {
      const range = lessonRange(body.date, body.time, body.durationMinutes);
      if (!body.lessonId || !range || range.start <= Date.now()) return invalid();
      const lesson = await db.prepare("SELECT id, student_id, series_id, starts_at, ends_at FROM lessons WHERE id = ? AND workspace_id = ? AND status = 'scheduled'").bind(body.lessonId, auth.workspaceId).first<{ id: string; student_id: string; series_id: string | null; starts_at: number; ends_at: number }>();
      if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
      if (await hasConflict(db, auth.workspaceId, range.start, range.end, body.lessonId)) return conflict();
      if (lesson.series_id) {
        const now = Date.now();
        const movedLessonId = crypto.randomUUID();
        await db.batch([
          db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(now, now, body.lessonId, auth.workspaceId),
          db.prepare("INSERT INTO lessons (id, workspace_id, student_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?)").bind(movedLessonId, auth.workspaceId, lesson.student_id, range.start, range.end, auth.memberId),
          lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: lesson.student_id, lessonId: movedLessonId, actorMemberId: auth.memberId, eventType: "rescheduled", previousStartsAt: lesson.starts_at, startsAt: range.start, endsAt: range.end, occurredAt: now }),
          db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'lesson_rescheduled', 'Урок перенесён', ?)").bind(crypto.randomUUID(), lesson.student_id, `Новое время: ${body.date}, ${body.time}.`),
        ]);
      } else {
        const now = Date.now();
        await db.batch([
          db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(range.start, range.end, now, body.lessonId, auth.workspaceId),
          lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: lesson.student_id, lessonId: lesson.id, actorMemberId: auth.memberId, eventType: "rescheduled", previousStartsAt: lesson.starts_at, startsAt: range.start, endsAt: range.end, occurredAt: now }),
          db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'lesson_rescheduled', 'Урок перенесён', ?)").bind(crypto.randomUUID(), lesson.student_id, `Новое время: ${body.date}, ${body.time}.`),
        ]);
      }
    } else if (body.action === "deleteLesson") {
      if (!body.lessonId) return invalid();
      const lesson = await db.prepare("SELECT student_id, starts_at, ends_at FROM lessons WHERE id = ? AND workspace_id = ? AND status = 'scheduled'").bind(body.lessonId, auth.workspaceId).first<{ student_id: string; starts_at: number; ends_at: number }>();
      if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
      const now = Date.now();
      await db.batch([
        db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'scheduled'").bind(now, now, body.lessonId, auth.workspaceId),
        db.prepare("UPDATE lesson_requests SET status = 'approved', resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE lesson_id = ? AND status = 'pending'").bind(auth.memberId, now, now, body.lessonId),
        lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: lesson.student_id, lessonId: body.lessonId, actorMemberId: auth.memberId, sourceKey: `lesson-cancelled:${body.lessonId}`, eventType: "cancelled", startsAt: lesson.starts_at, endsAt: lesson.ends_at, occurredAt: now }),
        db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'lesson_cancelled', 'Урок отменён', 'Преподаватель отменил урок без списания.')").bind(crypto.randomUUID(), lesson.student_id),
      ]);
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
        db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'series_stopped', 'Постоянное занятие отменено', 'Будущие уроки этого времени удалены из расписания без списания.')").bind(crypto.randomUUID(), series.student_id),
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
      await db.prepare("UPDATE members SET display_name = ?, email = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
        .bind(name, email, Date.now(), student.id, auth.workspaceId).run();
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
      await db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, note, occurred_at, recorded_by_id)
        VALUES (?, ?, ?, 'payment', ?, 'Оплата занятий', ?, ?)`).bind(id, auth.workspaceId, body.studentId, body.count, occurredAt, auth.memberId).run();
      await db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'payment_recorded', 'Оплата учтена', ?)")
        .bind(crypto.randomUUID(), body.studentId, `Баланс пополнен на ${body.count} занятий.`).run();
    } else if (body.action === "resolveRequest") {
      if (!body.requestId || !["approved", "declined"].includes(body.decision)) return invalid();
      const row = await db.prepare(`SELECT r.type, r.student_id, r.lesson_id, r.proposed_starts_at, r.proposed_ends_at, l.series_id, l.starts_at, l.ends_at
        FROM lesson_requests r LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.id = ? AND r.workspace_id = ? AND r.status = 'pending'`).bind(body.requestId, auth.workspaceId).first<Record<string, unknown>>();
      if (!row) return Response.json({ error: "Запрос уже обработан" }, { status: 409 });
      if (body.decision === "approved" && row.proposed_starts_at && Number(row.proposed_starts_at) <= Date.now()) return Response.json({ error: "Предложенное время уже прошло" }, { status: 409 });
      if (body.decision === "approved" && row.proposed_starts_at && row.proposed_ends_at && await hasConflict(db, auth.workspaceId, Number(row.proposed_starts_at), Number(row.proposed_ends_at), String(row.lesson_id ?? ""))) return conflict();
      const resolvedAt = Date.now();
      const statements = [db.prepare("UPDATE lesson_requests SET status = ?, resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.decision, auth.memberId, resolvedAt, resolvedAt, body.requestId), db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'request_resolved', ?, ?)").bind(crypto.randomUUID(), row.student_id, body.decision === "approved" ? "Запрос подтверждён" : "Запрос отклонён", body.decision === "approved" ? "Изменение появилось в расписании" : "Расписание осталось без изменений")];
      if (body.decision === "approved" && row.lesson_id && row.type === "cancel") {
        statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(resolvedAt, resolvedAt, row.lesson_id));
        statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: String(row.student_id), lessonId: String(row.lesson_id), actorMemberId: auth.memberId, sourceKey: `lesson-cancelled:${String(row.lesson_id)}`, eventType: "cancelled", startsAt: Number(row.starts_at), endsAt: Number(row.ends_at), occurredAt: resolvedAt }));
      }
      if (body.decision === "approved" && row.lesson_id && row.type === "reschedule" && row.proposed_starts_at && row.proposed_ends_at) {
        const movedLessonId = row.series_id ? crypto.randomUUID() : String(row.lesson_id);
        if (row.series_id) {
          statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(resolvedAt, resolvedAt, row.lesson_id));
          statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?)").bind(movedLessonId, auth.workspaceId, row.student_id, row.proposed_starts_at, row.proposed_ends_at, auth.memberId));
        } else {
          statements.push(db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?").bind(row.proposed_starts_at, row.proposed_ends_at, resolvedAt, row.lesson_id));
        }
        statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: String(row.student_id), lessonId: movedLessonId, actorMemberId: auth.memberId, eventType: "rescheduled", previousStartsAt: Number(row.starts_at), startsAt: Number(row.proposed_starts_at), endsAt: Number(row.proposed_ends_at), occurredAt: resolvedAt }));
      }
      if (body.decision === "approved" && row.type === "new_lesson" && row.student_id && row.proposed_starts_at && row.proposed_ends_at) {
        statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?)").bind(id, auth.workspaceId, row.student_id, row.proposed_starts_at, row.proposed_ends_at, auth.memberId));
        statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: String(row.student_id), lessonId: id, actorMemberId: auth.memberId, sourceKey: `lesson-created:${id}`, eventType: "scheduled", startsAt: Number(row.proposed_starts_at), endsAt: Number(row.proposed_ends_at), occurredAt: resolvedAt }));
      }
      await db.batch(statements);
    } else if (body.action === "submitStudentRequest") {
      if (!(["cancel", "reschedule", "new_lesson"] as const).includes(body.requestType)) return invalid();
      const studentId = auth.role === "student" ? auth.memberId : (!getAuthConfig() ? body.studentId : null);
      if (!studentId) return Response.json({ error: "Запрос может создать только ученик" }, { status: 403 });
      const student = await db.prepare("SELECT id, schedule_type FROM members WHERE id = ? AND workspace_id = ? AND role = 'student'").bind(studentId, auth.workspaceId).first<{ id: string; schedule_type: string }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      let lesson: { id: string; starts_at: number; ends_at: number } | null = null;
      if (body.requestType !== "new_lesson") {
        if (!body.lessonId) return invalid();
        lesson = await db.prepare("SELECT id, starts_at, ends_at FROM lessons WHERE id = ? AND student_id = ? AND workspace_id = ? AND status = 'scheduled'").bind(body.lessonId, studentId, auth.workspaceId).first<{ id: string; starts_at: number; ends_at: number }>();
        if (!lesson || lesson.starts_at <= Date.now()) return Response.json({ error: "Можно изменить только будущий урок" }, { status: 409 });
      } else if (student.schedule_type !== "floating") return Response.json({ error: "Предлагать новый урок можно только при плавающем расписании" }, { status: 409 });
      const proposal = body.requestType === "cancel" ? null : lessonRange(body.proposedDate ?? "", body.proposedTime ?? "", lesson ? Math.round((lesson.ends_at - lesson.starts_at) / 60_000) : 60);
      if (body.requestType !== "cancel" && (!proposal || proposal.start <= Date.now())) return invalid();
      let deadline: number | null = null;
      if (body.requestType === "cancel" && lesson) {
        const lessonDate = toMoscowDate(new Date(lesson.starts_at));
        deadline = new Date(`${lessonDate}T00:00:00${MOSCOW_OFFSET}`).getTime() - 1;
        if (Date.now() > deadline) return Response.json({ error: "Отмену можно запросить только до 23:59 предыдущего дня" }, { status: 409 });
      }
      const duplicate = await db.prepare(`SELECT id FROM lesson_requests WHERE student_id = ? AND status = 'pending' AND type = ? AND COALESCE(lesson_id, '') = COALESCE(?, '') LIMIT 1`).bind(studentId, body.requestType, lesson?.id ?? null).first();
      if (duplicate) return Response.json({ error: "Такой запрос уже ожидает решения" }, { status: 409 });
      const owner = await db.prepare("SELECT id FROM members WHERE workspace_id = ? AND role = 'owner' AND status = 'active' LIMIT 1").bind(auth.workspaceId).first<{ id: string }>();
      if (!owner) return Response.json({ error: "Преподаватель не найден" }, { status: 409 });
      await db.batch([db.prepare(`INSERT INTO lesson_requests (id, workspace_id, student_id, lesson_id, type, proposed_starts_at, proposed_ends_at, message, cancellation_deadline_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, auth.workspaceId, studentId, lesson?.id ?? null, body.requestType, proposal?.start ?? null, proposal?.end ?? null, body.message?.trim() || null, deadline), db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'new_request', 'Новый запрос ученика', ?)").bind(crypto.randomUUID(), owner.id, `${body.requestType === "cancel" ? "Отмена" : body.requestType === "reschedule" ? "Перенос" : "Новое занятие"}: запрос требует ответа`)]);
    } else if (body.action === "markNotificationsRead") {
      await db.prepare("UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL").bind(Date.now(), auth.memberId).run();
    } else return invalid();

    return Response.json({ ok: true, id });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: lesson_requests.")) return Response.json({ error: "Такой запрос уже ожидает решения" }, { status: 409 });
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
async function hasConflict(db: ReturnType<typeof getD1>, workspaceId: string, start: number, end: number, exceptId = "") {
  const row = await db.prepare(`SELECT id FROM lessons WHERE workspace_id = ? AND status = 'scheduled' AND id != ? AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(workspaceId, exceptId, end, start).first();
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
  const existing = await db.prepare(`SELECT id, series_id, student_id, starts_at, ends_at, status FROM lessons
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
      const range = lessonRange(date, minutesToTime(Number(row.start_minutes)), Number(row.duration_minutes));
      if (!range) continue;
      const studentId = String(row.student_id);
      if (knownOccurrences.has(`${String(row.id)}:${range.start}`)) continue;
      if (occupied.some((lesson) => lesson.studentId === studentId && lesson.start === range.start) || occupied.some((lesson) => lesson.start < range.end && lesson.end > range.start)) continue;
      statements.push(db.prepare(`INSERT OR IGNORE INTO lessons (id, workspace_id, student_id, series_id, starts_at, ends_at, created_by_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), workspaceId, row.student_id, row.id, range.start, range.end, owner.id));
      occupied.push({ studentId, start: range.start, end: range.end });
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
