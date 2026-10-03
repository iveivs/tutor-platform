import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPostgresPool } from "../db/postgres";
import { sendPasswordRecovery } from "./postgres-email";
import { assertSameOrigin, getAuthConfig, hashPassword, randomToken, sha256, verifyPassword } from "./node-auth";
import { enforceNodeRateLimit } from "./postgres-rate-limit";
import { readLimitedJson } from "./request-security";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const inviteSchema = z.object({ token: z.string().regex(tokenPattern), password: z.string().min(8).max(128) }).strict();
const recoverySchema = z.object({ email: z.string().trim().email().max(254) }).strict();
const resetSchema = z.object({ accessToken: z.string().regex(tokenPattern), password: z.string().min(8).max(128) }).strict();

function unavailable() {
  return getAuthConfig() ? null : Response.json({ error: "Авторизация не настроена" }, { status: 503 });
}

async function publicMutation(request: Request) {
  const configError = unavailable();
  if (configError) return configError;
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  return enforceNodeRateLimit(request, `public_auth:${new URL(request.url).pathname}`, 10);
}

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
  const parsed = inviteSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте ссылку и пароль от 8 до 128 символов" }, { status: 400 });
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
    await client.query("COMMIT");
    return Response.json({ ok: true, email, reusedAccount: Boolean(existing) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function handleNodeStudentInviteGet(request: Request): Promise<Response> {
  const configError = unavailable();
  if (configError) return configError;
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !tokenPattern.test(token)) return Response.json({ error: "Ссылка недействительна" }, { status: 400 });
  const result = await getPostgresPool().query(`SELECT m.display_name, m.email FROM invitations i JOIN members m ON m.id = i.member_id
    WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now() LIMIT 1`, [await sha256(token)]);
  const invitation = result.rows[0];
  if (!invitation) return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 404 });
  return Response.json({ name: String(invitation.display_name), email: String(invitation.email ?? "") }, { headers: { "Cache-Control": "no-store" } });
}

export async function handleNodeStudentInvitePost(request: Request): Promise<Response> {
  const limited = await publicMutation(request);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = inviteSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте ссылку и пароль от 8 до 128 символов" }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query(`SELECT i.id, i.member_id, m.workspace_id, m.display_name, m.email FROM invitations i JOIN members m ON m.id = i.member_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now() FOR UPDATE`, [await sha256(parsed.data.token)]);
    const invitation = inviteResult.rows[0];
    if (!invitation?.email) { await client.query("ROLLBACK"); return Response.json({ error: "Ссылка недействительна или у ученика не указан email" }, { status: 404 }); }
    const email = String(invitation.email).trim().toLowerCase();
    const existingResult = await client.query("SELECT id, password_hash FROM users WHERE lower(email) = $1 LIMIT 1 FOR UPDATE", [email]);
    const existing = existingResult.rows[0];
    if (existing?.password_hash && !await verifyPassword(String(existing.password_hash), parsed.data.password)) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Аккаунт с таким email уже существует. Введите пароль, который использовали раньше.", existingAccount: true }, { status: 409 });
    }
    if (existing) {
      const linked = await client.query("SELECT id FROM members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1", [invitation.workspace_id, existing.id]);
      if (linked.rows[0] && String(linked.rows[0].id) !== String(invitation.member_id)) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Этот аккаунт уже подключён к другой карточке ученика. Обратитесь к преподавателю." }, { status: 409 });
      }
    }
    const userId = existing?.id ? String(existing.id) : randomUUID();
    const passwordHash = existing?.password_hash ?? await hashPassword(parsed.data.password);
    if (existing) await client.query("UPDATE users SET password_hash = $1, password_set_at = COALESCE(password_set_at, now()), updated_at = now() WHERE id = $2", [passwordHash, userId]);
    else await client.query("INSERT INTO users (id, email, full_name, password_hash, password_set_at) VALUES ($1, $2, $3, $4, now())", [userId, email, invitation.display_name, passwordHash]);
    await client.query("UPDATE members SET user_id = $1, status = 'active', updated_at = now() WHERE id = $2", [userId, invitation.member_id]);
    await client.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [invitation.id]);
    await client.query("COMMIT");
    return Response.json({ ok: true, email, reusedAccount: Boolean(existing) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function handleNodeRecover(request: Request): Promise<Response> {
  const limited = await publicMutation(request);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = recoverySchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Введите корректный email" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const result = await getPostgresPool().query("SELECT id, full_name FROM users WHERE lower(email) = $1 AND disabled_at IS NULL LIMIT 1", [email]);
  const user = result.rows[0];
  if (user) {
    const token = randomToken();
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE auth_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose IN ('password_reset', 'set_password') AND consumed_at IS NULL", [user.id]);
      await client.query(`INSERT INTO auth_tokens (id, user_id, email, purpose, token_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`, [randomUUID(), user.id, email, "password_reset", await sha256(token)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const baseUrl = new URL("/", process.env.PUBLIC_APP_URL ?? request.url);
    baseUrl.hash = `access_token=${encodeURIComponent(token)}&type=recovery`;
    await sendPasswordRecovery(email, String(user.full_name), baseUrl.toString());
  } else {
    await sha256(randomToken());
  }
  return Response.json({ ok: true });
}

export async function handleNodeResetPassword(request: Request): Promise<Response> {
  const limited = await publicMutation(request);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = resetSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Пароль должен содержать от 8 до 128 символов" }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT id, user_id FROM auth_tokens WHERE token_hash = $1
      AND purpose IN ('password_reset', 'set_password') AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, [await sha256(parsed.data.accessToken)]);
    const token = result.rows[0];
    if (!token?.user_id) { await client.query("ROLLBACK"); return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 401 }); }
    await client.query("UPDATE users SET password_hash = $1, password_set_at = now(), updated_at = now() WHERE id = $2 AND disabled_at IS NULL", [await hashPassword(parsed.data.password), token.user_id]);
    await client.query("UPDATE auth_tokens SET consumed_at = now() WHERE id = $1", [token.id]);
    await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [token.user_id]);
    await client.query("COMMIT");
    return Response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
