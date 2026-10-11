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
const metadataSchema = z.object({
  id: resourceIdSchema,
  title: z.string().trim().min(1).max(120),
  folder: z.string().trim().max(80).nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
}).strict();

async function requireTeacher(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (auth.role === "student") return Response.json({ error: "Библиотека доступна только преподавателю" }, { status: 403 });
  return auth;
}

function normalizeTags(values: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const tag = raw.trim().replace(/^#+/, "");
    const key = tag.toLocaleLowerCase("ru-RU");
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function parseFormMetadata(form: FormData, filename: string) {
  const rawTitle = form.get("title");
  const rawFolder = form.get("folder");
  const rawTags = form.get("tags");
  if (typeof rawTitle !== "string" || rawFolder !== null && typeof rawFolder !== "string" || rawTags !== null && typeof rawTags !== "string") return null;
  const title = (rawTitle.trim() || defaultMaterialTitle(filename)).slice(0, 120);
  const folder = rawFolder?.trim() || null;
  let tagValues: unknown = [];
  try { tagValues = rawTags ? JSON.parse(rawTags) : []; } catch { return null; }
  if (!Array.isArray(tagValues) || tagValues.some((tag) => typeof tag !== "string")) return null;
  const parsed = metadataSchema.omit({ id: true }).safeParse({ title, folder, tags: normalizeTags(tagValues as string[]) });
  return parsed.success ? parsed.data : null;
}

function materialPayload(row: Record<string, unknown>) {
  const assignments = Array.isArray(row.assignments) ? row.assignments : [];
  return {
    id: String(row.id), title: String(row.title), filename: String(row.original_filename),
    contentType: String(row.content_type), byteSize: Number(row.byte_size),
    folder: row.folder ? String(row.folder) : null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    versionNumber: Number(row.version_number), lessonCount: assignments.length,
    assignments: assignments.map((assignment) => {
      const item = assignment as Record<string, unknown>;
      return { lessonId: String(item.lessonId), studentId: String(item.studentId), studentName: String(item.studentName), startsAt: new Date(String(item.startsAt)).getTime() };
    }),
    createdAt: new Date(String(row.created_at)).getTime(),
    updatedAt: new Date(String(row.updated_at)).getTime(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).getTime() : null,
    url: `/api/teacher-materials/${encodeURIComponent(String(row.id))}`,
  };
}

async function readUsage(db: Pick<ReturnType<typeof getPostgresPool>, "query">, workspaceId: string) {
  return db.query(`SELECT
    (SELECT COALESCE(sum(byte_size), 0)::bigint FROM teacher_resources WHERE workspace_id = $1 AND status = 'active') AS storage_bytes,
    (SELECT count(*)::int FROM teacher_resource_upload_events WHERE workspace_id = $1 AND created_at >= date_trunc('month', now())) AS uploads_this_month`, [workspaceId]);
}

export async function GET(request: Request) {
  try {
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const [accepted, resources, usage] = await Promise.all([
      hasCurrentContentRulesAcceptance(auth),
      getPostgresPool().query(`SELECT resource.id, resource.title, resource.original_filename, resource.content_type,
          resource.byte_size, resource.folder, resource.tags, resource.version_number, resource.last_used_at,
          resource.created_at, resource.updated_at,
          COALESCE((SELECT json_agg(json_build_object(
            'lessonId', link.lesson_id, 'studentId', lesson.student_id,
            'studentName', student.display_name, 'startsAt', lesson.starts_at
          ) ORDER BY lesson.starts_at DESC)
          FROM lesson_resource_links link
          JOIN lessons lesson ON lesson.id = link.lesson_id AND lesson.workspace_id = resource.workspace_id
          JOIN members student ON student.id = lesson.student_id
          WHERE link.resource_id = resource.id), '[]'::json) AS assignments
        FROM teacher_resources resource
        WHERE resource.workspace_id = $1 AND resource.status = 'active'
        ORDER BY COALESCE(resource.last_used_at, resource.created_at) DESC`, [auth.workspaceId]),
      readUsage(getPostgresPool(), auth.workspaceId),
    ]);
    return Response.json({
      contentRulesAccepted: accepted,
      storageConfigured: lessonPhotoStorageConfigured(),
      maxFileBytes: MAX_TEACHER_MATERIAL_BYTES,
      maxUploadsPerMonth: MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH,
      maxStorageBytes: MAX_WORKSPACE_MATERIAL_BYTES,
      uploadsThisMonth: Number(usage.rows[0]?.uploads_this_month ?? 0),
      storageBytes: Number(usage.rows[0]?.storage_bytes ?? 0),
      resources: resources.rows.map(materialPayload),
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
    if (contentLength && contentLength > MAX_TEACHER_MATERIAL_BYTES + 256 * 1024) return Response.json({ error: "Документ должен быть не больше 25 МБ" }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Проверьте документ и название" }, { status: 400 });
    if (file.size < 1 || file.size > MAX_TEACHER_MATERIAL_BYTES) return Response.json({ error: "Документ должен быть не больше 25 МБ" }, { status: 413 });
    const filename = sanitizeMaterialFilename(file.name);
    const metadata = parseFormMetadata(form, filename);
    if (!metadata) return Response.json({ error: "Проверьте название, папку и теги" }, { status: 400 });
    const body = new Uint8Array(await file.arrayBuffer());
    const detected = detectTeacherMaterial(filename, body);
    if (!detected) return Response.json({ error: "Можно загрузить только корректный PDF, DOC или DOCX" }, { status: 415 });
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
      if (duplicate.rowCount) { await db.query("ROLLBACK"); return Response.json({ error: "Такой документ уже есть в библиотеке" }, { status: 409 }); }
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
    return Response.json({ error: "Не удалось загрузить документ" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const limited = await enforceNodeRateLimit(request, "teacher_material_metadata", 60, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
    const raw = await request.json().catch(() => null);
    const candidate = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const parsed = metadataSchema.safeParse({
      ...candidate,
      folder: typeof candidate.folder === "string" ? candidate.folder.trim() || null : candidate.folder ?? null,
      tags: Array.isArray(candidate.tags) && candidate.tags.every((tag) => typeof tag === "string") ? normalizeTags(candidate.tags as string[]) : candidate.tags,
    });
    if (!parsed.success) return Response.json({ error: "Проверьте название, папку и теги" }, { status: 400 });
    const result = await getPostgresPool().query(`UPDATE teacher_resources SET title = $3, folder = $4, tags = $5, updated_at = now()
      WHERE id = $1 AND workspace_id = $2 AND status = 'active' RETURNING id`,
    [parsed.data.id, auth.workspaceId, parsed.data.title, parsed.data.folder, parsed.data.tags]);
    if (!result.rowCount) return Response.json({ error: "Материал не найден" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to update teacher material metadata", error);
    return Response.json({ error: "Не удалось обновить материал" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
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
    if (contentLength && contentLength > MAX_TEACHER_MATERIAL_BYTES + 128 * 1024) return Response.json({ error: "Документ должен быть не больше 25 МБ" }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_TEACHER_MATERIAL_BYTES) return Response.json({ error: "Документ должен быть не больше 25 МБ" }, { status: 413 });
    const filename = sanitizeMaterialFilename(file.name);
    const body = new Uint8Array(await file.arrayBuffer());
    const detected = detectTeacherMaterial(filename, body);
    if (!detected) return Response.json({ error: "Можно загрузить только корректный PDF, DOC или DOCX" }, { status: 415 });
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
      if (!result.rowCount) { await db.query("ROLLBACK"); return Response.json({ error: "Материал не найден" }, { status: 404 }); }
      await db.query("DELETE FROM lesson_resource_links WHERE resource_id = $1 AND workspace_id = $2", [parsedId.data, auth.workspaceId]);
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
