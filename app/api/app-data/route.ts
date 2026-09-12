import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, getAuthMember, randomToken, sha256 } from "@/lib/auth";

const WORKSPACE_ID = "1";
const TEACHER_ID = "1";
const MOSCOW_OFFSET = "+03:00";

type ActionBody =
  | { action: "createLesson"; student: string; date: string; time: string; durationMinutes?: number; repeat?: "once" | "weekly" }
  | { action: "updateLesson"; lessonId: string; date: string; time: string; durationMinutes?: number }
  | { action: "deleteLesson"; lessonId: string }
  | { action: "createStudent"; name: string; email?: string; floating: boolean }
  | { action: "addPayment"; studentId: string; count: number }
  | { action: "resolveRequest"; requestId: string; decision: "approved" | "declined" };

const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });
const timeLabel = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" });

export async function GET(request: Request) {
  try {
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const db = getD1();
    const [studentRows, seriesRows, lessonRows, requestRows] = await Promise.all([
      db.prepare(`SELECT m.id, m.display_name, m.schedule_type,
        COALESCE((SELECT SUM(b.lesson_units) FROM balance_entries b WHERE b.student_id = m.id), 0) AS balance,
        (SELECT MIN(l.starts_at) FROM lessons l WHERE l.student_id = m.id AND l.status = 'scheduled' AND l.starts_at >= ?) AS next_lesson
        FROM members m
        WHERE m.workspace_id = ? AND m.role = 'student' AND m.status != 'archived'
        ORDER BY m.display_name`).bind(Date.now(), WORKSPACE_ID).all(),
      db.prepare(`SELECT student_id, weekday, start_minutes FROM lesson_series
        WHERE workspace_id = ? AND is_active = 1 ORDER BY weekday, start_minutes`).bind(WORKSPACE_ID).all(),
      db.prepare(`SELECT l.id, l.starts_at, l.ends_at, m.display_name,
        COALESCE((SELECT SUM(be.lesson_units) FROM balance_entries be WHERE be.student_id = l.student_id), 0) AS balance,
        EXISTS(SELECT 1 FROM lesson_requests r WHERE r.lesson_id = l.id AND r.status = 'pending') AS has_request
        FROM lessons l JOIN members m ON m.id = l.student_id
        WHERE l.workspace_id = ? AND l.status = 'scheduled'
        ORDER BY l.starts_at`).bind(WORKSPACE_ID).all(),
      db.prepare(`SELECT r.id, r.type, r.message, r.proposed_starts_at, l.starts_at,
        m.display_name FROM lesson_requests r
        JOIN members m ON m.id = r.student_id
        LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.workspace_id = ? AND r.status = 'pending' ORDER BY r.created_at`).bind(WORKSPACE_ID).all(),
    ]);

    const seriesByStudent = new Map<string, Array<{ weekday: number; start: number }>>();
    for (const row of seriesRows.results as Array<Record<string, unknown>>) {
      const id = String(row.student_id);
      seriesByStudent.set(id, [...(seriesByStudent.get(id) ?? []), { weekday: Number(row.weekday), start: Number(row.start_minutes) }]);
    }
    const weekdays = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const students = (studentRows.results as Array<Record<string, unknown>>).map((row) => {
      const floating = row.schedule_type === "floating";
      const series = seriesByStudent.get(String(row.id)) ?? [];
      const schedule = floating ? "Плавающее" : series.map(({ weekday }) => weekdays[weekday]).join(", ") + (series[0] ? ` · ${minutesToTime(series[0].start)}` : "");
      return {
        id: String(row.id), name: String(row.display_name), initials: initials(String(row.display_name)),
        schedule, next: row.next_lesson ? `${dateLabel.format(new Date(Number(row.next_lesson)))}, ${timeLabel.format(new Date(Number(row.next_lesson)))}` : "Не назначен",
        balance: Number(row.balance), floating,
      };
    });
    const lessons = (lessonRows.results as Array<Record<string, unknown>>).map((row) => {
      const balance = Number(row.balance);
      const status = Number(row.has_request) ? "request" : balance < 0 ? "debt" : balance <= 1 ? "low" : "paid";
      const label = status === "request" ? "Ожидает ответа" : balance < 0 ? `Баланс ${balance}` : balance <= 1 ? `Осталось ${balance}` : "Запланирован";
      const start = new Date(Number(row.starts_at));
      return { id: String(row.id), date: toMoscowDate(start), time: timeLabel.format(start), end: timeLabel.format(new Date(Number(row.ends_at))), name: String(row.display_name), status, label };
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
    return Response.json({ students, lessons, requests });
  } catch (error) {
    console.error("Failed to load app data", error);
    return Response.json({ error: "Не удалось загрузить данные" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as ActionBody;
    const db = getD1();
    const id = crypto.randomUUID();

    if (body.action === "createLesson") {
      const range = lessonRange(body.date, body.time, body.durationMinutes);
      if (!range || ![undefined, "once", "weekly"].includes(body.repeat)) return invalid();
      const student = await db.prepare("SELECT id FROM members WHERE workspace_id = ? AND role = 'student' AND display_name = ?").bind(WORKSPACE_ID, body.student.trim()).first<{ id: string }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      if (await hasConflict(db, range.start, range.end)) return conflict();
      const statements = [db.prepare(`INSERT INTO lessons (id, workspace_id, student_id, starts_at, ends_at, created_by_id)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(id, WORKSPACE_ID, student.id, range.start, range.end, TEACHER_ID)];
      if (body.repeat === "weekly") {
        const weekday = new Date(`${body.date}T12:00:00Z`).getUTCDay() || 7;
        const [hours, minutes] = body.time.split(":").map(Number);
        statements.push(db.prepare(`INSERT INTO lesson_series (id, workspace_id, student_id, weekday, start_minutes, duration_minutes, active_from, created_by_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), WORKSPACE_ID, student.id, weekday, hours * 60 + minutes, range.duration, body.date, TEACHER_ID));
      }
      await db.batch(statements);
    } else if (body.action === "updateLesson") {
      const range = lessonRange(body.date, body.time, body.durationMinutes);
      if (!body.lessonId || !range) return invalid();
      const lesson = await db.prepare("SELECT id FROM lessons WHERE id = ? AND workspace_id = ? AND status = 'scheduled'").bind(body.lessonId, WORKSPACE_ID).first();
      if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
      if (await hasConflict(db, range.start, range.end, body.lessonId)) return conflict();
      await db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
        .bind(range.start, range.end, Date.now(), body.lessonId, WORKSPACE_ID).run();
    } else if (body.action === "deleteLesson") {
      if (!body.lessonId) return invalid();
      const result = await db.prepare(`UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'scheduled'`).bind(Date.now(), Date.now(), body.lessonId, WORKSPACE_ID).run();
      if (!result.meta.changes) return Response.json({ error: "Урок не найден" }, { status: 404 });
    } else if (body.action === "createStudent") {
      if (!body.name?.trim() || (body.email && !/^\S+@\S+\.\S+$/.test(body.email))) return invalid();
      const inviteToken = randomToken();
      const inviteId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO members (id, workspace_id, role, status, display_name, email, schedule_type)
          VALUES (?, ?, 'student', 'invited', ?, ?, ?)`).bind(id, WORKSPACE_ID, body.name.trim(), body.email?.trim() || null, body.floating ? "floating" : "fixed"),
        db.prepare(`INSERT INTO invitations (id, workspace_id, member_id, token_hash, expires_at)
          VALUES (?, ?, ?, ?, ?)`).bind(inviteId, WORKSPACE_ID, id, await sha256(inviteToken), Date.now() + 1000 * 60 * 60 * 24 * 14),
      ]);
      return Response.json({ ok: true, id, inviteUrl: new URL(`/invite/${inviteToken}`, request.url).toString() });
    } else if (body.action === "addPayment") {
      if (!body.studentId || !Number.isInteger(body.count) || body.count <= 0) return invalid();
      await db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, note, recorded_by_id)
        VALUES (?, ?, ?, 'payment', ?, 'Оплата занятий', ?)`).bind(id, WORKSPACE_ID, body.studentId, body.count, TEACHER_ID).run();
    } else if (body.action === "resolveRequest") {
      if (!body.requestId || !["approved", "declined"].includes(body.decision)) return invalid();
      const row = await db.prepare("SELECT type, student_id, lesson_id, proposed_starts_at, proposed_ends_at FROM lesson_requests WHERE id = ? AND workspace_id = ? AND status = 'pending'").bind(body.requestId, WORKSPACE_ID).first<Record<string, unknown>>();
      if (!row) return Response.json({ error: "Запрос уже обработан" }, { status: 409 });
      const statements = [db.prepare("UPDATE lesson_requests SET status = ?, resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.decision, TEACHER_ID, Date.now(), Date.now(), body.requestId)];
      if (body.decision === "approved" && row.lesson_id && row.type === "cancel") statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), row.lesson_id));
      if (body.decision === "approved" && row.lesson_id && row.type === "reschedule" && row.proposed_starts_at && row.proposed_ends_at) statements.push(db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?").bind(row.proposed_starts_at, row.proposed_ends_at, Date.now(), row.lesson_id));
      if (body.decision === "approved" && row.type === "new_lesson" && row.student_id && row.proposed_starts_at && row.proposed_ends_at) statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?)").bind(id, WORKSPACE_ID, row.student_id, row.proposed_starts_at, row.proposed_ends_at, TEACHER_ID));
      await db.batch(statements);
    } else return invalid();

    return Response.json({ ok: true, id });
  } catch (error) {
    console.error("Failed to update app data", error);
    return Response.json({ error: "Не удалось сохранить изменения" }, { status: 500 });
  }
}

async function requireTeacher(request?: Request) {
  if (!getAuthConfig()) return { role: "owner" as const };
  if (!request) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const member = await getAuthMember(request);
  if (!member) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (member.workspaceId !== WORKSPACE_ID || !["owner", "teacher"].includes(member.role)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  return member;
}

function invalid() { return Response.json({ error: "Проверьте заполненные данные" }, { status: 400 }); }
function conflict() { return Response.json({ error: "На это время уже назначен другой урок" }, { status: 409 }); }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function minutesToTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
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
async function hasConflict(db: ReturnType<typeof getD1>, start: number, end: number, exceptId = "") {
  const row = await db.prepare(`SELECT id FROM lessons WHERE workspace_id = ? AND status = 'scheduled' AND id != ? AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(WORKSPACE_ID, exceptId, end, start).first();
  return Boolean(row);
}
