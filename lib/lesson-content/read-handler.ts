import { getPostgresPool } from "@/db/postgres";
import { CONTENT_RULES_VERSION } from "@/lib/legal-consent";
import {
  hasCurrentContentRulesAcceptance,
  lessonPhotoStorageConfigured,
  resolveLessonAccess,
  sessionLessonIds,
} from "@/lib/lesson-materials";
import { lessonIdSchema, requireAuth } from "@/lib/lesson-content/shared";

type HomeworkRow = Record<string, unknown>;
const time = (value: unknown) => value ? new Date(value as string).getTime() : null;

// One assignment per lesson (for a group: on the session's anchor row). The answer is the student's own; the teacher of a
// group session gets every member's answer in `responses` instead.
function homeworkPayload(rows: HomeworkRow[], assignmentLessonId: string, responseLessonId: string | null) {
  const assignmentRow = rows.find((row) => row.lesson_id === assignmentLessonId);
  const responseRow = responseLessonId ? rows.find((row) => row.lesson_id === responseLessonId) : undefined;
  return {
    assignment: assignmentRow?.assignment ? String(assignmentRow.assignment) : "",
    studentResponse: responseRow?.student_response ? String(responseRow.student_response) : "",
    assignmentUpdatedAt: time(assignmentRow?.assignment_updated_at),
    responseUpdatedAt: time(responseRow?.response_updated_at),
    responses: responseLessonId ? undefined : rows.filter((row) => row.student_response).map((row) => ({
      studentName: String(row.student_name), body: String(row.student_response), updatedAt: time(row.response_updated_at),
    })),
  };
}

export async function readLessonMaterials(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const parsedLessonId = lessonIdSchema.safeParse(new URL(request.url).searchParams.get("lessonId"));
    if (!parsedLessonId.success) return Response.json({ error: "Урок не выбран" }, { status: 400 });
    const lesson = await resolveLessonAccess(auth, parsedLessonId.data);
    if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
    // In a group session the student also sees the teacher's items from the session; their own items stay on their row.
    const lessonIds = await sessionLessonIds(auth.workspaceId, lesson);
    const ownLessonId = auth.role === "student" ? lesson.lessonId : null;
    const assignmentLessonId = lesson.session?.anchorLessonId ?? lesson.lessonId;
    const [accepted, notesResult, homeworkResult, attachmentsResult, resourcesResult, libraryResult, filesResult] = await Promise.all([
      hasCurrentContentRulesAcceptance(auth),
      getPostgresPool().query(`SELECT note.id, note.author_member_id, note.visibility, note.body, note.created_at, note.updated_at,
          author.display_name AS author_name, author.role AS author_role
        FROM lesson_notes note JOIN members author ON author.id = note.author_member_id
        WHERE note.workspace_id = $1 AND note.lesson_id = ANY($2::text[])
          AND (note.visibility = 'shared' OR note.author_member_id = $3)
          AND ($4::text IS NULL OR note.lesson_id = $4 OR author.role <> 'student')
        ORDER BY CASE note.visibility WHEN 'shared' THEN 0 ELSE 1 END, note.created_at`, [auth.workspaceId, lessonIds, auth.memberId, ownLessonId]),
      getPostgresPool().query(`SELECT homework.lesson_id, homework.assignment, homework.student_response, homework.assignment_updated_at, homework.response_updated_at,
          student.display_name AS student_name
        FROM lesson_homework homework JOIN lessons lesson ON lesson.id = homework.lesson_id JOIN members student ON student.id = lesson.student_id
        WHERE homework.workspace_id = $1 AND homework.lesson_id = ANY($2::text[]) AND ($3::text IS NULL OR homework.lesson_id IN ($3, $4))
        ORDER BY student.display_name`, [auth.workspaceId, lessonIds, ownLessonId, assignmentLessonId]),
      getPostgresPool().query(`SELECT attachment.id, attachment.uploaded_by_member_id, attachment.byte_size, attachment.width,
          attachment.height, attachment.expires_at, attachment.created_at, author.display_name AS author_name
        FROM lesson_attachments attachment
        LEFT JOIN members author ON author.id = attachment.uploaded_by_member_id
        WHERE attachment.workspace_id = $1 AND attachment.lesson_id = ANY($2::text[])
          AND attachment.status = 'active' AND attachment.expires_at > now()
          AND ($3::text IS NULL OR attachment.lesson_id = $3 OR author.role <> 'student')
        ORDER BY attachment.created_at`, [auth.workspaceId, lessonIds, ownLessonId]),
      getPostgresPool().query(`SELECT DISTINCT ON (resource.id) resource.id, resource.title, resource.original_filename, resource.content_type,
          resource.byte_size, link.created_at
        FROM lesson_resource_links link JOIN teacher_resources resource ON resource.id = link.resource_id
        WHERE link.workspace_id = $1 AND link.lesson_id = ANY($2::text[]) AND resource.status = 'active'
        ORDER BY resource.id, link.created_at`, [auth.workspaceId, lessonIds]),
      auth.role === "student" ? Promise.resolve({ rows: [] }) : getPostgresPool().query(`SELECT id, title, original_filename, content_type, byte_size, folder, tags, created_at
        FROM teacher_resources WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at DESC`, [auth.workspaceId]),
      // Audio and documents on the lesson; a student sees their own and the teacher's, like photos.
      getPostgresPool().query(`SELECT file.id, file.uploaded_by_member_id, file.content_type, file.original_filename, file.byte_size, file.expires_at, file.created_at,
          author.display_name AS author_name
        FROM lesson_files file LEFT JOIN members author ON author.id = file.uploaded_by_member_id
        WHERE file.workspace_id = $1 AND file.lesson_id = ANY($2::text[]) AND file.status = 'active' AND file.expires_at > now()
          AND ($3::text IS NULL OR file.lesson_id = $3 OR author.role <> 'student')
        ORDER BY file.created_at`, [auth.workspaceId, lessonIds, ownLessonId]),
    ]);
    return Response.json({
      contentRulesAccepted: accepted,
      contentRulesVersion: CONTENT_RULES_VERSION,
      photoStorageConfigured: lessonPhotoStorageConfigured(),
      photoRetentionDays: 90,
      maxPhotosPerParticipant: 5,
      homework: homeworkPayload(homeworkResult.rows, assignmentLessonId, lesson.session && auth.role !== "student" ? null : (ownLessonId ?? lesson.lessonId)),
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
      files: filesResult.rows.map((row) => ({
        id: String(row.id), filename: String(row.original_filename), contentType: String(row.content_type), byteSize: Number(row.byte_size),
        authorName: row.author_name ? String(row.author_name) : "Удалённый пользователь", mine: row.uploaded_by_member_id === auth.memberId,
        canDelete: row.uploaded_by_member_id === auth.memberId || auth.role !== "student",
        expiresAt: new Date(row.expires_at).getTime(), createdAt: new Date(row.created_at).getTime(),
        url: `/api/lesson-files/${encodeURIComponent(String(row.id))}`,
      })),
      documents: [...resourcesResult.rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((row) => ({
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
