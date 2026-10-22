import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin } from "@/lib/auth";
import { hasCurrentContentRulesAcceptance } from "@/lib/lesson-materials";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";
import { requireTeacher, resourceIdSchema } from "@/lib/teacher-material-library/shared";

const shareMaterialSchema = z.object({
  resourceId: resourceIdSchema,
  studentId: z.string().uuid(),
  action: z.enum(["share", "unshare"]),
}).strict();

export async function updateStudentMaterialShare(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const limited = await enforceNodeRateLimit(request, "teacher_material_share", 60, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    const body = await readLimitedJson<unknown>(request);
    if (!body.ok) return body.response;
    const parsed = shareMaterialSchema.safeParse(body.value);
    if (!parsed.success) return Response.json({ error: "Материал или ученик не выбран" }, { status: 400 });

    const { action, resourceId, studentId } = parsed.data;
    if (action === "share" && !await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
    const db = await getPostgresPool().connect();
    try {
      await db.query("BEGIN");
      const valid = await db.query(`SELECT resource.id
        FROM teacher_resources resource
        JOIN members student ON student.id = $2 AND student.workspace_id = resource.workspace_id
          AND student.role = 'student' AND student.status <> 'archived' AND student.is_trial_contact = false
        WHERE resource.id = $1 AND resource.workspace_id = $3 AND resource.status = 'active'`,
      [resourceId, studentId, auth.workspaceId]);
      if (!valid.rowCount) {
        await db.query("ROLLBACK");
        return Response.json({ error: "Материал или ученик не найден" }, { status: 404 });
      }

      if (action === "share") {
        const inserted = await db.query(`INSERT INTO student_resource_links
            (id, workspace_id, student_id, resource_id, shared_by_member_id)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (student_id, resource_id) DO NOTHING RETURNING id`,
        [randomUUID(), auth.workspaceId, studentId, resourceId, auth.memberId]);
        await db.query("UPDATE teacher_resources SET last_used_at = now() WHERE id = $1 AND workspace_id = $2", [resourceId, auth.workspaceId]);
        if (inserted.rowCount) {
          await db.query(`INSERT INTO notifications
            (id, member_id, student_id, type, title, body)
            VALUES ($1, $2, $2, 'lesson_material_added', 'Добавлен новый материал', 'Преподаватель поделился материалом из библиотеки.')`,
          [randomUUID(), studentId]);
        }
      } else {
        const removed = await db.query(`DELETE FROM student_resource_links
          WHERE workspace_id = $1 AND student_id = $2 AND resource_id = $3 RETURNING id`,
        [auth.workspaceId, studentId, resourceId]);
        if (removed.rowCount) {
          await db.query("INSERT INTO data_changes (workspace_id, audience_member_id, sections) VALUES ($1, $2, 'notifications')", [auth.workspaceId, studentId]);
        }
      }
      await db.query("COMMIT");
      return Response.json({ ok: true });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  } catch (error) {
    console.error("Failed to update direct student material share", error);
    return Response.json({ error: "Не удалось изменить доступ к материалу" }, { status: 500 });
  }
}
