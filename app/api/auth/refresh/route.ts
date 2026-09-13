import { assertSameOrigin, authCookies, getAuthConfig, readCookie, REFRESH_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  const refreshToken = readCookie(request, REFRESH_COOKIE);
  if (!config || !refreshToken) return Response.json({ error: "Сессия истекла" }, { status: 401 });

  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const auth = await response.json() as { access_token?: string; refresh_token?: string };
  if (!response.ok || !auth.access_token || !auth.refresh_token) {
    return Response.json({ error: "Сессия истекла" }, { status: 401 });
  }

  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of authCookies(auth.access_token, auth.refresh_token, request)) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify({ ok: true }), { headers });
}
