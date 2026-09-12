import { assertSameOrigin, clearAuthCookies } from "@/lib/auth";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of clearAuthCookies(request)) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify({ ok: true }), { headers });
}
