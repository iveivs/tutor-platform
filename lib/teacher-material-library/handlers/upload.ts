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
import { parseFormMetadata, readUsage, requireTeacher } from "@/lib/teacher-material-library/shared";

export async function uploadTeacherMaterial(request: Request) {
  let uploadedObjectKey: string | null = null;
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    if (!lessonPhotoStorageConfigured()) return Response.json({ error: "Хранилище материалов ещё не настроено" }, { status: 503 });
    const limited = await enforceNodeRateLimit(request, "teacher_material_upload", 10, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > MAX_TEACHER_MATERIAL_BYTES + 256 * 1024) return Response.json({ error: "Файл должен быть не больше 25 МБ" }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Проверьте файл и название" }, { status: 400 });
    if (file.size < 1 || file.size > MAX_TEACHER_MATERIAL_BYTES) return Response.json({ error: "Файл должен быть не больше 25 МБ" }, { status: 413 });
    const sourceFilename = sanitizeMaterialFilename(file.name);
    const metadata = parseFormMetadata(form, sourceFilename);
    if (!metadata) return Response.json({ error: "Проверьте название, папку и теги" }, { status: 400 });
    const sourceBody = new Uint8Array(await file.arrayBuffer());
    const image = await optimizeTeacherMaterialImage(sourceFilename, sourceBody);
    const detected = image ?? detectTeacherMaterial(sourceFilename, sourceBody);
    if (!detected) return Response.json({ error: "Можно загрузить только корректный PDF, DOC, DOCX, JPEG, PNG, WebP или MP3 до 20 МБ" }, { status: 415 });
    const body = image?.body ?? sourceBody;
    const filename = image?.filename ?? sourceFilename;
    const contentSha256 = createHash("sha256").update(body).digest("hex");
    const resourceId = randomUUID();
    const objectKey = teacherMaterialObjectKey(auth.workspaceId, resourceId, detected.extension);
    const db = await getPostgresPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`teacher-materials:${auth.workspaceId}`]);
      const [limits, duplicate] = await Promise.all([
        readUsage(db, auth.workspaceId),
        db.query("SELECT id FROM teacher_resources WHERE workspace_id = $1 AND content_sha256 = $2 AND status = 'active' LIMIT 1", [auth.workspaceId, contentSha256]),
      ]);
      if (duplicate.rowCount) { await db.query("ROLLBACK"); return Response.json({ error: "Такой файл уже есть в библиотеке" }, { status: 409 }); }
      if (Number(limits.rows[0]?.uploads_this_month ?? 0) >= MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH) { await db.query("ROLLBACK"); return Response.json({ error: "Достигнут лимит: 50 загрузок за календарный месяц" }, { status: 429 }); }
      if (Number(limits.rows[0]?.storage_bytes ?? 0) + body.byteLength > MAX_WORKSPACE_MATERIAL_BYTES) { await db.query("ROLLBACK"); return Response.json({ error: "В библиотеке достигнут лимит хранения 5 ГБ" }, { status: 409 }); }
      await putTeacherMaterial(objectKey, body, detected.contentType, contentSha256);
      uploadedObjectKey = objectKey;
      await db.query(`INSERT INTO teacher_resources
        (id, workspace_id, uploaded_by_member_id, title, original_filename, object_key, content_type, content_sha256, byte_size, folder, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [resourceId, auth.workspaceId, auth.memberId, metadata.title, filename, objectKey, detected.contentType, contentSha256, body.byteLength, metadata.folder, metadata.tags]);
      await db.query(`INSERT INTO teacher_resource_upload_events
        (id, workspace_id, resource_id, version_number, original_filename, content_type, content_sha256, byte_size)
        VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
      [randomUUID(), auth.workspaceId, resourceId, filename, detected.contentType, contentSha256, body.byteLength]);
      await db.query("COMMIT");
      uploadedObjectKey = null;
      return Response.json({ ok: true, id: resourceId });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { db.release(); }
  } catch (error) {
    if (uploadedObjectKey) await deleteTeacherMaterial(uploadedObjectKey).catch(() => undefined);
    console.error("Failed to upload teacher material", error);
    return Response.json({ error: "Не удалось загрузить материал" }, { status: 500 });
  }
}
