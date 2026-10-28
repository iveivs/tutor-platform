import { getPostgresPool } from "@/db/postgres";
import { getAuthMember } from "@/lib/auth";
import { loadTeacherStats, periodLength } from "@/lib/teacher-stats";

export const runtime = "nodejs";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/teacher-stats?from=YYYY-MM-DD&to=YYYY-MM-DD — workspace statistics, teachers only.
export async function GET(request: Request) {
  try {
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    if (!["owner", "teacher"].includes(auth.role)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!dateRe.test(from) || !dateRe.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to || periodLength(from, to) > 400) {
      return Response.json({ error: "Неверный период" }, { status: 400 });
    }
    return Response.json(await loadTeacherStats(getPostgresPool(), auth.workspaceId, from, to), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Не удалось загрузить статистику" }, { status: 500 });
  }
}
