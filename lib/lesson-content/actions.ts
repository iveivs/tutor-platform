import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { CONTENT_RULES_VERSION } from "@/lib/legal-consent";
import { hasCurrentContentRulesAcceptance, notifyLessonStudents, resolveLessonAccess, sessionLessonIds } from "@/lib/lesson-materials";
import type { LessonContentAction, LessonContentAuth } from "@/lib/lesson-content/shared";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";

export async function executeLessonContentAction({
  request,
  auth,
  body,
}: {
  request: Request;
  auth: LessonContentAuth;
  body: LessonContentAction;
}): Promise<Response> {
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
      if (value && body.field === "assignment") {
        await notifyLessonStudents(auth.workspaceId, lesson, "homework_updated", "Новое домашнее задание", "Преподаватель добавил или обновил домашнее задание к уроку.");
      } else if (value && body.field === "student_response") {
        await db.query(`INSERT INTO notifications
          (id, member_id, student_id, lesson_id, type, title, body)
          SELECT $1, teacher.id, $2, $3, 'homework_response_updated', 'Новый ответ на домашнее задание', 'Ученик добавил или обновил ответ к уроку.'
          FROM members teacher
          WHERE teacher.workspace_id = $4 AND teacher.role = 'owner' AND teacher.status = 'active'
          ORDER BY teacher.created_at LIMIT 1`,
        [randomUUID(), lesson.studentId, lesson.lessonId, auth.workspaceId]);
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
        if (result.rowCount) {
          await notifyLessonStudents(auth.workspaceId, lesson, "lesson_material_added", "Добавлен материал к уроку", "Преподаватель поделился новым материалом.");
        }
      } else {
        await getPostgresPool().query(`DELETE FROM lesson_resource_links
          WHERE workspace_id = $1 AND lesson_id = ANY($2::text[]) AND resource_id = $3`, [auth.workspaceId, await sessionLessonIds(auth.workspaceId, lesson), body.resourceId]);
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
}
