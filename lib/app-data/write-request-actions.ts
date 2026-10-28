import { buildAvailableSlots } from "@/lib/availability";
import { getAuthConfig } from "@/lib/auth";
import {
  MOSCOW_OFFSET,
  conflict,
  getScheduledLessonGroup,
  hasConflict,
  invalid,
  lessonEventStatement,
  lessonRange,
  toMoscowDate,
} from "@/lib/app-data/route-utils";

import type { WriteActionContext } from "@/lib/app-data/write-action-types";

export async function executeRequestAction({ db, body, auth, id }: WriteActionContext): Promise<Response | void> {
  if (body.action === "resolveRequest") {
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
    let lesson: { id: string; starts_at: number; ends_at: number; class_id: string | null } | null = null;
    if (body.requestType !== "new_lesson") {
      if (!body.lessonId) return invalid();
      const lessonGroup = await getScheduledLessonGroup(db, auth.workspaceId, body.lessonId);
      if (!lessonGroup.length || lessonGroup[0].student_id !== studentId || lessonGroup[0].starts_at <= Date.now()) return Response.json({ error: "Можно изменить только будущий урок" }, { status: 409 });
      lesson = { id: lessonGroup[0].id, starts_at: lessonGroup[0].starts_at, ends_at: lessonGroup.at(-1)?.ends_at ?? lessonGroup[0].ends_at, class_id: lessonGroup[0].class_id };
      if (lesson.class_id && body.requestType === "reschedule") return Response.json({ error: "Занятие группы переносит преподаватель" }, { status: 409 });
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
    if (lesson?.class_id) {
      // "Не приду" in a group: only this member's row is cancelled, at once and without a charge; the teacher is told.
      const groupLesson = lesson;
      const groupRow = await db.prepare(`SELECT g.name, m.display_name FROM student_groups g JOIN members m ON m.id = ? WHERE g.id = ?`).bind(studentId, groupLesson.class_id).first<{ name: string; display_name: string }>();
      const owner = await db.prepare("SELECT id FROM members WHERE workspace_id = ? AND role = 'owner' AND status = 'active' LIMIT 1").bind(auth.workspaceId).first<{ id: string }>();
      const cancelledAt = Date.now();
      const when = new Date(groupLesson.starts_at);
      const statements = [
        db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'").bind(cancelledAt, cancelledAt, groupLesson.id),
        lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId, lessonId: groupLesson.id, actorMemberId: auth.memberId, sourceKey: `lesson-cancelled:${groupLesson.id}`, eventType: "cancelled", startsAt: groupLesson.starts_at, endsAt: groupLesson.ends_at, occurredAt: cancelledAt, note: "Ученик не придёт на занятие группы" }),
      ];
      if (owner) statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_cancelled', 'Ученик не придёт', ?)")
        .bind(crypto.randomUUID(), owner.id, studentId, groupLesson.id, `${groupRow?.display_name ?? "Ученик"} · ${groupRow?.name ?? "группа"}, ${toMoscowDate(when).split("-").reverse().slice(0, 2).join(".")} ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(when)}`));
      await db.batch(statements);
      return Response.json({ ok: true, id: groupLesson.id, cancelled: true });
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
  }
}
