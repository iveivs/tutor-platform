import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin } from "@/lib/auth";
import { requireTeacher, resourceIdSchema } from "@/lib/teacher-material-library/shared";

export async function deleteTeacherMaterialRecord(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const parsedId = resourceIdSchema.safeParse(new URL(request.url).searchParams.get("id"));
    if (!parsedId.success) return Response.json({ error: "Материал не выбран" }, { status: 400 });
    const db = await getPostgresPool().connect();
    try {
      await db.query("BEGIN");
      const result = await db.query(`UPDATE teacher_resources SET status = 'deleting', deleted_at = now(), updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND status = 'active' RETURNING id`, [parsedId.data, auth.workspaceId]);
      if (!result.rowCount) { await db.query("ROLLBACK"); return Response.json({ error: "Материал не найден" }, { status: 404 }); }
      await db.query("DELETE FROM lesson_resource_links WHERE resource_id = $1 AND workspace_id = $2", [parsedId.data, auth.workspaceId]);
      await db.query("DELETE FROM student_resource_links WHERE resource_id = $1 AND workspace_id = $2", [parsedId.data, auth.workspaceId]);
      await db.query("COMMIT");
      return Response.json({ ok: true });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { db.release(); }
  } catch (error) {
    console.error("Failed to delete teacher material", error);
    return Response.json({ error: "Не удалось удалить материал" }, { status: 500 });
  }
}
