import "server-only";

import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import type { WorkspaceAccessMode } from "../workspace-access";

export const ACCESS_COOKIE = "tutor_access";
export const REFRESH_COOKIE = "tutor_refresh";
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthMember = { userId: string; memberId: string; workspaceId: string; role: "owner" | "teacher" | "student"; name: string; email: string; isPlatformAdmin: boolean; accessMode?: WorkspaceAccessMode };
export type PlatformAdmin = { userId: string; name: string; email: string };
export type AuthIdentity = { id: string; email?: string };
export type CurrentUser = { name: string; email: string; role: "owner" | "teacher" | "student" | "platform_admin"; workspaceId?: string; isPlatformAdmin: boolean };

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
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = process.env.PUBLIC_APP_URL
    ? new URL(process.env.PUBLIC_APP_URL).origin
    : requestOrigin;
  return origin === requestOrigin || origin === publicOrigin;
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
export function getDummyPasswordHash() {
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

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookies(token: string, request: Request) {
  return authCookies(token, "", request);
}
