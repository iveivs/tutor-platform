import { randomUUID } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import {
  deleteLessonPhoto, hasCurrentContentRulesAcceptance, lessonPhotoObjectKey, lessonPhotoStorageConfigured,
  MAX_PHOTO_INPUT_BYTES, MAX_PHOTOS_PER_LESSON_MEMBER, MAX_WORKSPACE_PHOTO_BYTES, photoExpiresAt,
  putLessonPhoto, resolveLessonAccess,
} from "@/lib/lesson-materials";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let uploadedObjectKey: string | null = null;
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    if (!lessonPhotoStorageConfigured()) return Response.json({ error: "Хранилище фотографий ещё не настроено" }, { status: 503 });
    const limited = await enforceNodeRateLimit(request, "lesson_photo_upload", 10, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > MAX_PHOTO_INPUT_BYTES + 64 * 1024) return Response.json({ error: "Фотография должна быть не больше 5 МБ" }, { status: 413 });
    const form = await request.formData();
    const lessonId = form.get("lessonId");
    const file = form.get("file");
    if (typeof lessonId !== "string" || lessonId.length < 1 || lessonId.length > 128 || !(file instanceof File)) return Response.json({ error: "Проверьте файл и урок" }, { status: 400 });
    if (file.size < 1 || file.size > MAX_PHOTO_INPUT_BYTES) return Response.json({ error: "Фотография должна быть не больше 5 МБ" }, { status: 413 });
    if (!file.type.startsWith("image/")) return Response.json({ error: "Можно загрузить только изображение" }, { status: 415 });
    const lesson = await resolveLessonAccess(auth, lessonId);
    if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
    const expiresAt = photoExpiresAt(lesson.endsAt);
    if (expiresAt <= new Date()) return Response.json({ error: "Для этого урока срок хранения фотографий уже истёк" }, { status: 409 });

    let processed: { data: Buffer; info: OutputInfo };
    try {
      processed = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "warning", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 2_000, height: 2_000, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      return Response.json({ error: "Изображение повреждено или имеет неподдерживаемый формат" }, { status: 415 });
    }
    if (!processed.info.width || !processed.info.height || processed.data.byteLength > MAX_PHOTO_INPUT_BYTES) return Response.json({ error: "Не удалось безопасно подготовить изображение" }, { status: 413 });

    const hourly = await getPostgresPool().query(`SELECT count(*)::int AS count FROM lesson_attachments
      WHERE workspace_id = $1 AND uploaded_by_member_id = $2 AND created_at > now() - interval '1 hour'`, [auth.workspaceId, auth.memberId]);
    if (Number(hourly.rows[0]?.count ?? 0) >= 20) return Response.json({ error: "За час можно загрузить не более 20 фотографий" }, { status: 429, headers: { "Retry-After": "3600" } });

    const attachmentId = randomUUID();
    const objectKey = lessonPhotoObjectKey(auth.workspaceId, lesson.lessonId, attachmentId);
    const db = await getPostgresPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`lesson-photos:${lesson.lessonId}:${auth.memberId}`]);
      const [countResult, storageResult] = await Promise.all([
        db.query(`SELECT count(*)::int AS count FROM lesson_attachments
          WHERE lesson_id = $1 AND uploaded_by_member_id = $2 AND status = 'active' AND expires_at > now()`, [lesson.lessonId, auth.memberId]),
        db.query(`SELECT COALESCE(sum(byte_size), 0)::bigint AS bytes FROM lesson_attachments
          WHERE workspace_id = $1 AND status = 'active' AND expires_at > now()`, [auth.workspaceId]),
      ]);
      if (Number(countResult.rows[0]?.count ?? 0) >= MAX_PHOTOS_PER_LESSON_MEMBER) {
        await db.query("ROLLBACK");
        return Response.json({ error: "К одному уроку можно добавить не более 5 фотографий от каждого участника" }, { status: 409 });
      }
      if (Number(storageResult.rows[0]?.bytes ?? 0) + processed.data.byteLength > MAX_WORKSPACE_PHOTO_BYTES) {
        await db.query("ROLLBACK");
        return Response.json({ error: "В кабинете достигнут лимит хранения фотографий" }, { status: 409 });
      }
      await putLessonPhoto(objectKey, processed.data);
      uploadedObjectKey = objectKey;
      await db.query(`INSERT INTO lesson_attachments
        (id, workspace_id, lesson_id, uploaded_by_member_id, object_key, content_type, byte_size, width, height, expires_at)
        VALUES ($1, $2, $3, $4, $5, 'image/webp', $6, $7, $8, $9)`,
      [attachmentId, auth.workspaceId, lesson.lessonId, auth.memberId, objectKey, processed.data.byteLength, processed.info.width, processed.info.height, expiresAt]);
      await db.query("COMMIT");
      uploadedObjectKey = null;
      return Response.json({ ok: true, id: attachmentId });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  } catch (error) {
    if (uploadedObjectKey) await deleteLessonPhoto(uploadedObjectKey).catch(() => undefined);
    console.error("Failed to upload lesson photo", error);
    return Response.json({ error: "Не удалось загрузить фотографию" }, { status: 500 });
  }
}
