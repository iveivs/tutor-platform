import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig, sha256 } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
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

  const created = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: "POST", headers: { apikey: config.secretKey, "content-type": "application/json" },
    body: JSON.stringify({ email: String(invite.email), password, email_confirm: true, user_metadata: { full_name: String(invite.display_name) } }),
  });
  const identity = await created.json() as { id?: string; msg?: string };
  if (!created.ok || !identity.id) return Response.json({ error: identity.msg?.includes("already") ? "Аккаунт с таким email уже существует" : "Не удалось создать аккаунт" }, { status: 409 });
  const userId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO users (id, auth_subject, email, full_name) VALUES (?, ?, ?, ?)").bind(userId, identity.id, invite.email, invite.display_name),
    db.prepare("UPDATE members SET user_id = ?, status = 'active', updated_at = ? WHERE id = ?").bind(userId, Date.now(), invite.member_id),
    db.prepare("UPDATE invitations SET accepted_at = ? WHERE id = ?").bind(Date.now(), invite.id),
  ]);
  return Response.json({ ok: true, email: String(invite.email) });
}
