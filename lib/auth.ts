import { getD1 } from "@/db/d1";

export const ACCESS_COOKIE = "tutor_access";
export const REFRESH_COOKIE = "tutor_refresh";

export type AuthMember = { userId: string; memberId: string; workspaceId: string; role: "owner" | "teacher" | "student"; name: string; email: string; isPlatformAdmin: boolean };
export type PlatformAdmin = { userId: string; name: string; email: string };
export type AuthIdentity = { id: string; email?: string };

export function getAuthConfig() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
  return { url: url.replace(/\/$/, ""), publishableKey, secretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY };
}

export async function getAuthIdentity(request: Request): Promise<AuthIdentity | null> {
  const config = getAuthConfig();
  const accessToken = readCookie(request, ACCESS_COOKIE);
  if (!config || !accessToken) return null;
  const response = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.publishableKey, authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  return response.json() as Promise<AuthIdentity>;
}

export async function getAuthMember(request: Request, knownIdentity?: AuthIdentity): Promise<AuthMember | null> {
  const identity = knownIdentity ?? await getAuthIdentity(request);
  if (!identity) return null;
  const member = await getD1().prepare(`SELECT u.id AS user_id, u.email, u.is_platform_admin, m.id AS member_id, m.workspace_id, m.role, m.display_name
    FROM users u JOIN members m ON m.user_id = u.id JOIN workspaces w ON w.id = m.workspace_id
    WHERE u.auth_subject = ? AND m.status = 'active' AND w.access_status = 'active' LIMIT 1`).bind(identity.id).first<Record<string, unknown>>();
  if (!member) return null;
  const now = Date.now();
  await getD1().prepare(`UPDATE workspaces SET last_activity_at = ?, updated_at = ?
    WHERE id = ? AND (last_activity_at IS NULL OR last_activity_at < ?)`)
    .bind(now, now, member.workspace_id, now - 5 * 60 * 1000).run();
  return { userId: String(member.user_id), memberId: String(member.member_id), workspaceId: String(member.workspace_id), role: member.role as AuthMember["role"], name: String(member.display_name), email: String(member.email ?? identity.email ?? ""), isPlatformAdmin: Boolean(member.is_platform_admin) };
}

export async function getPlatformAdmin(request: Request, knownIdentity?: AuthIdentity): Promise<PlatformAdmin | null> {
  const identity = knownIdentity ?? await getAuthIdentity(request);
  if (!identity) return null;
  const admin = await getD1().prepare(`SELECT id, full_name, email FROM users
    WHERE auth_subject = ? AND is_platform_admin = 1 LIMIT 1`).bind(identity.id).first<Record<string, unknown>>();
  if (!admin) return null;
  return { userId: String(admin.id), name: String(admin.full_name), email: String(admin.email ?? identity.email ?? "") };
}

export function readCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function authCookies(accessToken: string, refreshToken: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return [
    `${ACCESS_COOKIE}=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${secure}`,
    `${REFRESH_COOKIE}=${refreshToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`,
  ];
}

export function clearAuthCookies(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return [`${ACCESS_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`, `${REFRESH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`];
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
