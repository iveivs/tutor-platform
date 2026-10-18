import { createHash, randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin } from "@/lib/auth";
import {
  deleteTeacherMaterial,
  hasCurrentContentRulesAcceptance,
  lessonPhotoStorageConfigured,
  putTeacherMaterial,
  teacherMaterialObjectKey,
} from "@/lib/lesson-materials";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import {
  detectTeacherMaterial,
  MAX_TEACHER_MATERIAL_BYTES,
  MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH,
  MAX_WORKSPACE_MATERIAL_BYTES,
  sanitizeMaterialFilename,
} from "@/lib/teacher-material-files";
import { optimizeTeacherMaterialImage } from "@/lib/teacher-material-image";
import { readUsage, requireTeacher, resourceIdSchema } from "@/lib/teacher-material-library/shared";

export async function replaceTeacherMaterial(request: Request) {
  let uploadedObjectKey: string | null = null;
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    if (!lessonPhotoStorageConfigured()) return Response.json({ error: "Хранилище материалов ещё не настроено" }, { status: 503 });
    const limited = await enforceNodeRateLimit(request, "teacher_material_upload", 10, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
    const parsedId = resourceIdSchema.safeParse(new URL(request.url).searchParams.get("id"));
    if (!parsedId.success) return Response.json({ error: "Материал не выбран" }, { status: 400 });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > MAX_TEACHER_MATERIAL_BYTES + 128 * 1024) return Response.json({ error: "Файл должен быть не больше 25 МБ" }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_TEACHER_MATERIAL_BYTES) return Response.json({ error: "Файл должен быть не больше 25 МБ" }, { status: 413 });
    const sourceFilename = sanitizeMaterialFilename(file.name);
    const sourceBody = new Uint8Array(await file.arrayBuffer());
    const image = await optimizeTeacherMaterialImage(sourceFilename, sourceBody);
    const detected = image ?? detectTeacherMaterial(sourceFilename, sourceBody);
    if (!detected) return Response.json({ error: "Можно загрузить только корректный PDF, DOC, DOCX, JPEG, PNG или WebP" }, { status: 415 });
    const body = image?.body ?? sourceBody;
    const filename = image?.filename ?? sourceFilename;
    const contentSha256 = createHash("sha256").update(body).digest("hex");
    const objectKey = teacherMaterialObjectKey(auth.workspaceId, randomUUID(), detected.extension);
    const db = await getPostgresPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`teacher-materials:${auth.workspaceId}`]);
      const current = await db.query(`SELECT object_key, byte_size, content_sha256, version_number FROM teacher_resources
        WHERE id = $1 AND workspace_id = $2 AND status = 'active' FOR UPDATE`, [parsedId.data, auth.workspaceId]);
      if (!current.rowCount) { await db.query("ROLLBACK"); return Response.json({ error: "Материал не найден" }, { status: 404 }); }
      if (String(current.rows[0].content_sha256) === contentSha256) { await db.query("ROLLBACK"); return Response.json({ error: "Выбранная версия совпадает с текущей" }, { status: 409 }); }
      const [limits, duplicate] = await Promise.all([
        readUsage(db, auth.workspaceId),
        db.query("SELECT id FROM teacher_resources WHERE workspace_id = $1 AND content_sha256 = $2 AND status = 'active' AND id <> $3 LIMIT 1", [auth.workspaceId, contentSha256, parsedId.data]),
      ]);
      if (duplicate.rowCount) { await db.query("ROLLBACK"); return Response.json({ error: "Такая версия уже хранится в другом материале" }, { status: 409 }); }
      if (Number(limits.rows[0]?.uploads_this_month ?? 0) >= MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH) { await db.query("ROLLBACK"); return Response.json({ error: "Достигнут лимит: 50 загрузок за календарный месяц" }, { status: 429 }); }
      const projectedBytes = Number(limits.rows[0]?.storage_bytes ?? 0) - Number(current.rows[0].byte_size) + body.byteLength;
      if (projectedBytes > MAX_WORKSPACE_MATERIAL_BYTES) { await db.query("ROLLBACK"); return Response.json({ error: "В библиотеке достигнут лимит хранения 5 ГБ" }, { status: 409 }); }
      await putTeacherMaterial(objectKey, body, detected.contentType, contentSha256);
      uploadedObjectKey = objectKey;
      const nextVersion = Number(current.rows[0].version_number) + 1;
      await db.query(`UPDATE teacher_resources SET original_filename = $3, object_key = $4, content_type = $5,
          content_sha256 = $6, byte_size = $7, version_number = $8, updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [parsedId.data, auth.workspaceId, filename, objectKey, detected.contentType, contentSha256, body.byteLength, nextVersion]);
      await db.query(`INSERT INTO teacher_resource_upload_events
        (id, workspace_id, resource_id, version_number, original_filename, content_type, content_sha256, byte_size)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), auth.workspaceId, parsedId.data, nextVersion, filename, detected.contentType, contentSha256, body.byteLength]);
      await db.query("INSERT INTO teacher_resource_file_cleanup (id, object_key) VALUES ($1, $2) ON CONFLICT (object_key) DO NOTHING", [randomUUID(), current.rows[0].object_key]);
      await db.query("COMMIT");
      uploadedObjectKey = null;
      return Response.json({ ok: true, versionNumber: nextVersion });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { db.release(); }
  } catch (error) {
    if (uploadedObjectKey) await deleteTeacherMaterial(uploadedObjectKey).catch(() => undefined);
    console.error("Failed to replace teacher material", error);
    return Response.json({ error: "Не удалось заменить файл" }, { status: 500 });
  }
}
