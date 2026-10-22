import { getPostgresPool } from "@/db/postgres";
import { CONTENT_RULES_VERSION } from "@/lib/legal-consent";
import {
  hasCurrentContentRulesAcceptance,
  lessonPhotoStorageConfigured,
  resolveLessonAccess,
} from "@/lib/lesson-materials";
import { lessonIdSchema, requireAuth } from "@/lib/lesson-content/shared";

export async function readLessonMaterials(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const parsedLessonId = lessonIdSchema.safeParse(new URL(request.url).searchParams.get("lessonId"));
    if (!parsedLessonId.success) return Response.json({ error: "Урок не выбран" }, { status: 400 });
    const lesson = await resolveLessonAccess(auth, parsedLessonId.data);
    if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
    const [accepted, notesResult, homeworkResult, attachmentsResult, resourcesResult, libraryResult] = await Promise.all([
      hasCurrentContentRulesAcceptance(auth),
      getPostgresPool().query(`SELECT note.id, note.author_member_id, note.visibility, note.body, note.created_at, note.updated_at,
          author.display_name AS author_name, author.role AS author_role
        FROM lesson_notes note JOIN members author ON author.id = note.author_member_id
        WHERE note.workspace_id = $1 AND note.lesson_id = $2
          AND (note.visibility = 'shared' OR note.author_member_id = $3)
        ORDER BY CASE note.visibility WHEN 'shared' THEN 0 ELSE 1 END, note.created_at`, [auth.workspaceId, lesson.lessonId, auth.memberId]),
      getPostgresPool().query(`SELECT assignment, student_response, assignment_updated_at, response_updated_at
        FROM lesson_homework WHERE workspace_id = $1 AND lesson_id = $2 LIMIT 1`, [auth.workspaceId, lesson.lessonId]),
      getPostgresPool().query(`SELECT attachment.id, attachment.uploaded_by_member_id, attachment.byte_size, attachment.width,
          attachment.height, attachment.expires_at, attachment.created_at, author.display_name AS author_name
        FROM lesson_attachments attachment
        LEFT JOIN members author ON author.id = attachment.uploaded_by_member_id
        WHERE attachment.workspace_id = $1 AND attachment.lesson_id = $2
          AND attachment.status = 'active' AND attachment.expires_at > now()
        ORDER BY attachment.created_at`, [auth.workspaceId, lesson.lessonId]),
      getPostgresPool().query(`SELECT resource.id, resource.title, resource.original_filename, resource.content_type,
          resource.byte_size, link.created_at
        FROM lesson_resource_links link JOIN teacher_resources resource ON resource.id = link.resource_id
        WHERE link.workspace_id = $1 AND link.lesson_id = $2 AND resource.status = 'active'
        ORDER BY link.created_at`, [auth.workspaceId, lesson.lessonId]),
      auth.role === "student" ? Promise.resolve({ rows: [] }) : getPostgresPool().query(`SELECT id, title, original_filename, content_type, byte_size, folder, tags, created_at
        FROM teacher_resources WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at DESC`, [auth.workspaceId]),
    ]);
    return Response.json({
      contentRulesAccepted: accepted,
      contentRulesVersion: CONTENT_RULES_VERSION,
      photoStorageConfigured: lessonPhotoStorageConfigured(),
      photoRetentionDays: 90,
      maxPhotosPerParticipant: 5,
      homework: homeworkResult.rows[0] ? {
        assignment: homeworkResult.rows[0].assignment ? String(homeworkResult.rows[0].assignment) : "",
        studentResponse: homeworkResult.rows[0].student_response ? String(homeworkResult.rows[0].student_response) : "",
        assignmentUpdatedAt: homeworkResult.rows[0].assignment_updated_at ? new Date(homeworkResult.rows[0].assignment_updated_at).getTime() : null,
        responseUpdatedAt: homeworkResult.rows[0].response_updated_at ? new Date(homeworkResult.rows[0].response_updated_at).getTime() : null,
      } : { assignment: "", studentResponse: "", assignmentUpdatedAt: null, responseUpdatedAt: null },
      notes: notesResult.rows.map((row) => ({
        id: String(row.id), authorId: String(row.author_member_id), authorName: String(row.author_name), authorRole: String(row.author_role),
        visibility: String(row.visibility), body: String(row.body), mine: row.author_member_id === auth.memberId,
        canDelete: row.author_member_id === auth.memberId || auth.role !== "student" && row.visibility === "shared",
        updatedAt: new Date(row.updated_at).getTime(),
      })),
      attachments: attachmentsResult.rows.map((row) => ({
        id: String(row.id), authorName: row.author_name ? String(row.author_name) : "Удалённый пользователь",
        mine: row.uploaded_by_member_id === auth.memberId, canDelete: row.uploaded_by_member_id === auth.memberId || auth.role !== "student",
        byteSize: Number(row.byte_size), width: Number(row.width), height: Number(row.height),
        expiresAt: new Date(row.expires_at).getTime(), createdAt: new Date(row.created_at).getTime(),
        url: `/api/lesson-attachments/${encodeURIComponent(String(row.id))}`,
      })),
      documents: resourcesResult.rows.map((row) => ({
        id: String(row.id), title: String(row.title), filename: String(row.original_filename), contentType: String(row.content_type),
        byteSize: Number(row.byte_size), createdAt: new Date(row.created_at).getTime(),
        url: `/api/teacher-materials/${encodeURIComponent(String(row.id))}`,
      })),
      library: libraryResult.rows.map((row) => ({
        id: String(row.id), title: String(row.title), filename: String(row.original_filename), contentType: String(row.content_type),
        byteSize: Number(row.byte_size), folder: row.folder ? String(row.folder) : null,
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [], createdAt: new Date(row.created_at).getTime(),
        url: `/api/teacher-materials/${encodeURIComponent(String(row.id))}`,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load lesson materials", error);
    return Response.json({ error: "Не удалось загрузить материалы урока" }, { status: 500 });
  }
}
