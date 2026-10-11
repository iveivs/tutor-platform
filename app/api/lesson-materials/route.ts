import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { CONTENT_RULES_VERSION } from "@/lib/legal-consent";
import { hasCurrentContentRulesAcceptance, lessonPhotoStorageConfigured, MAX_NOTE_LENGTH, resolveLessonAccess } from "@/lib/lesson-materials";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

const lessonIdSchema = z.string().min(1).max(128);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acceptContentRules"), accepted: z.literal(true) }).strict(),
  z.object({ action: z.literal("upsertNote"), lessonId: lessonIdSchema, visibility: z.enum(["shared", "teacher_private"]), body: z.string().trim().min(1).max(MAX_NOTE_LENGTH) }).strict(),
  z.object({ action: z.literal("deleteNote"), noteId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("deleteAttachment"), attachmentId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("attachResource"), lessonId: lessonIdSchema, resourceId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("detachResource"), lessonId: lessonIdSchema, resourceId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("updateHomework"), lessonId: lessonIdSchema, field: z.enum(["assignment", "student_response"]), body: z.string().max(MAX_NOTE_LENGTH) }).strict(),
]);

async function requireAuth(request: Request) {
  const auth = await getAuthMember(request);
  return auth ?? Response.json({ error: "Требуется вход" }, { status: 401 });
}

export async function GET(request: Request) {
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
      auth.role === "student" ? Promise.resolve({ rows: [] }) : getPostgresPool().query(`SELECT id, title, original_filename, content_type, byte_size, created_at
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
        byteSize: Number(row.byte_size), createdAt: new Date(row.created_at).getTime(),
        url: `/api/teacher-materials/${encodeURIComponent(String(row.id))}`,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load lesson materials", error);
    return Response.json({ error: "Не удалось загрузить материалы урока" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const limited = await enforceNodeRateLimit(request, "lesson_materials_write", 20, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    const json = await readLimitedJson<unknown>(request);
    if (!json.ok) return json.response;
    const parsed = actionSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "Проверьте данные" }, { status: 400 });
    const body = parsed.data;
    if (body.action === "acceptContentRules") {
      await getPostgresPool().query(`INSERT INTO legal_acceptances
        (id, user_id, workspace_id, member_id, document_type, document_version, source, user_agent)
        SELECT $1, $2, $3, $4, 'content_rules', $5, 'in_app', $6
        WHERE NOT EXISTS (SELECT 1 FROM legal_acceptances WHERE user_id = $2 AND member_id = $4 AND document_type = 'content_rules' AND document_version = $5)`,
      [randomUUID(), auth.userId, auth.workspaceId, auth.memberId, CONTENT_RULES_VERSION, request.headers.get("user-agent")?.slice(0, 512) ?? null]);
      return Response.json({ ok: true });
    }
    if (body.action === "upsertNote") {
      if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
      if (auth.role === "student" && body.visibility !== "shared") return Response.json({ error: "Ученику доступна только общая заметка" }, { status: 403 });
      const lesson = await resolveLessonAccess(auth, body.lessonId);
      if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
      const noteLimited = await enforceNodeRateLimit(request, "lesson_note_write", 10, `${auth.workspaceId}:${auth.memberId}`);
      if (noteLimited) return noteLimited;
      const result = await getPostgresPool().query(`INSERT INTO lesson_notes
          (id, workspace_id, lesson_id, author_member_id, visibility, body)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (lesson_id, author_member_id, visibility) DO UPDATE
          SET body = EXCLUDED.body, updated_at = now()
        RETURNING id`, [randomUUID(), auth.workspaceId, lesson.lessonId, auth.memberId, body.visibility, body.body]);
      return Response.json({ ok: true, id: String(result.rows[0].id) });
    }
    if (body.action === "updateHomework") {
      if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
      if (auth.role === "student" && body.field !== "student_response") return Response.json({ error: "Задание может изменять только преподаватель" }, { status: 403 });
      if (auth.role !== "student" && body.field !== "assignment") return Response.json({ error: "Ответ изменяет ученик" }, { status: 403 });
      const lesson = await resolveLessonAccess(auth, body.lessonId);
      if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
      const value = body.body.trim();
      const db = getPostgresPool();
      if (!value) {
        if (body.field === "assignment") {
          await db.query("DELETE FROM lesson_homework WHERE workspace_id = $1 AND lesson_id = $2 AND student_response IS NULL", [auth.workspaceId, lesson.lessonId]);
          await db.query("UPDATE lesson_homework SET assignment = NULL, assignment_updated_by_member_id = $3, assignment_updated_at = now(), updated_at = now() WHERE workspace_id = $1 AND lesson_id = $2 AND student_response IS NOT NULL", [auth.workspaceId, lesson.lessonId, auth.memberId]);
        } else {
          await db.query("DELETE FROM lesson_homework WHERE workspace_id = $1 AND lesson_id = $2 AND assignment IS NULL", [auth.workspaceId, lesson.lessonId]);
          await db.query("UPDATE lesson_homework SET student_response = NULL, response_updated_by_member_id = $3, response_updated_at = now(), updated_at = now() WHERE workspace_id = $1 AND lesson_id = $2 AND assignment IS NOT NULL", [auth.workspaceId, lesson.lessonId, auth.memberId]);
        }
      } else if (body.field === "assignment") {
        await db.query(`INSERT INTO lesson_homework
            (id, workspace_id, lesson_id, assignment, assignment_updated_by_member_id, assignment_updated_at)
          VALUES ($1, $2, $3, $4, $5, now())
          ON CONFLICT (lesson_id) DO UPDATE SET assignment = EXCLUDED.assignment,
            assignment_updated_by_member_id = EXCLUDED.assignment_updated_by_member_id, assignment_updated_at = now(), updated_at = now()`,
        [randomUUID(), auth.workspaceId, lesson.lessonId, value, auth.memberId]);
      } else {
        await db.query(`INSERT INTO lesson_homework
            (id, workspace_id, lesson_id, student_response, response_updated_by_member_id, response_updated_at)
          VALUES ($1, $2, $3, $4, $5, now())
          ON CONFLICT (lesson_id) DO UPDATE SET student_response = EXCLUDED.student_response,
            response_updated_by_member_id = EXCLUDED.response_updated_by_member_id, response_updated_at = now(), updated_at = now()`,
        [randomUUID(), auth.workspaceId, lesson.lessonId, value, auth.memberId]);
      }
      return Response.json({ ok: true });
    }
    if (body.action === "deleteNote") {
      const result = await getPostgresPool().query(`DELETE FROM lesson_notes note USING lessons lesson
        WHERE note.id = $1 AND note.lesson_id = lesson.id AND note.workspace_id = $2
          AND ($3 = note.author_member_id OR ($4 <> 'student' AND note.visibility = 'shared'))
          AND ($4 <> 'student' OR lesson.student_id = $3)
        RETURNING note.id`, [body.noteId, auth.workspaceId, auth.memberId, auth.role]);
      if (!result.rowCount) return Response.json({ error: "Заметка не найдена или недоступна" }, { status: 404 });
      return Response.json({ ok: true });
    }
    if (body.action === "attachResource" || body.action === "detachResource") {
      if (auth.role === "student") return Response.json({ error: "Только преподаватель может прикреплять документы" }, { status: 403 });
      if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
      const lesson = await resolveLessonAccess(auth, body.lessonId);
      if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
      if (body.action === "attachResource") {
        const result = await getPostgresPool().query(`INSERT INTO lesson_resource_links
            (id, workspace_id, lesson_id, resource_id, shared_by_member_id)
          SELECT $1, $2, $3, resource.id, $5 FROM teacher_resources resource
          WHERE resource.id = $4 AND resource.workspace_id = $2 AND resource.status = 'active'
          ON CONFLICT (lesson_id, resource_id) DO NOTHING RETURNING id`,
        [randomUUID(), auth.workspaceId, lesson.lessonId, body.resourceId, auth.memberId]);
        if (!result.rowCount) {
          const exists = await getPostgresPool().query("SELECT 1 FROM teacher_resources WHERE id = $1 AND workspace_id = $2 AND status = 'active'", [body.resourceId, auth.workspaceId]);
          if (!exists.rowCount) return Response.json({ error: "Материал не найден" }, { status: 404 });
        }
        await getPostgresPool().query("UPDATE teacher_resources SET last_used_at = now() WHERE id = $1 AND workspace_id = $2 AND status = 'active'", [body.resourceId, auth.workspaceId]);
      } else {
        await getPostgresPool().query(`DELETE FROM lesson_resource_links
          WHERE workspace_id = $1 AND lesson_id = $2 AND resource_id = $3`, [auth.workspaceId, lesson.lessonId, body.resourceId]);
      }
      return Response.json({ ok: true });
    }
    const result = await getPostgresPool().query(`UPDATE lesson_attachments attachment SET status = 'deleting', deleted_at = now(), updated_at = now()
      FROM lessons lesson
      WHERE attachment.id = $1 AND attachment.lesson_id = lesson.id AND attachment.workspace_id = $2 AND attachment.status = 'active'
        AND ($3 = attachment.uploaded_by_member_id OR $4 <> 'student')
        AND ($4 <> 'student' OR lesson.student_id = $3)
      RETURNING attachment.id`, [body.attachmentId, auth.workspaceId, auth.memberId, auth.role]);
    if (!result.rowCount) return Response.json({ error: "Фотография не найдена или недоступна" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to update lesson materials", error);
    return Response.json({ error: "Не удалось сохранить материалы урока" }, { status: 500 });
  }
}
