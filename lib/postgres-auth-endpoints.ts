import "server-only";

import { z } from "zod";
import { readLimitedJson } from "./request-security";
import {
  assertSameOrigin,
  authenticateWithPassword,
  clearAuthCookies,
  getAuthConfig,
  readCurrentSession,
  revokeCurrentSession,
  rotateCurrentSession,
  sessionCookies,
} from "./node-auth";
import { enforceNodeRateLimit } from "./postgres-rate-limit";

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) }).strict();

function configurationError() {
  return getAuthConfig() ? null : Response.json({ error: "Авторизация не настроена" }, { status: 503 });
}

function jsonWithCookies(value: unknown, cookies: string[], status = 200) {
  const headers = new Headers({ "content-type": "application/json", "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(value), { status, headers });
}

export async function handleNodeLogin(request: Request): Promise<Response> {
  const configError = configurationError();
  if (configError) return configError;
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const limited = await enforceNodeRateLimit(request, "public_auth:/api/auth/login", 10);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = loginSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Введите корректные email и пароль" }, { status: 400 });
  const result = await authenticateWithPassword(request, parsed.data.email, parsed.data.password);
  if (!result.ok) {
    if (result.reason === "blocked") return Response.json({ error: "Доступ к кабинету временно приостановлен. Обратитесь к администратору." }, { status: 403 });
    if (result.reason === "no_access") return Response.json({ error: "Для этого аккаунта нет активного кабинета" }, { status: 403 });
    return Response.json({ error: "Неверный email или пароль" }, { status: 401 });
  }
  return jsonWithCookies({ user: result.user }, sessionCookies(result.token, request));
}

export async function handleNodeLogout(request: Request): Promise<Response> {
  const configError = configurationError();
  if (configError) return configError;
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  await revokeCurrentSession(request);
  return jsonWithCookies({ ok: true }, clearAuthCookies(request));
}

export async function handleNodeRefresh(request: Request): Promise<Response> {
  const configError = configurationError();
  if (configError) return configError;
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const limited = await enforceNodeRateLimit(request, "session_refresh", 60);
  if (limited) return limited;
  const token = await rotateCurrentSession(request);
  if (!token) return jsonWithCookies({ error: "Сессия истекла" }, clearAuthCookies(request), 401);
  return jsonWithCookies({ ok: true }, sessionCookies(token, request));
}

export async function handleNodeSession(request: Request): Promise<Response> {
  const configError = configurationError();
  if (configError) return configError;
  const user = await readCurrentSession(request);
  return user
    ? Response.json({ user }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ user: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
