import { sendStudentInvitation } from "@/lib/account-email";
import { getAuthConfig, randomToken, sha256 } from "@/lib/auth";
import { deleteMemberAvatar } from "@/lib/lesson-materials";
import { conflict, hasConflict, invalid, lessonRange, nextOccurrenceDate, toMoscowDate } from "@/lib/app-data/route-utils";

import type { WriteActionContext } from "@/lib/app-data/write-action-types";

export async function executeStudentAction({ request, db, body, auth, id }: WriteActionContext): Promise<Response | void> {
  if (body.action === "createStudent") {
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
  }
}
