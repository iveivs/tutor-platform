import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { deviceLabel } from "@/lib/admin-notify";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

// The teacher's conversation with the platform admin (one per workspace). Only text; the admin
// sees the device and browser of each message, never the workspace's content.
const sendSchema = z.object({ topic: z.enum(["bug", "question", "idea", "payment"]).nullable(), body: z.string().trim().min(1).max(2000) }).strict();

async function teacher(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (auth.role === "student") return Response.json({ error: "Поддержка доступна преподавателю" }, { status: 403 });
  return auth;
}

export async function GET(request: Request) {
  const auth = await teacher(request);
  if (auth instanceof Response) return auth;
  const pool = getPostgresPool();
  const [messages, thread] = await Promise.all([
    pool.query("SELECT id, from_admin, topic, body, created_at FROM support_messages WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200", [auth.workspaceId]),
    pool.query("SELECT status, teacher_read_at FROM support_threads WHERE workspace_id = $1", [auth.workspaceId]),
  ]);
  const readAt = thread.rows[0]?.teacher_read_at ? new Date(thread.rows[0].teacher_read_at).getTime() : 0;
  const unread = messages.rows.filter((row) => row.from_admin && new Date(row.created_at).getTime() > readAt).length;
  if (new URL(request.url).searchParams.get("markRead") === "1" && thread.rowCount) await pool.query("UPDATE support_threads SET teacher_read_at = now() WHERE workspace_id = $1", [auth.workspaceId]);
  return Response.json({
    status: thread.rows[0]?.status ?? null,
    unread,
    messages: messages.rows.reverse().map((row) => ({ id: String(row.id), fromAdmin: Boolean(row.from_admin), topic: row.topic ? String(row.topic) : null, body: String(row.body), createdAt: new Date(row.created_at).getTime() })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await teacher(request);
  if (auth instanceof Response) return auth;
  const limited = await enforceNodeRateLimit(request, "support_message", 10, `${auth.workspaceId}:${auth.memberId}`);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = sendSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Сообщение должно содержать от 1 до 2000 символов" }, { status: 400 });
  const pool = getPostgresPool();
  const hourly = await pool.query("SELECT count(*)::int AS count FROM support_messages WHERE workspace_id = $1 AND NOT from_admin AND created_at > now() - interval '1 hour'", [auth.workspaceId]);
  if (Number(hourly.rows[0]?.count ?? 0) >= 30) return Response.json({ error: "За час можно отправить не более 30 сообщений" }, { status: 429 });
  await pool.query(`INSERT INTO support_messages (id, workspace_id, from_admin, author_member_id, topic, body, device) VALUES ($1, $2, false, $3, $4, $5, $6)`,
    [randomUUID(), auth.workspaceId, auth.memberId, parsed.data.topic, parsed.data.body, deviceLabel(request.headers.get("user-agent"))]);
  await pool.query(`INSERT INTO support_threads (workspace_id, status, last_message_at, teacher_read_at) VALUES ($1, 'open', now(), now())
    ON CONFLICT (workspace_id) DO UPDATE SET status = 'open', last_message_at = now(), teacher_read_at = now()`, [auth.workspaceId]);
  return Response.json({ ok: true });
}
