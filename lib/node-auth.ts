import "server-only";

import argon2 from "argon2";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { getPostgresPool } from "../db/postgres";

export const ACCESS_COOKIE = "tutor_access";
export const REFRESH_COOKIE = "tutor_refresh";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthMember = { userId: string; memberId: string; workspaceId: string; role: "owner" | "teacher" | "student"; name: string; email: string; isPlatformAdmin: boolean };
export type PlatformAdmin = { userId: string; name: string; email: string };
export type AuthIdentity = { id: string; email?: string };
export type CurrentUser = { name: string; email: string; role: "owner" | "teacher" | "student" | "platform_admin"; workspaceId?: string; isPlatformAdmin: boolean };

type SessionRow = QueryResultRow & { session_id: string; user_id: string; email: string; full_name: string; is_platform_admin: boolean; last_seen_at: Date };

export function getAuthConfig() {
  const secret = process.env.AUTH_SECRET;
  return process.env.DATABASE_URL && secret && secret.length >= 32
    ? { url: "postgresql", publishableKey: "server-session", secretKey: undefined }
    : null;
}

export function readCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken() {
  return Buffer.from(randomBytes(32)).toString("base64url");
}

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1, hashLength: 32 });
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyPasswordHash: Promise<string> | null = null;
function getDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword(randomToken());
  return dummyPasswordHash;
}

function secureCookie(request: Request) {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}

function accessCookie(token: string, request: Request) {
  return `${ACCESS_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}${secureCookie(request) ? "; Secure" : ""}`;
}

export function authCookies(accessToken: string, _refreshToken: string, request: Request) {
  return [accessCookie(accessToken, request), `${REFRESH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(request) ? "; Secure" : ""}`];
}

export function clearAuthCookies(request: Request) {
  const secure = secureCookie(request) ? "; Secure" : "";
  return [
    `${ACCESS_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    `${REFRESH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  ];
}

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function loadSession(request: Request): Promise<SessionRow | null> {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token || token.length !== 43) return null;
  const result = await getPostgresPool().query<SessionRow>(`SELECT s.id AS session_id, s.user_id, s.last_seen_at, u.email, u.full_name, u.is_platform_admin
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL LIMIT 1`, [sessionHash(token)]);
  const session = result.rows[0] ?? null;
  if (session && Date.now() - session.last_seen_at.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await getPostgresPool().query("UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1 AND revoked_at IS NULL", [session.session_id]);
  }
  return session;
}

export async function getAuthIdentity(request: Request): Promise<AuthIdentity | null> {
  const session = await loadSession(request);
  return session ? { id: session.user_id, email: session.email } : null;
}

export async function getAuthMember(request: Request, knownIdentity?: AuthIdentity): Promise<AuthMember | null> {
  const identity = knownIdentity ?? await getAuthIdentity(request);
  if (!identity) return null;
  const result = await getPostgresPool().query(`SELECT u.id AS user_id, u.email, u.is_platform_admin, m.id AS member_id,
      m.workspace_id, m.role, m.display_name
    FROM users u JOIN members m ON m.user_id = u.id JOIN workspaces w ON w.id = m.workspace_id
    WHERE u.id = $1 AND u.disabled_at IS NULL AND m.status = 'active' AND w.access_status = 'active' LIMIT 1`, [identity.id]);
  const member = result.rows[0];
  if (!member) return null;
  await getPostgresPool().query(`UPDATE workspaces SET last_activity_at = now(), updated_at = now()
    WHERE id = $1 AND (last_activity_at IS NULL OR last_activity_at < now() - interval '5 minutes')`, [member.workspace_id]);
  return { userId: String(member.user_id), memberId: String(member.member_id), workspaceId: String(member.workspace_id), role: member.role as AuthMember["role"], name: String(member.display_name), email: String(member.email ?? identity.email ?? ""), isPlatformAdmin: Boolean(member.is_platform_admin) };
}

export async function getPlatformAdmin(request: Request, knownIdentity?: AuthIdentity): Promise<PlatformAdmin | null> {
  const identity = knownIdentity ?? await getAuthIdentity(request);
  if (!identity) return null;
  const result = await getPostgresPool().query("SELECT id, full_name, email FROM users WHERE id = $1 AND is_platform_admin = true AND disabled_at IS NULL LIMIT 1", [identity.id]);
  const admin = result.rows[0];
  return admin ? { userId: String(admin.id), name: String(admin.full_name), email: String(admin.email) } : null;
}

async function currentUser(userId: string): Promise<{ user: CurrentUser | null; blocked: boolean }> {
  const result = await getPostgresPool().query(`SELECT u.full_name, u.email, u.is_platform_admin, m.role, m.display_name, m.workspace_id, w.access_status
    FROM users u LEFT JOIN members m ON m.user_id = u.id AND m.status = 'active'
    LEFT JOIN workspaces w ON w.id = m.workspace_id WHERE u.id = $1 AND u.disabled_at IS NULL
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END LIMIT 1`, [userId]);
  const row = result.rows[0];
  if (!row) return { user: null, blocked: false };
  if (row.workspace_id && row.access_status === "active") return { user: { name: String(row.display_name), email: String(row.email), role: row.role, workspaceId: String(row.workspace_id), isPlatformAdmin: Boolean(row.is_platform_admin) }, blocked: false };
  if (row.is_platform_admin) return { user: { name: String(row.full_name), email: String(row.email), role: "platform_admin", isPlatformAdmin: true }, blocked: false };
  return { user: null, blocked: row.access_status === "blocked" };
}

async function insertSession(executor: PoolClient | ReturnType<typeof getPostgresPool>, userId: string) {
  const token = randomToken();
  await executor.query(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
    VALUES ($1, $2, $3, $4)`, [randomUUID(), userId, sessionHash(token), new Date(Date.now() + SESSION_LIFETIME_MS)]);
  return token;
}

function auditHash(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(value).digest("hex");
}

async function recordAudit(eventType: string, request: Request, email: string, userId?: string) {
  const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  await getPostgresPool().query(`INSERT INTO auth_audit_events (user_id, event_type, email_hash, ip_hash, user_agent)
    VALUES ($1, $2, $3, $4, $5)`, [userId ?? null, eventType, auditHash(email), auditHash(source), request.headers.get("user-agent")?.slice(0, 500) ?? null]);
}

export async function authenticateWithPassword(request: Request, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await getPostgresPool().query(`SELECT id, password_hash, disabled_at FROM users WHERE lower(email) = $1 LIMIT 1`, [normalizedEmail]);
  const account = result.rows[0];
  const valid = account?.password_hash
    ? await verifyPassword(String(account.password_hash), password)
    : await verifyPassword(await getDummyPasswordHash(), password);
  if (!account || account.disabled_at || !valid) {
    await recordAudit("login_failed", request, normalizedEmail, account?.id);
    return { ok: false as const, reason: "invalid" as const };
  }
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail && normalizedEmail === adminEmail) await getPostgresPool().query("UPDATE users SET is_platform_admin = true WHERE id = $1", [account.id]);
  const view = await currentUser(String(account.id));
  if (!view.user) {
    await recordAudit(view.blocked ? "login_blocked" : "login_denied", request, normalizedEmail, account.id);
    return { ok: false as const, reason: view.blocked ? "blocked" as const : "no_access" as const };
  }
  const token = await insertSession(getPostgresPool(), String(account.id));
  await recordAudit("login_succeeded", request, normalizedEmail, account.id);
  return { ok: true as const, token, user: view.user };
}

export async function readCurrentSession(request: Request) {
  const session = await loadSession(request);
  if (!session) return null;
  return (await currentUser(session.user_id)).user;
}

export async function rotateCurrentSession(request: Request) {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token || token.length !== 43) return null;
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const revoked = await client.query(`UPDATE auth_sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING user_id`, [sessionHash(token)]);
    const userId = revoked.rows[0]?.user_id;
    if (!userId || !(await currentUser(String(userId))).user) {
      await client.query("ROLLBACK");
      return null;
    }
    const nextToken = await insertSession(client, String(userId));
    await client.query("COMMIT");
    return nextToken;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeCurrentSession(request: Request) {
  const token = readCookie(request, ACCESS_COOKIE);
  if (token?.length === 43) await getPostgresPool().query("UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sessionHash(token)]);
}

export function sessionCookies(token: string, request: Request) {
  return [accessCookie(token, request), `${REFRESH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(request) ? "; Secure" : ""}`];
}
