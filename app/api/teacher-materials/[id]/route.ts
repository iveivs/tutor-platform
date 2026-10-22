import { getAuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { getTeacherMaterial } from "@/lib/lesson-materials";
import { materialContentDisposition } from "@/lib/teacher-material-files";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const { id } = await context.params;
    const result = await getPostgresPool().query(`SELECT resource.object_key, resource.original_filename, resource.content_type, resource.byte_size
      FROM teacher_resources resource
      WHERE resource.id = $1 AND resource.workspace_id = $2 AND resource.status = 'active'
        AND ($3 <> 'student' OR EXISTS (
          SELECT 1 FROM lesson_resource_links link JOIN lessons lesson ON lesson.id = link.lesson_id
          WHERE link.resource_id = resource.id AND link.workspace_id = resource.workspace_id AND lesson.student_id = $4
        ) OR EXISTS (
          SELECT 1 FROM student_resource_links direct
          WHERE direct.resource_id = resource.id AND direct.workspace_id = resource.workspace_id AND direct.student_id = $4
        )) LIMIT 1`, [id, auth.workspaceId, auth.role, auth.memberId]);
    const row = result.rows[0];
    if (!row) return Response.json({ error: "Материал не найден" }, { status: 404 });
    const bytes = await getTeacherMaterial(String(row.object_key));
    const contentType = String(row.content_type);
    const preview = new URL(request.url).searchParams.get("preview") === "1" && (contentType === "application/pdf" || contentType.startsWith("image/"));
    await getPostgresPool().query("UPDATE teacher_resources SET last_used_at = now() WHERE id = $1 AND workspace_id = $2 AND status = 'active'", [id, auth.workspaceId]);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": materialContentDisposition(String(row.original_filename), preview ? "inline" : "attachment"),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    console.error("Failed to read teacher material", error);
    return Response.json({ error: "Не удалось скачать материал" }, { status: 500 });
  }
}
