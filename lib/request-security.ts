const MAX_JSON_BYTES = 16 * 1024;

export async function readLimitedJson<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) return { ok: false, response: payloadTooLarge() };

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) return { ok: false, response: payloadTooLarge() };
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: Response.json({ error: "Некорректный формат запроса" }, { status: 400 }) };
  }
}

export async function enforceRateLimit(limiter: RateLimit | undefined, key: string, category: string) {
  if (!limiter) return null;
  const { success } = await limiter.limit({ key });
  if (success) return null;
  console.warn(JSON.stringify({ event: "rate_limited", category }));
  return Response.json(
    { error: "Слишком много запросов. Подождите минуту и попробуйте снова." },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}

export async function anonymousRequestKey(request: Request, scope: string) {
  const source = request.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}:${source}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sessionRequestKey(request: Request, scope: string) {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("tutor_access="));
  const source = cookie?.slice("tutor_access=".length) || request.headers.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}:${source}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function payloadTooLarge() {
  return Response.json({ error: "Запрос слишком большой" }, { status: 413, headers: { "Cache-Control": "no-store" } });
}
