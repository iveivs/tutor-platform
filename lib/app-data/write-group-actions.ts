import { conflict, invalid, lessonEventStatement, lessonRange, toMoscowDate } from "@/lib/app-data/route-utils";
import type { WriteActionContext } from "@/lib/app-data/write-action-types";

type Db = WriteActionContext["db"];
type Slot = { weekday: number; time: string; durationMinutes: number };

const minutesOf = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes; };

async function activeGroup(db: Db, workspaceId: string, groupId: string) {
  return db.prepare("SELECT id, name FROM student_groups WHERE id = ? AND workspace_id = ? AND status = 'active'").bind(groupId, workspaceId).first<{ id: string; name: string }>();
}

// Students of this workspace that may join a group (not archived, not trial contacts).
async function validStudents(db: Db, workspaceId: string, memberIds: string[]) {
  if (!memberIds.length) return [];
  const rows = await db.prepare(`SELECT id FROM members WHERE workspace_id = ? AND role = 'student' AND status <> 'archived' AND is_trial_contact = 0
    AND id IN (${memberIds.map(() => "?").join(", ")})`).bind(workspaceId, ...memberIds).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

// A weekly slot must not overlap individual weekly lessons or other groups' slots.
async function slotsConflict(db: Db, workspaceId: string, slots: Slot[], exceptGroupId: string | null) {
  for (const [index, slot] of slots.entries()) {
    const start = minutesOf(slot.time);
    const end = start + slot.durationMinutes;
    if (slots.some((other, otherIndex) => otherIndex !== index && other.weekday === slot.weekday && minutesOf(other.time) < end && minutesOf(other.time) + other.durationMinutes > start)) return true;
    const series = await db.prepare(`SELECT id FROM lesson_series WHERE workspace_id = ? AND is_active = 1 AND weekday = ? AND start_minutes < ? AND start_minutes + duration_minutes > ? LIMIT 1`)
      .bind(workspaceId, slot.weekday, end, start).first();
    if (series) return true;
    const groupSlot = await db.prepare(`SELECT slot.id FROM student_group_slots slot JOIN student_groups g ON g.id = slot.group_id AND g.status = 'active'
      WHERE slot.workspace_id = ? AND slot.is_active = 1 AND slot.weekday = ? AND slot.start_minutes < ? AND slot.start_minutes + slot.duration_minutes > ?
        AND (? IS NULL OR slot.group_id <> ?) LIMIT 1`).bind(workspaceId, slot.weekday, end, start, exceptGroupId, exceptGroupId).first();
    if (groupSlot) return true;
  }
  return false;
}

const insertSlots = (db: Db, workspaceId: string, groupId: string, slots: Slot[]) => {
  const activeFrom = toMoscowDate(new Date());
  return slots.map((slot) => db.prepare(`INSERT INTO student_group_slots (id, workspace_id, group_id, weekday, start_minutes, duration_minutes, active_from)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), workspaceId, groupId, slot.weekday, minutesOf(slot.time), slot.durationMinutes, activeFrom));
};

// Future lessons of the group (optionally only for some members) are cancelled; detaching them from the slot
// lets a member who rejoins later get the generated lessons again.
const cancelFutureStatements = (db: Db, workspaceId: string, groupId: string, actorId: string, memberIds?: string[]) => {
  const now = Date.now();
  const memberFilter = memberIds?.length ? `AND student_id IN (${memberIds.map(() => "?").join(", ")})` : "";
  const members = memberIds ?? [];
  return [
    db.prepare(`UPDATE lesson_requests SET status = 'declined', resolved_by_id = ?, resolved_at = ?, updated_at = ?
      WHERE status = 'pending' AND lesson_id IN (SELECT id FROM lessons WHERE workspace_id = ? AND class_id = ? AND status = 'scheduled' AND starts_at > ? ${memberFilter})`)
      .bind(actorId, now, now, workspaceId, groupId, now, ...members),
    db.prepare(`UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ?, class_slot_id = NULL
      WHERE workspace_id = ? AND class_id = ? AND status = 'scheduled' AND starts_at > ? ${memberFilter}`)
      .bind(now, now, workspaceId, groupId, now, ...members),
  ];
};

// All member rows of one group session (same group, same start).
// Slot sessions are generated for new members automatically; sessions added or moved by hand are copied to them here.
export async function manualSessionCopies(db: Db, workspaceId: string, groupId: string, memberIds: string[], createdById: string) {
  const sessions = (await db.prepare(`SELECT DISTINCT starts_at, ends_at FROM lessons WHERE workspace_id = ? AND class_id = ? AND class_slot_id IS NULL AND status = 'scheduled' AND starts_at > ?`)
    .bind(workspaceId, groupId, Date.now()).all<{ starts_at: number; ends_at: number }>()).results;
  return sessions.flatMap((session) => memberIds.map((memberId) => db.prepare("INSERT INTO lessons (id, workspace_id, student_id, class_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), workspaceId, memberId, groupId, Number(session.starts_at), Number(session.ends_at), createdById)));
}

async function sessionRows(db: Db, workspaceId: string, lessonId: string) {
  const anchor = await db.prepare("SELECT class_id, starts_at FROM lessons WHERE id = ? AND workspace_id = ? AND class_id IS NOT NULL").bind(lessonId, workspaceId).first<{ class_id: string; starts_at: number }>();
  if (!anchor) return null;
  const rows = await db.prepare(`SELECT id, student_id, starts_at, ends_at, class_slot_id FROM lessons WHERE workspace_id = ? AND class_id = ? AND starts_at = ? AND status = 'scheduled'`)
    .bind(workspaceId, anchor.class_id, anchor.starts_at).all<{ id: string; student_id: string; starts_at: number; ends_at: number; class_slot_id: string | null }>();
  return { classId: anchor.class_id, rows: rows.results.map((row) => ({ ...row, starts_at: Number(row.starts_at), ends_at: Number(row.ends_at) })) };
}

const overlapsOtherLessons = async (db: Db, workspaceId: string, start: number, end: number, groupId: string) => Boolean(await db.prepare(`SELECT id FROM lessons
  WHERE workspace_id = ? AND status = 'scheduled' AND (class_id IS NULL OR class_id <> ?) AND starts_at < ? AND ends_at > ? LIMIT 1`).bind(workspaceId, groupId, end, start).first());

export async function executeGroupAction({ db, body, auth, id }: WriteActionContext): Promise<Response | void> {
  if (body.action === "createGroup") {
    if (await slotsConflict(db, auth.workspaceId, body.slots, null)) return conflict();
    const members = await validStudents(db, auth.workspaceId, body.memberIds);
    await db.batch([
      db.prepare("INSERT INTO student_groups (id, workspace_id, name, members_visible) VALUES (?, ?, ?, ?)").bind(id, auth.workspaceId, body.name.trim(), body.membersVisible ? 1 : 0),
      ...members.map((memberId) => db.prepare("INSERT INTO student_group_members (group_id, member_id, workspace_id) VALUES (?, ?, ?)").bind(id, memberId, auth.workspaceId)),
      ...insertSlots(db, auth.workspaceId, id, body.slots),
    ]);
    return Response.json({ ok: true, id });
  }

  const group = await activeGroup(db, auth.workspaceId, ("groupId" in body && body.groupId) || "");
  if (body.action === "updateGroup") {
    if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
    await db.prepare("UPDATE student_groups SET name = ?, members_visible = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(body.name.trim(), body.membersVisible ? 1 : 0, Date.now(), group.id, auth.workspaceId).run();
  } else if (body.action === "setGroupMembers") {
    if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
    const wanted = await validStudents(db, auth.workspaceId, body.memberIds);
    const current = (await db.prepare("SELECT member_id FROM student_group_members WHERE group_id = ?").bind(group.id).all<{ member_id: string }>()).results.map((row) => row.member_id);
    const added = wanted.filter((memberId) => !current.includes(memberId));
    const removed = current.filter((memberId) => !wanted.includes(memberId));
    const statements = added.map((memberId) => db.prepare("INSERT INTO student_group_members (group_id, member_id, workspace_id) VALUES (?, ?, ?)").bind(group.id, memberId, auth.workspaceId));
    if (added.length) statements.push(...await manualSessionCopies(db, auth.workspaceId, group.id, added, auth.memberId));
    if (removed.length) {
      statements.push(...cancelFutureStatements(db, auth.workspaceId, group.id, auth.memberId, removed));
      statements.push(db.prepare(`DELETE FROM student_group_members WHERE group_id = ? AND member_id IN (${removed.map(() => "?").join(", ")})`).bind(group.id, ...removed));
    }
    if (statements.length) await db.batch(statements);
  } else if (body.action === "setGroupSlots") {
    if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
    if (await slotsConflict(db, auth.workspaceId, body.slots, group.id)) return conflict();
    const today = toMoscowDate(new Date());
    await db.batch([
      ...cancelFutureStatements(db, auth.workspaceId, group.id, auth.memberId).map((statement) => statement),
      db.prepare("UPDATE student_group_slots SET is_active = 0, active_until = ?, updated_at = ? WHERE group_id = ? AND is_active = 1").bind(today, Date.now(), group.id),
      ...insertSlots(db, auth.workspaceId, group.id, body.slots),
    ]);
  } else if (body.action === "archiveGroup") {
    if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
    await db.batch([
      ...cancelFutureStatements(db, auth.workspaceId, group.id, auth.memberId),
      db.prepare("UPDATE student_group_slots SET is_active = 0, active_until = ?, updated_at = ? WHERE group_id = ? AND is_active = 1").bind(toMoscowDate(new Date()), Date.now(), group.id),
      db.prepare("UPDATE student_groups SET status = 'archived', updated_at = ? WHERE id = ? AND workspace_id = ?").bind(Date.now(), group.id, auth.workspaceId),
    ]);
  } else if (body.action === "addGroupSession") {
    if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
    const range = lessonRange(body.date, body.time, body.durationMinutes ?? 60);
    if (!range || range.start <= Date.now()) return invalid();
    if (await overlapsOtherLessons(db, auth.workspaceId, range.start, range.end, group.id)) return conflict();
    const members = (await db.prepare(`SELECT gm.member_id FROM student_group_members gm JOIN members m ON m.id = gm.member_id AND m.status <> 'archived'
      WHERE gm.group_id = ?`).bind(group.id).all<{ member_id: string }>()).results.map((row) => row.member_id);
    if (!members.length) return Response.json({ error: "В группе пока нет участников" }, { status: 400 });
    const existing = (await db.prepare("SELECT student_id FROM lessons WHERE class_id = ? AND starts_at = ? AND status = 'scheduled'").bind(group.id, range.start).all<{ student_id: string }>()).results.map((row) => row.student_id);
    const statements = members.filter((memberId) => !existing.includes(memberId)).flatMap((memberId) => {
      const lessonId = crypto.randomUUID();
      return [
        db.prepare("INSERT INTO lessons (id, workspace_id, student_id, class_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(lessonId, auth.workspaceId, memberId, group.id, range.start, range.end, auth.memberId),
        lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: memberId, lessonId, actorMemberId: auth.memberId, eventType: "scheduled", startsAt: range.start, endsAt: range.end }),
        db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_scheduled', 'Новое занятие группы', ?)")
          .bind(crypto.randomUUID(), memberId, memberId, lessonId, `${group.name}: занятие ${body.date} в ${body.time}.`),
      ];
    });
    if (statements.length) await db.batch(statements);
  } else if (body.action === "cancelGroupSession" || body.action === "rescheduleGroupSession") {
    const session = await sessionRows(db, auth.workspaceId, body.lessonId);
    if (!session || !session.rows.length) return Response.json({ error: "Занятие не найдено" }, { status: 404 });
    const groupName = (await db.prepare("SELECT name FROM student_groups WHERE id = ?").bind(session.classId).first<{ name: string }>())?.name ?? "Группа";
    const now = Date.now();
    const ids = session.rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const statements: ReturnType<Db["prepare"]>[] = [];
    if (body.action === "cancelGroupSession") {
      statements.push(
        db.prepare(`UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE workspace_id = ? AND status = 'scheduled' AND id IN (${placeholders})`).bind(now, now, auth.workspaceId, ...ids),
        db.prepare(`UPDATE lesson_requests SET status = 'approved', resolved_by_id = ?, resolved_at = ?, updated_at = ? WHERE lesson_id IN (${placeholders}) AND status = 'pending'`).bind(auth.memberId, now, now, ...ids),
      );
      for (const row of session.rows) {
        statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: row.student_id, lessonId: row.id, actorMemberId: auth.memberId, sourceKey: `lesson-cancelled:${row.id}`, eventType: "cancelled", startsAt: row.starts_at, endsAt: row.ends_at }));
        statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_cancelled', 'Занятие группы отменено', ?)")
          .bind(crypto.randomUUID(), row.student_id, row.student_id, row.id, `${groupName}: занятие отменено преподавателем.`));
      }
    } else {
      const duration = session.rows[0].ends_at - session.rows[0].starts_at;
      const range = lessonRange(body.date, body.time, Math.round(duration / 60_000));
      if (!range || range.start <= Date.now()) return invalid();
      if (await overlapsOtherLessons(db, auth.workspaceId, range.start, range.end, session.classId)) return conflict();
      for (const row of session.rows) {
        // Generated rows stay cancelled at their slot time (so they are not created again); the moved session gets new rows.
        const movedId = row.class_slot_id ? crypto.randomUUID() : row.id;
        if (row.class_slot_id) {
          statements.push(db.prepare("UPDATE lessons SET status = 'cancelled', charge_status = 'waived', cancelled_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(now, now, row.id, auth.workspaceId));
          statements.push(db.prepare("INSERT INTO lessons (id, workspace_id, student_id, class_id, starts_at, ends_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(movedId, auth.workspaceId, row.student_id, session.classId, range.start, range.end, auth.memberId));
        } else {
          statements.push(db.prepare("UPDATE lessons SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind(range.start, range.end, now, row.id, auth.workspaceId));
        }
        statements.push(lessonEventStatement(db, { workspaceId: auth.workspaceId, studentId: row.student_id, lessonId: movedId, actorMemberId: auth.memberId, eventType: "rescheduled", previousStartsAt: row.starts_at, startsAt: range.start, endsAt: range.end }));
        statements.push(db.prepare("INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES (?, ?, ?, ?, 'lesson_rescheduled', 'Занятие группы перенесено', ?)")
          .bind(crypto.randomUUID(), row.student_id, row.student_id, movedId, `${groupName}: новое время ${body.date} в ${body.time}.`));
      }
    }
    await db.batch(statements);
  }
}
