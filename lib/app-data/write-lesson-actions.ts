import {
  conflict,
  getScheduledLessonGroup,
  hasConflict,
  invalid,
  lessonEventStatement,
  lessonRange,
  toMoscowDate,
} from "@/lib/app-data/route-utils";

import type { WriteActionContext } from "@/lib/app-data/write-action-types";
import { studentLimitResponse } from "@/lib/workspace-limits";

export async function executeLessonAction({ db, body, auth, id }: WriteActionContext): Promise<Response | void> {
  if (body.action === "createLesson") {
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
    if (guestId) { const limited = await studentLimitResponse(auth.workspaceId); if (limited) return limited; }
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
  }
}
