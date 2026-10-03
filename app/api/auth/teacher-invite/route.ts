import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, sha256 } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { createIdentity, signInExistingIdentity } from "@/lib/supabase-identity";
import { z } from "zod";
import { handleNodeTeacherInviteGet, handleNodeTeacherInvitePost } from "@/lib/node-account-endpoints";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const acceptInviteSchema = z.object({ token: z.string().regex(tokenPattern), password: z.string().min(8).max(128) }).strict();

export async function GET(request: Request) {
  const nodeResponse = await handleNodeTeacherInviteGet(request);
  if (nodeResponse) return nodeResponse;
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !tokenPattern.test(token)) return Response.json({ error: "Ссылка недействительна" }, { status: 400 });
  const invitation = await getD1().prepare(`SELECT display_name, email, professional_title, access_grant, expires_at
    FROM teacher_invitations WHERE token_hash = ? AND status = 'pending' AND expires_at > ? LIMIT 1`)
    .bind(await sha256(token), Date.now()).first<Record<string, unknown>>();
  if (!invitation) return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 404 });
  return Response.json({
    name: String(invitation.display_name), email: String(invitation.email), professionalTitle: String(invitation.professional_title),
    accessGrant: String(invitation.access_grant), expiresAt: Number(invitation.expires_at),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const nodeResponse = await handleNodeTeacherInvitePost(request);
  if (nodeResponse) return nodeResponse;
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config?.secretKey) return Response.json({ error: "Приглашения ещё не настроены" }, { status: 503 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = acceptInviteSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте ссылку и пароль от 8 до 128 символов" }, { status: 400 });
  const db = getD1();
  const invitation = await db.prepare(`SELECT id, display_name, email, professional_title, access_grant
    FROM teacher_invitations WHERE token_hash = ? AND status = 'pending' AND expires_at > ? LIMIT 1`)
    .bind(await sha256(parsed.data.token), Date.now()).first<Record<string, unknown>>();
  if (!invitation) return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 404 });

  const email = String(invitation.email).trim().toLowerCase();
  let identity = await signInExistingIdentity(config, email, parsed.data.password);
  const reusedAccount = Boolean(identity);
  if (!identity) {
    const created = await createIdentity(config, email, parsed.data.password, String(invitation.display_name));
    if (!created.ok) return Response.json({
      error: created.existing ? "Аккаунт с таким email уже существует. Введите прежний пароль." : "Не удалось создать аккаунт",
      existingAccount: created.existing,
    }, { status: 409 });
    identity = created.identity;
  }

  const existingUser = await db.prepare("SELECT id FROM users WHERE auth_subject = ? OR lower(email) = lower(?) LIMIT 1")
    .bind(identity.id, email).first<{ id: string }>();
  if (existingUser) {
    const membership = await db.prepare("SELECT id FROM members WHERE user_id = ? LIMIT 1").bind(existingUser.id).first();
    if (membership) return Response.json({ error: "Для этого аккаунта уже существует кабинет" }, { status: 409 });
  }
  const stableId = (await sha256(`teacher-invite:${String(invitation.id)}`)).slice(0, 32);
  const workspaceId = `workspace-${stableId}`;
  const userId = existingUser?.id ?? `user-${stableId}`;
  const memberId = `owner-${stableId}`;
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO workspaces (id, name, timezone, subscription_status, access_status, access_grant, last_activity_at)
      VALUES (?, ?, 'Europe/Moscow', 'active', 'active', ?, ?)`)
      .bind(workspaceId, `Кабинет: ${String(invitation.display_name)}`, invitation.access_grant, now),
    db.prepare(`INSERT INTO users (id, auth_subject, email, full_name) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET auth_subject = excluded.auth_subject, email = excluded.email, full_name = excluded.full_name, updated_at = ?`)
      .bind(userId, identity.id, email, invitation.display_name, now),
    db.prepare(`INSERT INTO members (id, workspace_id, user_id, role, status, display_name, professional_title, email, schedule_type)
      VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?, 'fixed')`)
      .bind(memberId, workspaceId, userId, invitation.display_name, invitation.professional_title, email),
    db.prepare(`UPDATE teacher_invitations SET status = 'accepted', workspace_id = ?, accepted_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`).bind(workspaceId, now, now, invitation.id),
  ]);
  return Response.json({ ok: true, email, reusedAccount });
}
