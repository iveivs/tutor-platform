import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, sha256 } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { createIdentity, signInExistingIdentity } from "@/lib/supabase-identity";
import { z } from "zod";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const acceptInviteSchema = z.object({
  token: z.string().regex(tokenPattern),
  password: z.string().min(8).max(128),
}).strict();

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !tokenPattern.test(token)) return Response.json({ error: "Ссылка недействительна" }, { status: 400 });
  const invite = await getD1().prepare(`SELECT m.display_name, m.email FROM invitations i JOIN members m ON m.id = i.member_id
    WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`).bind(await sha256(token), Date.now()).first<Record<string, unknown>>();
  if (!invite) return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 404 });
  return Response.json({ name: String(invite.display_name), email: String(invite.email ?? "") });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config?.secretKey) return Response.json({ error: "Приглашения ещё не настроены" }, { status: 503 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = acceptInviteSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте ссылку и пароль от 8 до 128 символов" }, { status: 400 });
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

  await db.batch([
    db.prepare(`INSERT INTO users (id, auth_subject, email, full_name) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET auth_subject = excluded.auth_subject, email = excluded.email, full_name = excluded.full_name, updated_at = ?`)
      .bind(user.id, identity.id, email, invite.display_name, Date.now()),
    db.prepare("UPDATE members SET user_id = ?, status = 'active', updated_at = ? WHERE id = ?").bind(user.id, Date.now(), invite.member_id),
    db.prepare("UPDATE invitations SET accepted_at = ? WHERE id = ?").bind(Date.now(), invite.id),
  ]);
  return Response.json({ ok: true, email, reusedAccount });
}
