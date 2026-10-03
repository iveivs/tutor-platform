import "server-only";

import { createHmac } from "node:crypto";
import { getPostgresPool } from "../db/postgres";

function keyHash(request: Request, scope: string, explicitKey?: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return null;
  const source = explicitKey
    ?? request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("tutor_access="))?.slice("tutor_access=".length)
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  return createHmac("sha256", secret).update(`${scope}:${source}`).digest("hex");
}

export async function enforceNodeRateLimit(request: Request, scope: string, limit: number, explicitKey?: string) {
  const hash = keyHash(request, scope, explicitKey);
  if (!hash) return Response.json({ error: "Авторизация не настроена" }, { status: 503 });
  const result = await getPostgresPool().query<{ request_count: number }>(`INSERT INTO rate_limit_buckets
    (scope, key_hash, window_started_at, request_count, expires_at) VALUES ($1, $2, now(), 1, now() + interval '1 minute')
    ON CONFLICT (scope, key_hash) DO UPDATE SET
      window_started_at = CASE WHEN rate_limit_buckets.expires_at <= now() THEN now() ELSE rate_limit_buckets.window_started_at END,
      request_count = CASE WHEN rate_limit_buckets.expires_at <= now() THEN 1 ELSE rate_limit_buckets.request_count + 1 END,
      expires_at = CASE WHEN rate_limit_buckets.expires_at <= now() THEN now() + interval '1 minute' ELSE rate_limit_buckets.expires_at END
    RETURNING request_count`, [scope, hash]);
  if ((result.rows[0]?.request_count ?? 1) <= limit) return null;
  console.warn(JSON.stringify({ event: "rate_limited", category: scope }));
  return Response.json({ error: "Слишком много запросов. Подождите минуту и попробуйте снова." }, {
    status: 429,
    headers: { "Retry-After": "60", "Cache-Control": "no-store" },
  });
}
