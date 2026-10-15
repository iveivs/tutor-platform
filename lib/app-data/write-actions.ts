import { getD1 } from "@/db/d1";
import { sendStudentInvitation } from "@/lib/account-email";
import type { ActionBody } from "@/lib/app-data/action-schema";
import {
  MOSCOW_OFFSET,
  conflict,
  getScheduledLessonGroup,
  hasConflict,
  invalid,
  lessonEventStatement,
  lessonRange,
  nextOccurrenceDate,
  toMoscowDate,
} from "@/lib/app-data/route-utils";
import { buildAvailableSlots, normalizeAvailabilityWindow } from "@/lib/availability";
import { getAuthConfig, randomToken, sha256, type AuthMember } from "@/lib/auth";
import { deleteMemberAvatar } from "@/lib/lesson-materials";

export async function executeAppDataAction({ request, db, body, auth, id }: {
  request: Request;
  db: ReturnType<typeof getD1>;
  body: ActionBody;
  auth: Omit<AuthMember, "isPlatformAdmin">;
  id: string;
}): Promise<Response | void> {
  if (body.action === "updateOwnAvatarColor") {
    await db.prepare("UPDATE members SET avatar_color = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(body.color, Date.now(), auth.memberId, auth.workspaceId).run();
  } else if (body.action === "updateStudentAvatarColor") {
    const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'")
      .bind(body.studentId, auth.workspaceId).first();
    if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
    if (body.color === null) {
      await db.prepare("DELETE FROM member_display_preferences WHERE viewer_member_id = ? AND student_member_id = ?")
        .bind(auth.memberId, body.studentId).run();
    } else {
      await db.prepare(`INSERT INTO member_display_preferences
        (id, workspace_id, viewer_member_id, student_member_id, avatar_color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(viewer_member_id, student_member_id) DO UPDATE SET avatar_color = excluded.avatar_color, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), auth.workspaceId, auth.memberId, body.studentId, body.color, Date.now(), Date.now()).run();
    }
  } else if (body.action === "updateProfile") {
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
    if (!range || range.start <= Date.now() || ![undefined, "once", "weekly"].includes(body.repeat)) return invalid();
    if (count === 2 && toMoscowDate(new Date(range.end - 1)) !== body.date) return Response.json({ error: "Двойной урок должен завершиться в тот же день" }, { status: 400 });
    const guestName = body.trialGuestName?.trim();
    if (lessonType !== "trial" && (!body.studentId || guestName)) return invalid();
    if (lessonType === "trial" && Boolean(body.studentId) === Boolean(guestName)) return Response.json({ error: "Выберите ученика или укажите имя нового посетителя" }, { status: 400 });
    const guestId = guestName ? crypto.randomUUID() : null;
    const student = body.studentId ? await db.prepare(`SELECT id, is_trial_contact,
      EXISTS(SELECT 1 FROM lessons paid WHERE paid.student_id = members.id AND paid.lesson_type = 'regular' AND paid.status = 'completed') AS has_paid_lesson,
      EXISTS(SELECT 1 FROM balance_entries payment WHERE payment.student_id = members.id AND payment.kind = 'payment') AS has_payment
      FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'`).bind(body.studentId, auth.workspaceId).first<{ id: string; is_trial_contact: number; has_paid_lesson: number; has_payment: number }>() : null;
    if (body.studentId && !student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
    if (lessonType === "regular" && student?.is_trial_contact) return Response.json({ error: "Сначала создайте карточку ученика" }, { status: 409 });
    if (lessonType === "trial" && student && (student.has_paid_lesson || student.has_payment)) return Response.json({ error: "У ученика уже были платные занятия — пробное занятие недоступно" }, { status: 409 });
    const studentId = student?.id ?? guestId!;
    if (await hasConflict(db, auth.workspaceId, range.start, range.end)) return conflict();
    const seriesId = body.repeat === "weekly" ? crypto.randomUUID() : null;
    const groupId = count === 2 ? crypto.randomUUID() : null;
    const lessonIds = [id, ...(count === 2 ? [crypto.randomUUID()] : [])];
    const lessonRanges = count === 2
      ? [lessonRange(body.date, body.time, 60)!, { start: range.start + 60 * 60_000, end: range.end, duration: 60 }]
      : [range];
    const statements: ReturnType<typeof db.prepare>[] = [];
    if (guestId) statements.push(db.prepare(`INSERT INTO members (id, workspace_id, role, status, display_name, email, phone, notes, is_trial_contact, schedule_type)
      VALUES (?, ?, 'student', 'invited', ?, ?, ?, ?, 1, 'floating')`).bind(guestId, auth.workspaceId, guestName, body.trialGuestEmail?.trim() || null, body.trialGuestPhone?.trim() || null, body.trialGuestNote?.trim() || null));
    if (body.repeat === "weekly") {
      const weekday = new Date(`${body.date}T12:00:00Z`).getUTCDay() || 7;
      const [hours, minutes] = body.time.split(":").map(Number);
      statements.push(db.prepare(`INSERT INTO lesson_series (id, workspace_id, student_id, weekday, start_minutes, duration_minutes, active_from)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(seriesId, auth.workspaceId, studentId, weekday, hours * 60 + minutes, range.duration, body.date));
      statements.push(db.prepare("UPDATE members SET schedule_type = 'fixed', updated_at = ? WHERE id = ? AND workspace_id = ?").bind(Date.now(), studentId, auth.workspaceId));
    }
    lessonRanges.forEach((lessonRange, index) => {
      const lessonId = lessonIds[index];
      statements.push(db.prepare(`INSERT INTO lessons (id, workspace_id, student_id, series_id, group_id, lesson_type, starts_at, ends_at, created_by_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(lessonId, auth.workspaceId, studentId, seriesId, groupId, lessonType, lessonRange.start, lessonRange.end, auth.memberId));
      statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId, lessonId, actorMemberId: auth.memberId, sourceKey: `lesson-created:${lessonId}`, eventType: "scheduled", startsAt: lessonRange.start, endsAt: lessonRange.end, note: lessonType === "trial" ? "Пробное занятие · бесплатно" : count === 2 ? `Двойной урок · часть ${index + 1} из 2` : body.repeat === "weekly" ? "Создано постоянное расписание" : null }));
    });
    if (!guestId) statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_created', ?, ?)")
      .bind(crypto.randomUUID(), studentId, studentId, id, lessonType === "trial" ? "Назначено пробное занятие" : "Назначен урок", lessonType === "trial" ? `Пробное занятие назначено на ${body.date} в ${body.time}. Оно бесплатное.` : `${count === 2 ? "Двойной урок" : "Урок"} назначен на ${body.date} в ${body.time}.`));
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
      inviteUrl = new URL(`/invite/${inviteToken}`, process.env.PUBLIC_APP_URL ?? request.url).toString();
    }
    await db.batch(statements);
    const emailSent = email && inviteUrl ? await sendStudentInvitation(email, body.name.trim(), inviteUrl) : false;
    return Response.json({ ok: true, id, inviteUrl, emailSent });
  } else if (body.action === "updateStudent") {
    const name = body.name?.trim();
    const email = body.email?.trim() || null;
    if (!body.studentId || !name || name.length > 80 || (email && !/^\S+@\S+\.\S+$/.test(email))) return invalid();
    const accountReadySql = getAuthConfig()?.url === "postgresql"
      ? "EXISTS(SELECT 1 FROM users account_user WHERE account_user.id = members.user_id AND account_user.password_hash IS NOT NULL)"
      : "status = 'active'";
    const student = await db.prepare(`SELECT id, status, email, ${accountReadySql} AS account_ready FROM members
      WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'`).bind(body.studentId, auth.workspaceId).first<{ id: string; status: string; email: string | null; account_ready: number | boolean }>();
    if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
    if (Boolean(student.account_ready) && (student.email ?? "").toLowerCase() !== (email ?? "").toLowerCase()) return Response.json({ error: "Email подключённого аккаунта меняется через поддержку" }, { status: 409 });
    await db.prepare("UPDATE members SET display_name = ?, email = ?, can_view_availability = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(name, email, body.canViewAvailability ? 1 : 0, Date.now(), student.id, auth.workspaceId).run();
  } else if (body.action === "convertTrialContact") {
    const contact = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND is_trial_contact = 1 AND status != 'archived'").bind(body.studentId, auth.workspaceId).first();
    if (!contact) return Response.json({ error: "Пробный посетитель не найден" }, { status: 404 });
    await db.prepare("UPDATE members SET is_trial_contact = 0, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(Date.now(), body.studentId, auth.workspaceId).run();
  } else if (body.action === "archiveStudent") {
    const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND is_trial_contact = 0 AND status != 'archived'").bind(body.studentId, auth.workspaceId).first();
    if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
    const now = Date.now();
    await db.batch([
      db.prepare("UPDATE members SET status = 'archived', updated_at = ? WHERE id = ? AND workspace_id = ?").bind(now, body.studentId, auth.workspaceId),
      db.prepare("UPDATE lesson_series SET is_active = 0, active_until = ?, updated_at = ? WHERE student_id = ? AND workspace_id = ? AND is_active = 1").bind(toMoscowDate(new Date(now)), now, body.studentId, auth.workspaceId),
      db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE student_id = ? AND workspace_id = ? AND status = 'scheduled' AND starts_at > ?").bind(now, now, body.studentId, auth.workspaceId, now),
      db.prepare("UPDATE lesson_requests SET status = 'expired', resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE student_id = ? AND workspace_id = ? AND status = 'pending'").bind(auth.memberId, now, now, body.studentId, auth.workspaceId),
    ]);
  } else if (body.action === "restoreStudent") {
    const restored = await db.prepare(`UPDATE members SET status = CASE WHEN user_id IS NULL THEN 'invited' ELSE 'active' END, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND role = 'student' AND is_trial_contact = 0 AND status = 'archived'`).bind(Date.now(), body.studentId, auth.workspaceId).run();
    if (!restored.meta.changes) return Response.json({ error: "Ученик не найден в архиве" }, { status: 404 });
  } else if (body.action === "deleteStudent") {
    const student = await db.prepare("SELECT id, avatar_object_key FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND is_trial_contact = 0 AND status = 'archived'").bind(body.studentId, auth.workspaceId).first<{ id: string; avatar_object_key: string | null }>();
    if (!student) return Response.json({ error: "Окончательно удалить можно только ученика из архива" }, { status: 409 });
    await db.batch([
      db.prepare("DELETE FROM notifications WHERE member_id = ? OR student_id = ? OR lesson_id IN (SELECT id FROM lessons WHERE student_id = ? AND workspace_id = ?) OR request_id IN (SELECT id FROM lesson_requests WHERE student_id = ? AND workspace_id = ?) OR balance_entry_id IN (SELECT id FROM balance_entries WHERE student_id = ? AND workspace_id = ?)").bind(body.studentId, body.studentId, body.studentId, auth.workspaceId, body.studentId, auth.workspaceId, body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM invitations WHERE member_id = ? AND workspace_id = ?").bind(body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM lesson_requests WHERE student_id = ? AND workspace_id = ?").bind(body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM balance_entries WHERE student_id = ? AND workspace_id = ?").bind(body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM lesson_events WHERE student_id = ? AND workspace_id = ?").bind(body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM lessons WHERE student_id = ? AND workspace_id = ?").bind(body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM lesson_series WHERE student_id = ? AND workspace_id = ?").bind(body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM data_changes WHERE audience_member_id = ? AND workspace_id = ?").bind(body.studentId, auth.workspaceId),
      db.prepare("DELETE FROM members WHERE id = ? AND workspace_id = ? AND status = 'archived'").bind(body.studentId, auth.workspaceId),
    ]);
    if (student.avatar_object_key) await deleteMemberAvatar(student.avatar_object_key).catch((error) => console.warn("Failed to delete archived student avatar", error));
  } else if (body.action === "createStudentInvite") {
    if (!body.studentId) return invalid();
    const accountReadySql = getAuthConfig()?.url === "postgresql"
      ? "EXISTS(SELECT 1 FROM users account_user WHERE account_user.id = members.user_id AND account_user.password_hash IS NOT NULL)"
      : "status = 'active'";
    const student = await db.prepare(`SELECT id, email, status, display_name, ${accountReadySql} AS account_ready FROM members
      WHERE id = ? AND workspace_id = ? AND role = 'student' AND is_trial_contact = 0 AND status != 'archived'`).bind(body.studentId, auth.workspaceId).first<{ id: string; email: string | null; status: string; display_name: string; account_ready: number | boolean }>();
    if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
    if (Boolean(student.account_ready)) return Response.json({ error: "Ученик уже подключил аккаунт" }, { status: 409 });
    if (!student.email) return Response.json({ error: "Сначала укажите email ученика" }, { status: 409 });
    const inviteToken = randomToken();
    await db.batch([
      db.prepare("UPDATE invitations SET expires_at = ? WHERE member_id = ? AND accepted_at IS NULL").bind(Date.now() - 1, student.id),
      db.prepare("INSERT INTO invitations (id, workspace_id, member_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)").bind(id, auth.workspaceId, student.id, await sha256(inviteToken), Date.now() + 1000 * 60 * 60 * 24 * 14),
    ]);
    const baseUrl = process.env.PUBLIC_APP_URL ?? request.url;
    const inviteUrl = new URL(`/invite/${inviteToken}`, baseUrl).toString();
    const emailSent = await sendStudentInvitation(student.email, student.display_name, inviteUrl);
    return Response.json({ ok: true, inviteUrl, emailSent });
  } else if (body.action === "addPayment") {
    if (!body.studentId || !Number.isInteger(body.count) || body.count <= 0 || body.count > 100 || (body.paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate))) return invalid();
    const occurredAt = body.paymentDate ? new Date(`${body.paymentDate}T12:00:00${MOSCOW_OFFSET}`).getTime() : Date.now();
    if (!Number.isFinite(occurredAt) || occurredAt > Date.now()) return Response.json({ error: "Дата оплаты не может быть в будущем" }, { status: 400 });
    const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND is_trial_contact = 0 AND status != 'archived'").bind(body.studentId, auth.workspaceId).first();
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
}

