import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

// «Новости Тьюттори» for teachers: platform changes; an important one stays on screen until
// the teacher presses «Ознакомлен», which is stored as an acknowledgement.
const actionSchema = z.object({ action: z.enum(["read", "acknowledge"]), newsId: z.string().min(1).max(128) }).strict();

export async function GET(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (auth.role === "student") return Response.json({ news: [], unread: 0, pendingImportant: null });
  const result = await getPostgresPool().query(`SELECT news.id, news.title, news.body, news.important, news.published_at, reads.read_at, reads.acknowledged_at
    FROM platform_news news LEFT JOIN platform_news_reads reads ON reads.news_id = news.id AND reads.member_id = $1
    ORDER BY news.published_at DESC LIMIT 50`, [auth.memberId]);
  const news = result.rows.map((row) => ({
    id: String(row.id), title: String(row.title), body: String(row.body), important: Boolean(row.important),
    publishedAt: new Date(row.published_at).getTime(), read: Boolean(row.read_at), acknowledged: Boolean(row.acknowledged_at),
  }));
  return Response.json({ news, unread: news.filter((item) => !item.read).length, pendingImportant: news.find((item) => item.important && !item.acknowledged) ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = actionSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Запрос отклонён" }, { status: 400 });
  await getPostgresPool().query(`INSERT INTO platform_news_reads (news_id, member_id, read_at, acknowledged_at)
    SELECT id, $2, now(), CASE WHEN $3 THEN now() END FROM platform_news WHERE id = $1
    ON CONFLICT (news_id, member_id) DO UPDATE SET acknowledged_at = COALESCE(platform_news_reads.acknowledged_at, EXCLUDED.acknowledged_at)`,
  [parsed.data.newsId, auth.memberId, parsed.data.action === "acknowledge"]);
  return Response.json({ ok: true });
}
