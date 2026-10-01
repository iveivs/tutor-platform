import { getD1 } from "@/db/d1";
import { assertSameOrigin, authCookies, getAuthConfig, sha256 } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
}).strict();

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config) return Response.json({ error: "Авторизация ещё не настроена" }, { status: 503 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = loginSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Введите корректные email и пароль" }, { status: 400 });
  const normalizedEmail = parsed.data.email.toLowerCase();
  const { password } = parsed.data;
  const authResponse = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: config.publishableKey, "content-type": "application/json" }, body: JSON.stringify({ email: normalizedEmail, password }),
  });
  const auth = await authResponse.json() as { access_token?: string; refresh_token?: string; user?: { id: string; email?: string }; msg?: string; error_description?: string };
  if (!authResponse.ok || !auth.access_token || !auth.refresh_token || !auth.user) return Response.json({ error: "Неверный email или пароль" }, { status: 401 });

  const db = getD1();
  const now = Date.now();
  await db.prepare("UPDATE users SET auth_subject = ?, updated_at = ? WHERE lower(email) = lower(?)").bind(auth.user.id, now, normalizedEmail).run();
  let member = await loadMember(db, auth.user.id);
  const ownerEmail = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  if (!member && ownerEmail && auth.user.email?.toLowerCase() === ownerEmail) {
    const userId = crypto.randomUUID();
    const ownerName = process.env.INITIAL_OWNER_NAME?.trim() || "Преподаватель";
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO workspaces (id, name, timezone) VALUES ('1', ?, 'Europe/Moscow')").bind(`Кабинет: ${ownerName}`),
      db.prepare("INSERT OR IGNORE INTO users (id, auth_subject, email, full_name, is_platform_admin) VALUES (?, ?, ?, ?, 1)").bind(userId, auth.user.id, ownerEmail, ownerName),
      db.prepare("INSERT OR IGNORE INTO members (id, workspace_id, user_id, role, status, display_name, email, schedule_type) VALUES ('1', '1', ?, 'owner', 'active', ?, ?, 'fixed')").bind(userId, ownerName, ownerEmail),
    ]);
    member = await loadMember(db, auth.user.id);
  }

  if (!member) {
    const registration = await db.prepare(`SELECT id, display_name, professional_title FROM teacher_registrations
      WHERE auth_subject = ? AND lower(email) = lower(?) AND status = 'pending' AND expires_at > ? LIMIT 1`)
      .bind(auth.user.id, normalizedEmail, now).first<{ id: string; display_name: string; professional_title: string }>();
    if (registration) {
      const stableId = (await sha256(auth.user.id)).slice(0, 32);
      const workspaceId = `workspace-${stableId}`;
      const existingUser = await db.prepare("SELECT id FROM users WHERE auth_subject = ? OR lower(email) = lower(?) LIMIT 1")
        .bind(auth.user.id, normalizedEmail).first<{ id: string }>();
      const userId = existingUser?.id ?? `user-${stableId}`;
      const memberId = `owner-${stableId}`;
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO workspaces (id, name, timezone, last_activity_at)
          VALUES (?, ?, 'Europe/Moscow', ?)`).bind(workspaceId, `Кабинет: ${registration.display_name}`, now),
        db.prepare(`INSERT INTO users (id, auth_subject, email, full_name) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET auth_subject = excluded.auth_subject, email = excluded.email,
            full_name = excluded.full_name, updated_at = ?`)
          .bind(userId, auth.user.id, normalizedEmail, registration.display_name, now),
        db.prepare(`INSERT OR IGNORE INTO members
          (id, workspace_id, user_id, role, status, display_name, professional_title, email, schedule_type)
          VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?, 'fixed')`)
          .bind(memberId, workspaceId, userId, registration.display_name, registration.professional_title, normalizedEmail),
        db.prepare(`UPDATE teacher_registrations SET status = 'claimed', workspace_id = ?, claimed_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`).bind(workspaceId, now, now, registration.id),
      ]);
      member = await loadMember(db, auth.user.id);
    }
  }

  const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (platformAdminEmail && auth.user.email?.toLowerCase() === platformAdminEmail) {
    const user = await db.prepare("SELECT id FROM users WHERE auth_subject = ? OR lower(email) = lower(?) LIMIT 1")
      .bind(auth.user.id, platformAdminEmail).first<{ id: string }>();
    if (user) {
      await db.prepare("UPDATE users SET auth_subject = ?, is_platform_admin = 1, updated_at = ? WHERE id = ?").bind(auth.user.id, now, user.id).run();
    } else {
      await db.prepare("INSERT INTO users (id, auth_subject, email, full_name, is_platform_admin) VALUES (?, ?, ?, ?, 1)")
        .bind(crypto.randomUUID(), auth.user.id, platformAdminEmail, "Администратор платформы").run();
    }
    if (member) member.is_platform_admin = 1;
  }

  const admin = await db.prepare("SELECT id, full_name, email FROM users WHERE auth_subject = ? AND is_platform_admin = 1 LIMIT 1")
    .bind(auth.user.id).first<Record<string, unknown>>();
  if (member?.access_status === "blocked" && !admin) return Response.json({ error: "Доступ к кабинету временно приостановлен. Обратитесь к администратору." }, { status: 403 });
  if (!member && !admin) return Response.json({ error: "Для этого аккаунта нет активного кабинета" }, { status: 403 });

  if (member?.access_status === "active") {
    await db.prepare("UPDATE workspaces SET last_activity_at = ?, updated_at = ? WHERE id = ?").bind(now, now, member.workspace_id).run();
  }

  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of authCookies(auth.access_token, auth.refresh_token, request)) headers.append("set-cookie", cookie);
  const user = member?.access_status === "active"
    ? { name: String(member.display_name), email: String(member.email), role: String(member.role), workspaceId: String(member.workspace_id), isPlatformAdmin: Boolean(admin) }
    : { name: String(admin?.full_name ?? "Администратор платформы"), email: String(admin?.email ?? normalizedEmail), role: "platform_admin", isPlatformAdmin: true };
  return new Response(JSON.stringify({ user }), { headers });
}

function loadMember(db: ReturnType<typeof getD1>, authSubject: string) {
  return db.prepare(`SELECT m.id, m.workspace_id, m.role, m.display_name, u.is_platform_admin, w.access_status, COALESCE(m.email, u.email, '') AS email
    FROM users u JOIN members m ON m.user_id = u.id JOIN workspaces w ON w.id = m.workspace_id
    WHERE u.auth_subject = ? AND m.status = 'active' LIMIT 1`).bind(authSubject).first<Record<string, unknown>>();
}
