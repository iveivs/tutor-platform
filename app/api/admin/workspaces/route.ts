import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, getAuthIdentity, getAuthMember, getPlatformAdmin, randomToken, sha256 } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { z } from "zod";

const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createTeacherInvite"), name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), professionalTitle: z.string().trim().max(50), accessGrant: z.literal("complimentary") }).strict(),
  z.object({ action: z.literal("setWorkspaceAccess"), workspaceId: z.string().min(1).max(128), accessStatus: z.enum(["active", "blocked"]) }).strict(),
  z.object({ action: z.literal("deleteWorkspace"), workspaceId: z.string().min(1).max(128), confirmationEmail: z.string().trim().email().max(254) }).strict(),
  z.object({ action: z.literal("revokeTeacherInvite"), invitationId: z.string().min(1).max(128) }).strict(),
]);

async function requirePlatformAdmin(request: Request) {
  const identity = await getAuthIdentity(request);
  if (!identity) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const admin = await getPlatformAdmin(request, identity);
  if (!admin) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  return { admin, member: await getAuthMember(request, identity) };
}

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const db = getD1();
  const rows = await db.prepare(`SELECT w.id, w.name, w.timezone, w.subscription_status, w.access_status, w.access_grant,
    w.access_expires_at, w.created_at, w.last_activity_at, owner.display_name AS owner_name,
    COALESCE(owner.email, owner_user.email, '') AS owner_email,
    (SELECT COUNT(*) FROM members students WHERE students.workspace_id = w.id AND students.role = 'student' AND students.status != 'archived') AS student_count
    FROM workspaces w LEFT JOIN members owner ON owner.id = (
      SELECT candidate.id FROM members candidate WHERE candidate.workspace_id = w.id AND candidate.role = 'owner' ORDER BY candidate.created_at LIMIT 1
    ) LEFT JOIN users owner_user ON owner_user.id = owner.user_id ORDER BY w.created_at DESC`).all<Record<string, unknown>>();
  const invitations = await db.prepare(`SELECT id, display_name, email, professional_title, access_grant, expires_at, created_at
    FROM teacher_invitations WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC`).bind(Date.now()).all<Record<string, unknown>>();
  const audit = await db.prepare(`SELECT e.id, e.workspace_id, e.action, e.created_at, w.name AS workspace_name, u.full_name AS actor_name
    FROM platform_audit_events e JOIN workspaces w ON w.id = e.workspace_id JOIN users u ON u.id = e.actor_user_id
    ORDER BY e.created_at DESC LIMIT 100`).all<Record<string, unknown>>();
  return Response.json({
    currentWorkspaceId: auth.member?.workspaceId,
    workspaces: rows.results.map((row) => ({
      id: String(row.id), name: String(row.name), timezone: String(row.timezone), subscriptionStatus: String(row.subscription_status),
      accessStatus: String(row.access_status), accessGrant: String(row.access_grant), accessExpiresAt: row.access_expires_at == null ? null : Number(row.access_expires_at),
      createdAt: Number(row.created_at), lastActivityAt: row.last_activity_at == null ? null : Number(row.last_activity_at),
      ownerName: String(row.owner_name ?? "Без владельца"), ownerEmail: String(row.owner_email ?? ""), studentCount: Number(row.student_count),
    })),
    invitations: invitations.results.map((invitation) => ({
      id: String(invitation.id), name: String(invitation.display_name), email: String(invitation.email), professionalTitle: String(invitation.professional_title),
      accessGrant: String(invitation.access_grant), expiresAt: Number(invitation.expires_at), createdAt: Number(invitation.created_at),
    })),
    audit: audit.results.map((event) => ({
      id: String(event.id), workspaceId: String(event.workspace_id), workspaceName: String(event.workspace_name),
      actorName: String(event.actor_name), action: String(event.action), createdAt: Number(event.created_at),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = adminActionSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Некорректные параметры" }, { status: 400 });
  const db = getD1();

  if (parsed.data.action === "createTeacherInvite") {
    const email = parsed.data.email.toLowerCase();
    await db.prepare("UPDATE teacher_invitations SET status = 'revoked', updated_at = ? WHERE status = 'pending' AND expires_at <= ?").bind(Date.now(), Date.now()).run();
    const existing = await db.prepare(`SELECT u.id FROM users u WHERE lower(u.email) = lower(?)
      UNION SELECT r.id FROM teacher_registrations r WHERE lower(r.email) = lower(?) AND r.status = 'pending' LIMIT 1`).bind(email, email).first();
    if (existing) return Response.json({ error: "Педагог с таким email уже зарегистрирован или ожидает подтверждения" }, { status: 409 });
    const pending = await db.prepare("SELECT id FROM teacher_invitations WHERE lower(email) = lower(?) AND status = 'pending' LIMIT 1").bind(email).first();
    if (pending) return Response.json({ error: "Для этого email уже создано активное приглашение" }, { status: 409 });
    const token = randomToken();
    const invitationId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 14 * 24 * 60 * 60 * 1000;
    await db.prepare(`INSERT INTO teacher_invitations
      (id, token_hash, email, display_name, professional_title, access_grant, status, created_by_user_id, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .bind(invitationId, await sha256(token), email, parsed.data.name, parsed.data.professionalTitle || "Репетитор", parsed.data.accessGrant, auth.admin.userId, expiresAt, now, now).run();
    const baseUrl = process.env.PUBLIC_APP_URL ?? new URL(request.url).origin;
    return Response.json({ invitation: { id: invitationId, name: parsed.data.name, email, expiresAt, url: new URL(`/teacher-invite/${token}`, baseUrl).toString() } });
  }

  if (parsed.data.action === "revokeTeacherInvite") {
    const result = await db.prepare("UPDATE teacher_invitations SET status = 'revoked', updated_at = ? WHERE id = ? AND status = 'pending'")
      .bind(Date.now(), parsed.data.invitationId).run();
    if (!result.meta.changes) return Response.json({ error: "Активное приглашение не найдено" }, { status: 404 });
    return Response.json({ ok: true });
  }

  if (parsed.data.action === "setWorkspaceAccess") {
    if (parsed.data.workspaceId === auth.member?.workspaceId && parsed.data.accessStatus === "blocked") return Response.json({ error: "Нельзя заблокировать собственный кабинет администратора" }, { status: 400 });
    const workspace = await db.prepare("SELECT access_status FROM workspaces WHERE id = ?").bind(parsed.data.workspaceId).first<{ access_status: string }>();
    if (!workspace) return Response.json({ error: "Кабинет не найден" }, { status: 404 });
    if (workspace.access_status === parsed.data.accessStatus) return Response.json({ ok: true });
    const now = Date.now();
    await db.batch([
      db.prepare("UPDATE workspaces SET access_status = ?, updated_at = ? WHERE id = ?").bind(parsed.data.accessStatus, now, parsed.data.workspaceId),
      db.prepare(`INSERT INTO platform_audit_events (id, actor_user_id, workspace_id, action, previous_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), auth.admin.userId, parsed.data.workspaceId, parsed.data.accessStatus === "blocked" ? "workspace_blocked" : "workspace_unblocked", workspace.access_status, parsed.data.accessStatus, now),
    ]);
    return Response.json({ ok: true });
  }

  if (parsed.data.workspaceId === auth.member?.workspaceId) return Response.json({ error: "Нельзя удалить собственный кабинет администратора" }, { status: 400 });
  const target = await db.prepare(`SELECT w.access_status, COALESCE(owner.email, u.email, '') AS email, owner.user_id, u.auth_subject, u.is_platform_admin
    FROM workspaces w LEFT JOIN members owner ON owner.id = (SELECT id FROM members WHERE workspace_id = w.id AND role = 'owner' ORDER BY created_at LIMIT 1)
    LEFT JOIN users u ON u.id = owner.user_id WHERE w.id = ? LIMIT 1`).bind(parsed.data.workspaceId).first<Record<string, unknown>>();
  if (!target) return Response.json({ error: "Кабинет не найден" }, { status: 404 });
  if (target.access_status !== "blocked") return Response.json({ error: "Перед удалением приостановите доступ к кабинету" }, { status: 400 });
  if (Boolean(target.is_platform_admin)) return Response.json({ error: "Нельзя удалить кабинет администратора платформы" }, { status: 400 });
  const ownerEmail = String(target.email ?? "").toLowerCase();
  if (!ownerEmail || parsed.data.confirmationEmail.toLowerCase() !== ownerEmail) return Response.json({ error: "Email подтверждения не совпадает" }, { status: 400 });
  const workspaceId = parsed.data.workspaceId;
  const ownerUserId = target.user_id == null ? null : String(target.user_id);
  await db.batch([
    db.prepare("DELETE FROM notifications WHERE member_id IN (SELECT id FROM members WHERE workspace_id = ?)").bind(workspaceId),
    db.prepare("DELETE FROM data_changes WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM lesson_events WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM balance_entries WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM lesson_requests WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM invitations WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM lessons WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM lesson_series WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM availability_windows WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM members WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM platform_audit_events WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("UPDATE teacher_registrations SET workspace_id = NULL, updated_at = ? WHERE workspace_id = ?").bind(Date.now(), workspaceId),
    db.prepare("DELETE FROM teacher_invitations WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM workspaces WHERE id = ?").bind(workspaceId),
    ...(ownerUserId ? [db.prepare("DELETE FROM users WHERE id = ? AND is_platform_admin = 0").bind(ownerUserId)] : []),
  ]);
  await deleteSupabaseIdentity(String(target.auth_subject ?? ""));
  return Response.json({ ok: true });
}

async function deleteSupabaseIdentity(authSubject: string) {
  const config = getAuthConfig();
  if (!authSubject || !config?.secretKey) return;
  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(authSubject)}`, {
    method: "DELETE", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` },
  });
  if (!response.ok && response.status !== 404) console.error(JSON.stringify({ event: "teacher_identity_cleanup_failed", authSubject, status: response.status }));
}
