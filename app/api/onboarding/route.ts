import { z } from "zod";
import { getAuthMember, assertSameOrigin } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

// The first-sign-in tour: shown once per member, the mark lives on the server so other devices skip it too.
const updateSchema = z.object({ seen: z.boolean() }).strict();

export async function GET(request: Request) {
  try {
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const result = await getPostgresPool().query("SELECT onboarding_seen_at FROM members WHERE id = $1 AND workspace_id = $2", [auth.memberId, auth.workspaceId]);
    return Response.json({ seen: Boolean(result.rows[0]?.onboarding_seen_at) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to read onboarding state", error);
    return Response.json({ error: "Не удалось загрузить обучение" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const json = await readLimitedJson<unknown>(request);
    if (!json.ok) return json.response;
    const parsed = updateSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "Неверный запрос" }, { status: 400 });
    await getPostgresPool().query("UPDATE members SET onboarding_seen_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND workspace_id = $2", [auth.memberId, auth.workspaceId, parsed.data.seen]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to update onboarding state", error);
    return Response.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}
