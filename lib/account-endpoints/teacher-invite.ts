import "server-only";

import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { baseAcceptanceDocuments, teacherInviteAcceptanceSchema } from "@/lib/legal-consent";
import { hashPassword, sha256, verifyPassword } from "@/lib/node-auth";
import { publicMutation, tokenPattern, unavailable } from "@/lib/account-endpoints/shared";
import { readLimitedJson } from "@/lib/request-security";

export async function handleNodeTeacherInviteGet(request: Request): Promise<Response> {
  const configError = unavailable();
  if (configError) return configError;
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !tokenPattern.test(token)) return Response.json({ error: "Ссылка недействительна" }, { status: 400 });
  const result = await getPostgresPool().query(`SELECT display_name, email, professional_title, access_grant, expires_at
    FROM teacher_invitations WHERE token_hash = $1 AND status = 'pending' AND expires_at > now() LIMIT 1`, [await sha256(token)]);
  const invitation = result.rows[0];
  if (!invitation) return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 404 });
  return Response.json({
    name: String(invitation.display_name), email: String(invitation.email), professionalTitle: String(invitation.professional_title),
    accessGrant: String(invitation.access_grant), expiresAt: new Date(invitation.expires_at).getTime(),
  }, { headers: { "Cache-Control": "no-store" } });
}
export async function handleNodeTeacherInvitePost(request: Request): Promise<Response> {
  const limited = await publicMutation(request);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = teacherInviteAcceptanceSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте пароль и подтвердите обязательные согласия" }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query(`SELECT id, display_name, email, professional_title, access_grant
      FROM teacher_invitations WHERE token_hash = $1 AND status = 'pending' AND expires_at > now() FOR UPDATE`, [await sha256(parsed.data.token)]);
    const invitation = inviteResult.rows[0];
    if (!invitation) { await client.query("ROLLBACK"); return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 404 }); }
    const email = String(invitation.email).trim().toLowerCase();
    const existingResult = await client.query("SELECT id, password_hash FROM users WHERE lower(email) = $1 LIMIT 1 FOR UPDATE", [email]);
    const existing = existingResult.rows[0];
    if (existing) {
      const membership = await client.query("SELECT id FROM members WHERE user_id = $1 LIMIT 1", [existing.id]);
      if (membership.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Для этого аккаунта уже существует кабинет" }, { status: 409 }); }
      if (existing.password_hash && !await verifyPassword(String(existing.password_hash), parsed.data.password)) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Аккаунт с таким email уже существует. Введите прежний пароль.", existingAccount: true }, { status: 409 });
      }
    }
    const stableId = (await sha256(`teacher-invite:${String(invitation.id)}`)).slice(0, 32);
    const workspaceId = `workspace-${stableId}`;
    const userId = existing?.id ? String(existing.id) : `user-${stableId}`;
    const memberId = `owner-${stableId}`;
    const passwordHash = existing?.password_hash ?? await hashPassword(parsed.data.password);
    await client.query(`INSERT INTO workspaces (id, name, timezone, subscription_status, access_status, access_grant, last_activity_at)
      VALUES ($1, $2, 'Europe/Moscow', 'active', 'active', $3, now())`, [workspaceId, `Кабинет: ${String(invitation.display_name)}`, invitation.access_grant]);
    if (existing) await client.query("UPDATE users SET password_hash = $1, password_set_at = COALESCE(password_set_at, now()), full_name = $2, updated_at = now() WHERE id = $3", [passwordHash, invitation.display_name, userId]);
    else await client.query(`INSERT INTO users (id, email, full_name, password_hash, password_set_at) VALUES ($1, $2, $3, $4, now())`, [userId, email, invitation.display_name, passwordHash]);
    await client.query(`INSERT INTO members (id, workspace_id, user_id, role, status, display_name, professional_title, email, schedule_type)
      VALUES ($1, $2, $3, 'owner', 'active', $4, $5, $6, 'fixed')`, [memberId, workspaceId, userId, invitation.display_name, invitation.professional_title, email]);
    await client.query(`UPDATE teacher_invitations SET status = 'accepted', workspace_id = $1, accepted_at = now(), updated_at = now() WHERE id = $2`, [workspaceId, invitation.id]);
    const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
    for (const document of baseAcceptanceDocuments) {
      await client.query(`INSERT INTO legal_acceptances (id, user_id, workspace_id, member_id, document_type, document_version, source, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, 'teacher_invite', $7)`, [randomUUID(), userId, workspaceId, memberId, document.type, document.version, userAgent]);
    }
    await client.query("COMMIT");
    return Response.json({ ok: true, email, reusedAccount: Boolean(existing) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
