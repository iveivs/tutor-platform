import { getPostgresPool } from "@/db/postgres";
import { requirePlatformAdmin } from "@/lib/admin-workspaces/shared";
import { getLessonPhoto, getTeacherMaterial } from "@/lib/lesson-materials";

export const runtime = "nodejs";

// The platform admin may open only a file that someone has complained about, and only while the
// complaint is open — never the rest of the workspace's library.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const result = await getPostgresPool().query(`SELECT report.resource_type, resource.object_key AS resource_key, resource.content_type, resource.original_filename,
      attachment.object_key AS attachment_key
    FROM content_reports report
    LEFT JOIN teacher_resources resource ON report.resource_type = 'teacher_resource' AND resource.id = report.resource_id AND resource.status = 'active'
    LEFT JOIN lesson_attachments attachment ON report.resource_type = 'lesson_attachment' AND attachment.id = report.resource_id AND attachment.status = 'active'
    WHERE report.id = $1 AND report.status = 'open'`, [id]);
  const row = result.rows[0];
  const key = row?.resource_key ?? row?.attachment_key;
  if (!key) return Response.json({ error: "Файл недоступен" }, { status: 404 });
  const bytes = row.resource_type === "teacher_resource" ? await getTeacherMaterial(String(key)) : await getLessonPhoto(String(key));
  return new Response(Buffer.from(bytes), { headers: {
    "Content-Type": row.resource_type === "teacher_resource" ? String(row.content_type) : "image/webp",
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
