import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import {
  deleteTeacherMaterial, hasCurrentContentRulesAcceptance, lessonPhotoStorageConfigured,
  putTeacherMaterial, teacherMaterialObjectKey,
} from "@/lib/lesson-materials";
import {
  defaultMaterialTitle, detectTeacherMaterial, MAX_TEACHER_MATERIAL_BYTES,
  MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH, MAX_WORKSPACE_MATERIAL_BYTES, sanitizeMaterialFilename,
} from "@/lib/teacher-material-files";

export const runtime = "nodejs";

const resourceIdSchema = z.string().uuid();

async function requireTeacher(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (auth.role === "student") return Response.json({ error: "Библиотека доступна только преподавателю" }, { status: 403 });
  return auth;
}

export async function GET(request: Request) {
  try {
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const [accepted, resources, usage] = await Promise.all([
      hasCurrentContentRulesAcceptance(auth),
      getPostgresPool().query(`SELECT id, title, original_filename, content_type, byte_size, created_at,
          (SELECT count(*)::int FROM lesson_resource_links link WHERE link.resource_id = resource.id) AS lesson_count
        FROM teacher_resources resource
        WHERE workspace_id = $1 AND status = 'active'
        ORDER BY created_at DESC`, [auth.workspaceId]),
      getPostgresPool().query(`SELECT
          COALESCE(sum(byte_size) FILTER (WHERE status = 'active'), 0)::bigint AS storage_bytes,
          count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS uploads_this_month
        FROM teacher_resources WHERE workspace_id = $1`, [auth.workspaceId]),
    ]);
    return Response.json({
      contentRulesAccepted: accepted,
      storageConfigured: lessonPhotoStorageConfigured(),
      maxFileBytes: MAX_TEACHER_MATERIAL_BYTES,
      maxUploadsPerMonth: MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH,
      maxStorageBytes: MAX_WORKSPACE_MATERIAL_BYTES,
      uploadsThisMonth: Number(usage.rows[0]?.uploads_this_month ?? 0),
      storageBytes: Number(usage.rows[0]?.storage_bytes ?? 0),
      resources: resources.rows.map((row) => ({
        id: String(row.id), title: String(row.title), filename: String(row.original_filename), contentType: String(row.content_type),
        byteSize: Number(row.byte_size), lessonCount: Number(row.lesson_count), createdAt: new Date(row.created_at).getTime(),
        url: `/api/teacher-materials/${encodeURIComponent(String(row.id))}`,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to read teacher materials", error);
    return Response.json({ error: "Не удалось загрузить библиотеку" }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    if (contentLength && contentLength > MAX_TEACHER_MATERIAL_BYTES + 128 * 1024) return Response.json({ error: "Документ должен быть не больше 25 МБ" }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    const requestedTitle = form.get("title");
    if (!(file instanceof File) || typeof requestedTitle !== "string") return Response.json({ error: "Проверьте документ и название" }, { status: 400 });
    if (file.size < 1 || file.size > MAX_TEACHER_MATERIAL_BYTES) return Response.json({ error: "Документ должен быть не больше 25 МБ" }, { status: 413 });
    const filename = sanitizeMaterialFilename(file.name);
    const body = new Uint8Array(await file.arrayBuffer());
    const detected = detectTeacherMaterial(filename, body);
    if (!detected) return Response.json({ error: "Можно загрузить только корректный PDF, DOC или DOCX" }, { status: 415 });
    const title = (requestedTitle.trim() || defaultMaterialTitle(filename)).slice(0, 120);
    if (!title) return Response.json({ error: "Укажите название материала" }, { status: 400 });
    const contentSha256 = createHash("sha256").update(body).digest("hex");
    const resourceId = randomUUID();
    const objectKey = teacherMaterialObjectKey(auth.workspaceId, resourceId, detected.extension);
    const db = await getPostgresPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`teacher-materials:${auth.workspaceId}`]);
      const [limits, duplicate] = await Promise.all([
        db.query(`SELECT
            COALESCE(sum(byte_size) FILTER (WHERE status = 'active'), 0)::bigint AS storage_bytes,
            count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS uploads_this_month
          FROM teacher_resources WHERE workspace_id = $1`, [auth.workspaceId]),
        db.query("SELECT id FROM teacher_resources WHERE workspace_id = $1 AND content_sha256 = $2 AND status = 'active' LIMIT 1", [auth.workspaceId, contentSha256]),
      ]);
      if (duplicate.rowCount) {
        await db.query("ROLLBACK");
        return Response.json({ error: "Такой документ уже есть в библиотеке" }, { status: 409 });
      }
      if (Number(limits.rows[0]?.uploads_this_month ?? 0) >= MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH) {
        await db.query("ROLLBACK");
        return Response.json({ error: "Достигнут лимит: 50 новых документов за календарный месяц" }, { status: 429 });
      }
      if (Number(limits.rows[0]?.storage_bytes ?? 0) + body.byteLength > MAX_WORKSPACE_MATERIAL_BYTES) {
        await db.query("ROLLBACK");
        return Response.json({ error: "В библиотеке достигнут лимит хранения 5 ГБ" }, { status: 409 });
      }
      await putTeacherMaterial(objectKey, body, detected.contentType, contentSha256);
      uploadedObjectKey = objectKey;
      await db.query(`INSERT INTO teacher_resources
        (id, workspace_id, uploaded_by_member_id, title, original_filename, object_key, content_type, content_sha256, byte_size)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [resourceId, auth.workspaceId, auth.memberId, title, filename, objectKey, detected.contentType, contentSha256, body.byteLength]);
      await db.query("COMMIT");
      uploadedObjectKey = null;
      return Response.json({ ok: true, id: resourceId });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  } catch (error) {
    if (uploadedObjectKey) await deleteTeacherMaterial(uploadedObjectKey).catch(() => undefined);
    console.error("Failed to upload teacher material", error);
    return Response.json({ error: "Не удалось загрузить документ" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
      if (!result.rowCount) {
        await db.query("ROLLBACK");
        return Response.json({ error: "Материал не найден" }, { status: 404 });
      }
      await db.query("DELETE FROM lesson_resource_links WHERE resource_id = $1 AND workspace_id = $2", [parsedId.data, auth.workspaceId]);
      await db.query("COMMIT");
      return Response.json({ ok: true });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  } catch (error) {
    console.error("Failed to delete teacher material", error);
    return Response.json({ error: "Не удалось удалить материал" }, { status: 500 });
  }
}
