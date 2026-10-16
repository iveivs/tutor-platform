import "server-only";

import { z } from "zod";
import { assertSameOrigin, getAuthConfig } from "@/lib/node-auth";
import { enforceNodeRateLimit } from "@/lib/postgres-rate-limit";

export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const recoverySchema = z.object({ email: z.string().trim().email().max(254) }).strict();
export const resetSchema = z.object({ accessToken: z.string().regex(tokenPattern), password: z.string().min(8).max(128) }).strict();

export function unavailable() {
  return getAuthConfig() ? null : Response.json({ error: "Авторизация не настроена" }, { status: 503 });
}
export async function publicMutation(request: Request) {
  const configError = unavailable();
  if (configError) return configError;
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  return enforceNodeRateLimit(request, `public_auth:${new URL(request.url).pathname}`, 10);
}
