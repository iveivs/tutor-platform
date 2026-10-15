import { invalid } from "@/lib/app-data/route-utils";
import { normalizeAvailabilityWindow } from "@/lib/availability";

import type { WriteActionContext } from "@/lib/app-data/write-action-types";

export async function executeProfileAction({ db, body, auth }: WriteActionContext): Promise<Response | void> {
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
  } else if (body.action === "markNotificationsRead") {
    await db.prepare("UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL").bind(Date.now(), auth.memberId).run();
  }
}
