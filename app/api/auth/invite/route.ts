import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, sha256 } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { createIdentity, signInExistingIdentity } from "@/lib/supabase-identity";
import { handleNodeStudentInviteGet, handleNodeStudentInvitePost } from "@/lib/node-account-endpoints";
import { baseAcceptanceTypes, LEGAL_DOCUMENT_VERSION, studentInviteAcceptanceSchema } from "@/lib/legal-consent";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function GET(request: Request) {
  const nodeResponse = await handleNodeStudentInviteGet(request);
  if (nodeResponse) return nodeResponse;
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !tokenPattern.test(token)) return Response.json({ error: "Ссылка недействительна" }, { status: 400 });
  const invite = await getD1().prepare(`SELECT m.display_name, m.email FROM invitations i JOIN members m ON m.id = i.member_id
    WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`).bind(await sha256(token), Date.now()).first<Record<string, unknown>>();
  if (!invite) return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 404 });
  return Response.json({ name: String(invite.display_name), email: String(invite.email ?? "") });
}

export async function POST(request: Request) {
  const nodeResponse = await handleNodeStudentInvitePost(request);
  if (nodeResponse) return nodeResponse;
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config?.secretKey) return Response.json({ error: "Приглашения ещё не настроены" }, { status: 503 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = studentInviteAcceptanceSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте пароль, статус участника и обязательные согласия" }, { status: 400 });
  const { token, password } = parsed.data;
  const db = getD1();
  const hash = await sha256(token);
  const invite = await db.prepare(`SELECT i.id, i.member_id, m.display_name, m.email FROM invitations i JOIN members m ON m.id = i.member_id
    WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`).bind(hash, Date.now()).first<Record<string, unknown>>();
  if (!invite?.email) return Response.json({ error: "Ссылка недействительна или у ученика не указан email" }, { status: 404 });

  const email = String(invite.email).trim().toLowerCase();
  let identity = await signInExistingIdentity(config, email, password);
  const reusedAccount = Boolean(identity);
  if (!identity) {
    const created = await createIdentity(config, email, password, String(invite.display_name));
    if (!created.ok) {
      return Response.json({
        error: created.existing ? "Аккаунт с таким email уже существует. Введите пароль, который использовали раньше." : "Не удалось создать аккаунт",
        existingAccount: created.existing,
      }, { status: 409 });
    }
    identity = created.identity;
  }

  let user = await db.prepare("SELECT id FROM users WHERE auth_subject = ? OR lower(email) = lower(?) LIMIT 1")
    .bind(identity.id, email).first<{ id: string }>();
  if (user) {
    const linkedMember = await db.prepare("SELECT id FROM members WHERE workspace_id = (SELECT workspace_id FROM members WHERE id = ?) AND user_id = ? LIMIT 1")
      .bind(invite.member_id, user.id).first<{ id: string }>();
    if (linkedMember && linkedMember.id !== invite.member_id) {
      return Response.json({ error: "Этот аккаунт уже подключён к другой карточке ученика. Обратитесь к преподавателю." }, { status: 409 });
    }
  } else {
    user = { id: crypto.randomUUID() };
  }

  const now = Date.now();
  const acceptanceTypes = parsed.data.participantStatus === "legal_representative" ? [...baseAcceptanceTypes, "parental_consent"] : baseAcceptanceTypes;
  await db.batch([
    db.prepare(`INSERT INTO users (id, auth_subject, email, full_name) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET auth_subject = excluded.auth_subject, email = excluded.email, full_name = excluded.full_name, updated_at = ?`)
      .bind(user.id, identity.id, email, invite.display_name, now),
    db.prepare("UPDATE members SET user_id = ?, status = 'active', updated_at = ? WHERE id = ?").bind(user.id, now, invite.member_id),
    db.prepare("UPDATE invitations SET accepted_at = ? WHERE id = ?").bind(now, invite.id),
    ...acceptanceTypes.map((documentType) => db.prepare(`INSERT INTO legal_acceptances
      (id, user_id, workspace_id, member_id, document_type, document_version, source, subject_context, user_agent, accepted_at)
      VALUES (?, ?, (SELECT workspace_id FROM members WHERE id = ?), ?, ?, ?, 'student_invite', ?, ?, ?)`)
      .bind(crypto.randomUUID(), user.id, invite.member_id, invite.member_id, documentType, LEGAL_DOCUMENT_VERSION, parsed.data.participantStatus, request.headers.get("user-agent")?.slice(0, 512) ?? null, now)),
  ]);
  return Response.json({ ok: true, email, reusedAccount });
}
