import { getD1 } from "@/db/d1";
import { assertSameOrigin, authCookies, getAuthConfig } from "@/lib/auth";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config) return Response.json({ error: "Авторизация ещё не настроена" }, { status: 503 });
  const { email, password } = await request.json() as { email?: string; password?: string };
  if (!email || !password) return Response.json({ error: "Введите email и пароль" }, { status: 400 });
  const authResponse = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: config.publishableKey, "content-type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const auth = await authResponse.json() as { access_token?: string; refresh_token?: string; user?: { id: string; email?: string }; msg?: string; error_description?: string };
  if (!authResponse.ok || !auth.access_token || !auth.refresh_token || !auth.user) return Response.json({ error: "Неверный email или пароль" }, { status: 401 });

  const db = getD1();
  await db.prepare("UPDATE users SET auth_subject = ?, updated_at = ? WHERE lower(email) = lower(?)").bind(auth.user.id, Date.now(), email.trim()).run();
  let member = await db.prepare(`SELECT m.id, m.workspace_id, m.role, m.display_name, COALESCE(m.email, u.email, '') AS email FROM users u JOIN members m ON m.user_id = u.id
    WHERE u.auth_subject = ? AND m.status = 'active' LIMIT 1`).bind(auth.user.id).first<Record<string, unknown>>();
  const ownerEmail = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  if (!member && ownerEmail && auth.user.email?.toLowerCase() === ownerEmail) {
    const userId = crypto.randomUUID();
    const ownerName = process.env.INITIAL_OWNER_NAME?.trim() || "Преподаватель";
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO workspaces (id, name, timezone) VALUES ('1', ?, 'Europe/Moscow')").bind(`Кабинет: ${ownerName}`),
      db.prepare("INSERT OR IGNORE INTO users (id, auth_subject, email, full_name) VALUES (?, ?, ?, ?)").bind(userId, auth.user.id, ownerEmail, ownerName),
      db.prepare("INSERT OR IGNORE INTO members (id, workspace_id, user_id, role, status, display_name, email, schedule_type) VALUES ('1', '1', ?, 'owner', 'active', ?, ?, 'fixed')").bind(userId, ownerName, ownerEmail),
    ]);
    member = await db.prepare(`SELECT m.id, m.workspace_id, m.role, m.display_name, COALESCE(m.email, u.email, '') AS email FROM users u JOIN members m ON m.user_id = u.id
      WHERE u.auth_subject = ? AND m.status = 'active' LIMIT 1`).bind(auth.user.id).first<Record<string, unknown>>();
  }
  if (!member) return Response.json({ error: "Для этого аккаунта нет активного кабинета" }, { status: 403 });

  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of authCookies(auth.access_token, auth.refresh_token, request)) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify({ user: { name: String(member.display_name), email: String(member.email), role: String(member.role), workspaceId: String(member.workspace_id) } }), { headers });
}
