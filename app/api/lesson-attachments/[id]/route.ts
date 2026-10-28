import { getAuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { getLessonPhoto, studentSeesLessonSql } from "@/lib/lesson-materials";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const { id } = await context.params;
    const result = await getPostgresPool().query(`SELECT attachment.object_key
      FROM lesson_attachments attachment JOIN lessons lesson ON lesson.id = attachment.lesson_id
      LEFT JOIN members uploader ON uploader.id = attachment.uploaded_by_member_id
      WHERE attachment.id = $1 AND attachment.workspace_id = $2 AND attachment.status = 'active' AND attachment.expires_at > now()
        AND ($3 <> 'student' OR lesson.student_id = $4 OR (uploader.role <> 'student' AND ${studentSeesLessonSql("lesson", "$4")})) LIMIT 1`, [id, auth.workspaceId, auth.role, auth.memberId]);
    const row = result.rows[0];
    if (!row) return Response.json({ error: "Фотография не найдена" }, { status: 404 });
    const bytes = await getLessonPhoto(String(row.object_key));
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": download ? `attachment; filename="lesson-photo-${id}.webp"` : "inline",
      },
    });
  } catch (error) {
    console.error("Failed to read lesson photo", error);
    return Response.json({ error: "Не удалось открыть фотографию" }, { status: 500 });
  }
}
