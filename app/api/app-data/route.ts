import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, getAuthMember, randomToken, sha256 } from "@/lib/auth";

const MOSCOW_OFFSET = "+03:00";

type ActionBody =
  | { action: "createLesson"; student: string; date: string; time: string; durationMinutes?: number; repeat?: "once" | "weekly" }
  | { action: "updateLesson"; lessonId: string; date: string; time: string; durationMinutes?: number }
  | { action: "deleteLesson"; lessonId: string }
  | { action: "createStudent"; name: string; email?: string; floating: boolean }
  | { action: "createStudentInvite"; studentId: string }
  | { action: "addPayment"; studentId: string; count: number; paymentDate?: string }
  | { action: "resolveRequest"; requestId: string; decision: "approved" | "declined" }
  | { action: "submitStudentRequest"; requestType: "cancel" | "reschedule" | "new_lesson"; lessonId?: string; proposedDate?: string; proposedTime?: string; message?: string; studentId?: string }
  | { action: "updateProfile"; name: string }
  | { action: "markNotificationsRead" };

const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });
const timeLabel = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" });

export async function GET(request: Request) {
  try {
    const auth = await requireMember(request);
    if (auth instanceof Response) return auth;
    const db = getD1();
    await ensureSeriesLessons(db, auth.workspaceId);
    await settlePastLessons(db, auth.workspaceId);
    const ownStudentId = auth.role === "student" ? auth.memberId : null;
    const [studentRows, seriesRows, lessonRows, requestRows, balanceRows, notificationRows, teacherRow, viewerRow] = await Promise.all([
      db.prepare(`SELECT m.id, m.display_name, m.email, m.status, m.schedule_type,
        COALESCE((SELECT SUM(b.lesson_units) FROM balance_entries b WHERE b.student_id = m.id), 0) AS balance,
        (SELECT MIN(l.starts_at) FROM lessons l WHERE l.student_id = m.id AND l.status = 'scheduled' AND l.starts_at >= ?) AS next_lesson
        FROM members m
        WHERE m.workspace_id = ? AND m.role = 'student' AND m.status != 'archived' AND (? IS NULL OR m.id = ?)
        ORDER BY m.display_name`).bind(Date.now(), auth.workspaceId, ownStudentId, ownStudentId).all(),
      db.prepare(`SELECT student_id, weekday, start_minutes FROM lesson_series
        WHERE workspace_id = ? AND is_active = 1 ORDER BY weekday, start_minutes`).bind(auth.workspaceId).all(),
      db.prepare(`SELECT l.id, l.starts_at, l.ends_at, m.display_name,
        COALESCE((SELECT SUM(be.lesson_units) FROM balance_entries be WHERE be.student_id = l.student_id), 0) AS balance,
        EXISTS(SELECT 1 FROM lesson_requests r WHERE r.lesson_id = l.id AND r.status = 'pending') AS has_request
        FROM lessons l JOIN members m ON m.id = l.student_id
        WHERE l.workspace_id = ? AND l.status = 'scheduled' AND (? IS NULL OR l.student_id = ?)
        ORDER BY l.starts_at`).bind(auth.workspaceId, ownStudentId, ownStudentId).all(),
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
        id: String(row.id), name: String(row.display_name), email: row.email ? String(row.email) : undefined, initials: initials(String(row.display_name)),
        schedule, next: row.next_lesson ? `${dateLabel.format(new Date(Number(row.next_lesson)))}, ${timeLabel.format(new Date(Number(row.next_lesson)))}` : "Не назначен",
        balance: Number(row.balance), floating, accountStatus: row.status === "active" ? "active" : "invited",
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
    const balanceEntries = (balanceRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), studentId: String(row.student_id), kind: String(row.kind), units: Number(row.lesson_units),
      note: String(row.note ?? (row.kind === "payment" ? "Оплата занятий" : "Урок проведён")), date: toMoscowDate(new Date(Number(row.occurred_at))),
    }));
    const notifications = (notificationRows.results as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), type: String(row.type), title: String(row.title), body: String(row.body), read: Boolean(row.read_at), createdAt: Number(row.created_at) }));
    return Response.json({ students, lessons, requests, balanceEntries, notifications, currentStudentId: ownStudentId, teacherName: teacherRow?.display_name ?? "Преподаватель", profile: viewerRow ? { name: viewerRow.display_name, email: viewerRow.email } : undefined });
  } catch (error) {
    console.error("Failed to load app data", error);
    return Response.json({ error: "Не удалось загрузить данные" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireMember(request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as ActionBody;
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
      if (!range || ![undefined, "once", "weekly"].includes(body.repeat)) return invalid();
      const student = await db.prepare("SELECT id FROM members WHERE workspace_id = ? AND role = 'student' AND display_name = ?").bind(auth.workspaceId, body.student.trim()).first<{ id: string }>();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      if (await hasConflict(db, auth.workspaceId, range.start, range.end)) return conflict();
      const seriesId = body.repeat === "weekly" ? crypto.randomUUID() : null;
      const statements = [];
      if (body.repeat === "weekly") {
        const weekday = new Date(`${body.date}T12:00:00Z`).getUTCDay() || 7;
        const [hours, minutes] = body.time.split(":").map(Number);
        statements.push(db.prepare(`INSERT INTO lesson_series (id, workspace_id, student_id, weekday, start_minutes, duration_minutes, active_from)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(seriesId, auth.workspaceId, student.id, weekday, hours * 60 + minutes, range.duration, body.date));
      }
      statements.push(db.prepare(`INSERT INTO lessons (id, workspace_id, student_id, series_id, starts_at, ends_at, created_by_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, auth.workspaceId, student.id, seriesId, range.start, range.end, auth.memberId));
      await db.batch(statements);
    } else if (body.action === "updateLesson") {
      const range = lessonRange(body.date, body.time, body.durationMinutes);
      if (!body.lessonId || !range) return invalid();
      const lesson = await db.prepare("SELECT id FROM lessons WHERE id = ? AND workspace_id = ? AND status = 'scheduled'").bind(body.lessonId, auth.workspaceId).first();
      if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
      if (await hasConflict(db, auth.workspaceId, range.start, range.end, body.lessonId)) return conflict();
      await db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
        .bind(range.start, range.end, Date.now(), body.lessonId, auth.workspaceId).run();
    } else if (body.action === "deleteLesson") {
      if (!body.lessonId) return invalid();
      const result = await db.prepare(`UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'scheduled'`).bind(Date.now(), Date.now(), body.lessonId, auth.workspaceId).run();
      if (!result.meta.changes) return Response.json({ error: "Урок не найден" }, { status: 404 });
    } else if (body.action === "createStudent") {
      if (!body.name?.trim() || (body.email && !/^\S+@\S+\.\S+$/.test(body.email))) return invalid();
      const inviteToken = randomToken();
      const inviteId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO members (id, workspace_id, role, status, display_name, email, schedule_type)
          VALUES (?, ?, 'student', 'invited', ?, ?, ?)`).bind(id, auth.workspaceId, body.name.trim(), body.email?.trim() || null, body.floating ? "floating" : "fixed"),
        db.prepare(`INSERT INTO invitations (id, workspace_id, member_id, token_hash, expires_at)
          VALUES (?, ?, ?, ?, ?)`).bind(inviteId, auth.workspaceId, id, await sha256(inviteToken), Date.now() + 1000 * 60 * 60 * 24 * 14),
      ]);
      return Response.json({ ok: true, id, inviteUrl: new URL(`/invite/${inviteToken}`, request.url).toString() });
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
      const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student'").bind(body.studentId, auth.workspaceId).first();
      if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
      await db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, note, occurred_at, recorded_by_id)
        VALUES (?, ?, ?, 'payment', ?, 'Оплата занятий', ?, ?)`).bind(id, auth.workspaceId, body.studentId, body.count, occurredAt, auth.memberId).run();
    } else if (body.action === "resolveRequest") {
      if (!body.requestId || !["approved", "declined"].includes(body.decision)) return invalid();
      const row = await db.prepare("SELECT type, student_id, lesson_id, proposed_starts_at, proposed_ends_at FROM lesson_requests WHERE id = ? AND workspace_id = ? AND status = 'pending'").bind(body.requestId, auth.workspaceId).first<Record<string, unknown>>();
      if (!row) return Response.json({ error: "Запрос уже обработан" }, { status: 409 });
      if (body.decision === "approved" && row.proposed_starts_at && row.proposed_ends_at && await hasConflict(db, auth.workspaceId, Number(row.proposed_starts_at), Number(row.proposed_ends_at), String(row.lesson_id ?? ""))) return conflict();
      const statements = [db.prepare("UPDATE lesson_requests SET status = ?, resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?").bind(body.decision, auth.memberId, Date.now(), Date.now(), body.requestId), db.prepare("INSERT INTO notifications (id, member_id, type, title, body) VALUES (?, ?, 'request_resolved', ?, ?)").bind(crypto.randomUUID(), row.student_id, body.decision === "approved" ? "Запрос подтверждён" : "Запрос отклонён", body.decision === "approved" ? "Изменение появилось в расписании" : "Расписание осталось без изменений")];
      if (body.decision === "approved" && row.lesson_id && row.type === "cancel") statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), row.lesson_id));
      if (body.decision === "approved" && row.lesson_id && row.type === "reschedule" && row.proposed_starts_at && row.proposed_ends_at) statements.push(db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?").bind(row.proposed_starts_at, row.proposed_ends_at, Date.now(), row.lesson_id));
      if (body.decision === "approved" && row.type === "new_lesson" && row.student_id && row.proposed_starts_at && row.proposed_ends_at) statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?)").bind(id, auth.workspaceId, row.student_id, row.proposed_starts_at, row.proposed_ends_at, auth.memberId));
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
    console.error("Failed to update app data", error);
    return Response.json({ error: "Не удалось сохранить изменения" }, { status: 500 });
  }
}

async function requireMember(request?: Request) {
  if (!getAuthConfig()) return { role: "owner" as const, memberId: "1", workspaceId: "1", userId: "1", name: "Преподаватель", email: "" };
  if (!request) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const member = await getAuthMember(request);
  if (!member) return Response.json({ error: "Требуется вход" }, { status: 401 });
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
async function hasConflict(db: ReturnType<typeof getD1>, workspaceId: string, start: number, end: number, exceptId = "") {
  const row = await db.prepare(`SELECT id FROM lessons WHERE workspace_id = ? AND status = 'scheduled' AND id != ? AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(workspaceId, exceptId, end, start).first();
  return Boolean(row);
}
async function settlePastLessons(db: ReturnType<typeof getD1>, workspaceId: string) {
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO balance_entries (id, workspace_id, student_id, lesson_id, kind, lesson_units, note, occurred_at, recorded_by_id)
      SELECT lower(hex(randomblob(16))), l.workspace_id, l.student_id, l.id, 'lesson_charge', -1, 'Урок проведён', l.ends_at, l.created_by_id
      FROM lessons l
      WHERE l.workspace_id = ? AND l.status = 'scheduled' AND l.charge_status = 'pending' AND l.ends_at <= ?
        AND NOT EXISTS (SELECT 1 FROM lesson_requests r WHERE r.lesson_id = l.id AND r.type = 'cancel' AND r.status = 'pending' AND r.created_at <= r.cancellation_deadline_at)`)
      .bind(workspaceId, now),
    db.prepare(`UPDATE lessons SET status = 'completed', charge_status = 'charged', completed_at = ends_at, updated_at = ?
      WHERE workspace_id = ? AND status = 'scheduled' AND charge_status = 'pending' AND ends_at <= ?
        AND NOT EXISTS (SELECT 1 FROM lesson_requests r WHERE r.lesson_id = lessons.id AND r.type = 'cancel' AND r.status = 'pending' AND r.created_at <= r.cancellation_deadline_at)`)
      .bind(now, workspaceId, now),
    db.prepare(`INSERT OR IGNORE INTO notifications (id, member_id, type, title, body)
      SELECT 'debt-' || l.id, l.student_id, 'negative_balance', 'Отрицательный баланс', 'После урока баланс стал отрицательным. Пожалуйста, свяжитесь с преподавателем.'
      FROM lessons l WHERE l.workspace_id = ? AND l.charge_status = 'charged' AND l.ends_at <= ?
        AND (SELECT COALESCE(SUM(b.lesson_units), 0) FROM balance_entries b WHERE b.student_id = l.student_id) < 0`)
      .bind(workspaceId, now),
  ]);
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
  const scheduled = await db.prepare(`SELECT student_id, starts_at, ends_at FROM lessons
    WHERE workspace_id = ? AND status = 'scheduled' AND starts_at <= ? AND ends_at >= ?`)
    .bind(workspaceId, horizonEnd, Date.now()).all<Record<string, unknown>>();
  const occupied = scheduled.results.map((lesson) => ({
    studentId: String(lesson.student_id), start: Number(lesson.starts_at), end: Number(lesson.ends_at),
  }));
  const statements: ReturnType<typeof db.prepare>[] = [];
  for (const row of series.results) {
    const firstDate = String(row.active_from) > startDate ? String(row.active_from) : startDate;
    const activeUntil = row.active_until ? String(row.active_until) : null;
    for (let date = firstDate; date <= horizonDate; date = shiftIsoDate(date, 1)) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
      if (weekday !== Number(row.weekday) || (activeUntil && date > activeUntil)) continue;
      const range = lessonRange(date, minutesToTime(Number(row.start_minutes)), Number(row.duration_minutes));
      if (!range) continue;
      const studentId = String(row.student_id);
      if (occupied.some((lesson) => lesson.studentId === studentId && lesson.start === range.start) || occupied.some((lesson) => lesson.start < range.end && lesson.end > range.start)) continue;
      statements.push(db.prepare(`INSERT INTO lessons (id, workspace_id, student_id, series_id, starts_at, ends_at, created_by_id)
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
