import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

// A complaint about one file. The reporter's name is never shown to the teacher; the admin sees
// only the reported file, not the rest of the workspace.
const reportSchema = z.object({
  resourceType: z.enum(["teacher_resource", "lesson_attachment", "lesson_file"]),
  resourceId: z.string().min(1).max(128),
  reason: z.enum(["copyright", "inappropriate", "personal_data", "other"]),
  comment: z.string().trim().max(500),
}).strict();

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const limited = await enforceNodeRateLimit(request, "content_report", 5, `${auth.workspaceId}:${auth.memberId}`);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = reportSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Выберите причину жалобы" }, { status: 400 });
  const { resourceType, resourceId, reason, comment } = parsed.data;
  const pool = getPostgresPool();
  const table = resourceType === "teacher_resource" ? "teacher_resources" : resourceType === "lesson_file" ? "lesson_files" : "lesson_attachments";
  const exists = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND workspace_id = $2 AND status = 'active'`, [resourceId, auth.workspaceId]);
  if (!exists.rowCount) return Response.json({ error: "Файл не найден" }, { status: 404 });
  await pool.query(`INSERT INTO content_reports (id, workspace_id, resource_type, resource_id, reporter_member_id, reason, comment)
    VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`, [randomUUID(), auth.workspaceId, resourceType, resourceId, auth.memberId, reason, comment || null]);
  return Response.json({ ok: true });
}
