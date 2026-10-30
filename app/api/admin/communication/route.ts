import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { notifyFromAdmin, workspaceOwner } from "@/lib/admin-notify";
import { assertSameOrigin } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/admin-workspaces/shared";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

// Admin «Связь»: support conversations, complaints about single files and platform news.
const id = z.string().min(1).max(128);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), workspaceId: id, body: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("setThreadStatus"), workspaceId: id, status: z.enum(["open", "waiting", "resolved"]) }).strict(),
  z.object({ action: z.literal("publishNews"), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4000), important: z.boolean() }).strict(),
  z.object({ action: z.literal("deleteNews"), newsId: id }).strict(),
  z.object({ action: z.literal("resolveReport"), reportId: id, decision: z.enum(["dismiss", "remove"]) }).strict(),
]);
const reasonText: Record<string, string> = { copyright: "нарушение авторских прав", inappropriate: "неприемлемое содержание", personal_data: "личные данные без согласия", other: "другая причина" };
const ms = (value: unknown) => value == null ? null : new Date(value as string).getTime();

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const pool = getPostgresPool();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (workspaceId) {
    const messages = await pool.query("SELECT id, from_admin, topic, body, device, created_at FROM support_messages WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200", [workspaceId]);
    await pool.query("UPDATE support_threads SET admin_read_at = now() WHERE workspace_id = $1", [workspaceId]);
    return Response.json({ messages: messages.rows.reverse().map((row) => ({ id: String(row.id), fromAdmin: Boolean(row.from_admin), topic: row.topic, body: String(row.body), device: row.device, createdAt: ms(row.created_at) })) }, { headers: { "Cache-Control": "no-store" } });
  }
  const [threads, reports, news, teachers] = await Promise.all([
    pool.query(`SELECT thread.workspace_id, thread.status, thread.last_message_at, owner.display_name AS owner_name,
        (SELECT body FROM support_messages m WHERE m.workspace_id = thread.workspace_id ORDER BY created_at DESC LIMIT 1) AS last_body,
        (SELECT topic FROM support_messages m WHERE m.workspace_id = thread.workspace_id AND topic IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS topic,
        (SELECT count(*) FROM support_messages m WHERE m.workspace_id = thread.workspace_id AND NOT m.from_admin AND m.created_at > COALESCE(thread.admin_read_at, 'epoch'))::int AS unread
      FROM support_threads thread
      LEFT JOIN members owner ON owner.id = (SELECT id FROM members WHERE workspace_id = thread.workspace_id AND role = 'owner' ORDER BY created_at LIMIT 1)
      ORDER BY thread.last_message_at DESC LIMIT 200`),
    pool.query(`SELECT report.id, report.workspace_id, report.resource_type, report.resource_id, report.reason, report.comment, report.status, report.created_at,
        owner.display_name AS owner_name,
        COALESCE(resource.title, lesson_file.original_filename, 'Фото урока') AS title, COALESCE(resource.original_filename, lesson_file.original_filename, '') AS filename,
        COALESCE(resource.content_type, lesson_file.content_type, attachment.content_type) AS content_type, COALESCE(resource.byte_size, lesson_file.byte_size, attachment.byte_size) AS byte_size,
        COALESCE(resource.created_at, lesson_file.created_at, attachment.created_at) AS uploaded_at, uploader.display_name AS uploader_name, uploader.role AS uploader_role,
        COALESCE(resource.status, lesson_file.status, attachment.status) AS resource_status,
        (SELECT count(*) FROM lesson_resource_links link WHERE link.resource_id = report.resource_id)::int AS lesson_links,
        (SELECT count(*) FROM student_resource_links link WHERE link.resource_id = report.resource_id)::int AS student_links
      FROM content_reports report
      LEFT JOIN teacher_resources resource ON report.resource_type = 'teacher_resource' AND resource.id = report.resource_id
      LEFT JOIN lesson_attachments attachment ON report.resource_type = 'lesson_attachment' AND attachment.id = report.resource_id
      LEFT JOIN lesson_files lesson_file ON report.resource_type = 'lesson_file' AND lesson_file.id = report.resource_id
      LEFT JOIN members uploader ON uploader.id = COALESCE(resource.uploaded_by_member_id, lesson_file.uploaded_by_member_id, attachment.uploaded_by_member_id)
      LEFT JOIN members owner ON owner.id = (SELECT id FROM members WHERE workspace_id = report.workspace_id AND role = 'owner' ORDER BY created_at LIMIT 1)
      ORDER BY report.status = 'open' DESC, report.created_at DESC LIMIT 200`),
    pool.query(`SELECT news.id, news.title, news.body, news.important, news.published_at,
        (SELECT count(*) FROM platform_news_reads r WHERE r.news_id = news.id)::int AS reads,
        (SELECT count(*) FROM platform_news_reads r WHERE r.news_id = news.id AND r.acknowledged_at IS NOT NULL)::int AS acknowledged
      FROM platform_news news ORDER BY news.published_at DESC LIMIT 100`),
    pool.query("SELECT count(*)::int AS count FROM members WHERE role IN ('owner', 'teacher') AND status = 'active'"),
  ]);
  return Response.json({
    teachers: teachers.rows[0].count,
    threads: threads.rows.map((row) => ({ workspaceId: String(row.workspace_id), status: String(row.status), lastMessageAt: ms(row.last_message_at), ownerName: String(row.owner_name ?? "Без владельца"), lastBody: String(row.last_body ?? ""), topic: row.topic ? String(row.topic) : null, unread: Number(row.unread) })),
    reports: reports.rows.map((row) => ({ id: String(row.id), workspaceId: String(row.workspace_id), resourceType: String(row.resource_type), reason: String(row.reason), comment: row.comment ? String(row.comment) : "", status: String(row.status), createdAt: ms(row.created_at), ownerName: String(row.owner_name ?? ""), title: String(row.title), filename: String(row.filename), contentType: String(row.content_type ?? ""), byteSize: Number(row.byte_size ?? 0), uploadedAt: ms(row.uploaded_at), uploaderName: String(row.uploader_name ?? ""), uploaderRole: String(row.uploader_role ?? ""), fileAvailable: row.resource_status === "active", lessonLinks: Number(row.lesson_links), studentLinks: Number(row.student_links) })),
    news: news.rows.map((row) => ({ id: String(row.id), title: String(row.title), body: String(row.body), important: Boolean(row.important), publishedAt: ms(row.published_at), reads: Number(row.reads), acknowledged: Number(row.acknowledged) })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = actionSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте данные" }, { status: 400 });
  const action = parsed.data;
  const pool = getPostgresPool();

  if (action.action === "reply") {
    const owner = await workspaceOwner(pool, action.workspaceId);
    if (!owner) return Response.json({ error: "Кабинет не найден" }, { status: 404 });
    const messageId = randomUUID();
    await pool.query("INSERT INTO support_messages (id, workspace_id, from_admin, body) VALUES ($1, $2, true, $3)", [messageId, action.workspaceId, action.body]);
    await pool.query(`INSERT INTO support_threads (workspace_id, status, last_message_at, admin_read_at) VALUES ($1, 'waiting', now(), now())
      ON CONFLICT (workspace_id) DO UPDATE SET status = CASE WHEN support_threads.status = 'resolved' THEN 'resolved' ELSE 'waiting' END, last_message_at = now(), admin_read_at = now()`, [action.workspaceId]);
    await notifyFromAdmin(pool, owner, "support_reply", "Ответ поддержки Тьюттори", action.body.length > 300 ? `${action.body.slice(0, 297)}…` : action.body, `support:${messageId}`);
    return Response.json({ ok: true });
  }
  if (action.action === "setThreadStatus") {
    await pool.query("UPDATE support_threads SET status = $2 WHERE workspace_id = $1", [action.workspaceId, action.status]);
    return Response.json({ ok: true });
  }
  if (action.action === "publishNews") {
    const newsId = randomUUID();
    await pool.query("INSERT INTO platform_news (id, title, body, important, created_by_user_id) VALUES ($1, $2, $3, $4, $5)", [newsId, action.title, action.body, action.important, auth.admin.userId]);
    // Only important news reach phones; regular ones wait in «Новости Тьюттори» with a badge.
    if (action.important) {
      const owners = await pool.query("SELECT id FROM members WHERE role IN ('owner', 'teacher') AND status = 'active'");
      for (const row of owners.rows) await notifyFromAdmin(pool, String(row.id), "platform_news", `Важно: ${action.title}`, "Откройте Тьюттори, чтобы прочитать и подтвердить, что вы ознакомились.", `news:${newsId}:${row.id}`);
    }
    return Response.json({ ok: true, id: newsId });
  }
  if (action.action === "deleteNews") {
    await pool.query("DELETE FROM platform_news WHERE id = $1", [action.newsId]);
    return Response.json({ ok: true });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT id, workspace_id, resource_type, resource_id, reason, status FROM content_reports WHERE id = $1 FOR UPDATE", [action.reportId]);
    const report = found.rows[0];
    if (!report) { await client.query("ROLLBACK"); return Response.json({ error: "Жалоба не найдена" }, { status: 404 }); }
    if (report.status !== "open") { await client.query("ROLLBACK"); return Response.json({ error: "Жалоба уже рассмотрена" }, { status: 409 }); }
    const decided = action.decision === "remove" ? "removed" : "dismissed";
    // Every open complaint about the same file is decided together.
    await client.query(`UPDATE content_reports SET status = $3, resolved_by_user_id = $4, resolved_at = now()
      WHERE resource_type = $1 AND resource_id = $2 AND status = 'open'`, [report.resource_type, report.resource_id, decided, auth.admin.userId]);
    if (action.decision === "remove") {
      const table = report.resource_type === "teacher_resource" ? "teacher_resources" : report.resource_type === "lesson_file" ? "lesson_files" : "lesson_attachments";
      const titleColumn = report.resource_type === "teacher_resource" ? "title" : report.resource_type === "lesson_file" ? "original_filename" : "'Фото урока'";
      const touched = report.resource_type === "lesson_file" ? "" : ", updated_at = now()";
      const removed = await client.query(`UPDATE ${table} SET status = 'deleting', deleted_at = now()${touched} WHERE id = $1 AND status = 'active'
        RETURNING uploaded_by_member_id, ${titleColumn} AS title`, [report.resource_id]);
      if (report.resource_type === "teacher_resource") {
        await client.query("DELETE FROM lesson_resource_links WHERE resource_id = $1", [report.resource_id]);
        await client.query("DELETE FROM student_resource_links WHERE resource_id = $1", [report.resource_id]);
      }
      const uploader = removed.rows[0]?.uploaded_by_member_id ? String(removed.rows[0].uploaded_by_member_id) : await workspaceOwner(client, String(report.workspace_id));
      if (uploader) await notifyFromAdmin(client, uploader, "content_removed", "Материал удалён по жалобе", `«${String(removed.rows[0]?.title ?? "Файл")}» удалён администрацией Тьюттори: ${reasonText[String(report.reason)]}. Вопросы — в Настройках → «Написать в поддержку».`, `report:${report.id}`);
    }
    await client.query("COMMIT");
    return Response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
