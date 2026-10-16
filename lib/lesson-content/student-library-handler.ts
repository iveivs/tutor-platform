import { getPostgresPool } from "@/db/postgres";
import { requireAuth } from "@/lib/lesson-content/shared";

export async function readStudentMaterialLibrary(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    if (auth.role !== "student") return Response.json({ error: "Раздел доступен только ученику" }, { status: 403 });

    const [documents, photos] = await Promise.all([
      getPostgresPool().query(`SELECT resource.id, resource.title, resource.original_filename, resource.content_type,
          resource.byte_size, resource.created_at, max(lesson.starts_at) AS lesson_starts_at
        FROM lesson_resource_links link
        JOIN teacher_resources resource ON resource.id = link.resource_id AND resource.workspace_id = link.workspace_id
        JOIN lessons lesson ON lesson.id = link.lesson_id AND lesson.workspace_id = link.workspace_id
        WHERE link.workspace_id = $1 AND lesson.student_id = $2 AND resource.status = 'active'
        GROUP BY resource.id, resource.title, resource.original_filename, resource.content_type, resource.byte_size, resource.created_at
        ORDER BY lesson_starts_at DESC, resource.title`, [auth.workspaceId, auth.memberId]),
      getPostgresPool().query(`SELECT attachment.id, attachment.byte_size, attachment.width, attachment.height,
          attachment.expires_at, attachment.created_at, attachment.lesson_id, lesson.starts_at AS lesson_starts_at,
          author.display_name AS author_name
        FROM lesson_attachments attachment
        JOIN lessons lesson ON lesson.id = attachment.lesson_id AND lesson.workspace_id = attachment.workspace_id
        JOIN members author ON author.id = attachment.uploaded_by_member_id
        WHERE attachment.workspace_id = $1 AND lesson.student_id = $2
          AND author.role IN ('owner', 'teacher')
          AND attachment.status = 'active' AND attachment.expires_at > now()
        ORDER BY attachment.created_at DESC`, [auth.workspaceId, auth.memberId]),
    ]);

    return Response.json({
      documents: documents.rows.map((row) => ({
        id: String(row.id), title: String(row.title), filename: String(row.original_filename),
        contentType: String(row.content_type), byteSize: Number(row.byte_size),
        createdAt: new Date(row.created_at).getTime(), lessonStartsAt: new Date(row.lesson_starts_at).getTime(),
        url: `/api/teacher-materials/${encodeURIComponent(String(row.id))}`,
      })),
      photos: photos.rows.map((row) => ({
        id: String(row.id), lessonId: String(row.lesson_id), authorName: String(row.author_name),
        mine: false, canDelete: false, byteSize: Number(row.byte_size), width: Number(row.width), height: Number(row.height),
        expiresAt: new Date(row.expires_at).getTime(), createdAt: new Date(row.created_at).getTime(),
        lessonStartsAt: new Date(row.lesson_starts_at).getTime(),
        url: `/api/lesson-attachments/${encodeURIComponent(String(row.id))}`,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load student material library", error);
    return Response.json({ error: "Не удалось загрузить материалы" }, { status: 500 });
  }
}
