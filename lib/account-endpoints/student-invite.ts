import "server-only";

import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import {
  baseAcceptanceDocuments,
  LEGAL_DOCUMENT_VERSION,
  studentInviteAcceptanceSchema,
} from "@/lib/legal-consent";
import { hashPassword, sha256, verifyPassword } from "@/lib/node-auth";
import { publicMutation, tokenPattern, unavailable } from "@/lib/account-endpoints/shared";
import { readLimitedJson } from "@/lib/request-security";

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
  const parsed = studentInviteAcceptanceSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте пароль, статус участника и обязательные согласия" }, { status: 400 });
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
    const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
    const acceptanceDocuments = parsed.data.participantStatus === "legal_representative"
      ? [...baseAcceptanceDocuments, { type: "parental_consent", version: LEGAL_DOCUMENT_VERSION }]
      : baseAcceptanceDocuments;
    for (const document of acceptanceDocuments) {
      await client.query(`INSERT INTO legal_acceptances (id, user_id, workspace_id, member_id, document_type, document_version, source, subject_context, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, 'student_invite', $7, $8)`, [randomUUID(), userId, invitation.workspace_id, invitation.member_id, document.type, document.version, parsed.data.participantStatus, userAgent]);
    }
    await client.query("COMMIT");
    return Response.json({ ok: true, email, reusedAccount: Boolean(existing) });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
