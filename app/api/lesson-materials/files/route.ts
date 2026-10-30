import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { lessonFileKind, MAX_LESSON_AUDIO_BYTES, MAX_LESSON_DOCUMENT_BYTES, SINCE_MOSCOW_TODAY, STUDENT_DAILY_LIMITS } from "@/lib/lesson-file-limits";
import {
  hasCurrentContentRulesAcceptance, lessonFileObjectKey, lessonPhotoStorageConfigured, notifyLessonStudents, photoExpiresAt, putLessonFile, resolveLessonAccess,
} from "@/lib/lesson-materials";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { detectTeacherMaterial, MAX_WORKSPACE_MATERIAL_BYTES, sanitizeMaterialFilename } from "@/lib/teacher-material-files";
import { rejectReadOnlyWrite } from "@/lib/workspace-access";

export const runtime = "nodejs";

// Audio (MP3) and documents (PDF, Word) on a lesson, from the teacher or a student. Kept until 90
// days after the lesson like photos; students have daily limits; all files share the workspace's 5 GB.
export async function POST(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const readOnly = rejectReadOnlyWrite(request, auth);
    if (readOnly) return readOnly;
    if (!lessonPhotoStorageConfigured()) return Response.json({ error: "Хранилище файлов ещё не настроено" }, { status: 503 });
    const limited = await enforceNodeRateLimit(request, "lesson_file_upload", 10, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
    const form = await request.formData();
    const lessonId = form.get("lessonId");
    const file = form.get("file");
    if (typeof lessonId !== "string" || !lessonId || lessonId.length > 128 || !(file instanceof File)) return Response.json({ error: "Проверьте файл и урок" }, { status: 400 });
    if (file.size < 1 || file.size > MAX_LESSON_AUDIO_BYTES) return Response.json({ error: "Файл должен быть не больше 20 МБ" }, { status: 413 });
    const filename = sanitizeMaterialFilename(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectTeacherMaterial(filename, bytes);
    if (!detected) return Response.json({ error: "Можно добавить MP3 до 20 МБ, PDF или Word до 10 МБ" }, { status: 415 });
    const kind = lessonFileKind(detected.contentType);
    if (kind === "document" && bytes.byteLength > MAX_LESSON_DOCUMENT_BYTES) return Response.json({ error: "Документ должен быть не больше 10 МБ" }, { status: 413 });
    const lesson = await resolveLessonAccess(auth, lessonId);
    if (!lesson) return Response.json({ error: "Урок не найден" }, { status: 404 });
    const expiresAt = photoExpiresAt(lesson.endsAt);
    if (expiresAt <= new Date()) return Response.json({ error: "Для этого урока срок хранения файлов уже истёк" }, { status: 409 });
    const pool = getPostgresPool();
    if (auth.role === "student") {
      const today = await pool.query(`SELECT count(*) FILTER (WHERE content_type LIKE 'audio/%')::int AS audio, count(*) FILTER (WHERE content_type NOT LIKE 'audio/%')::int AS documents
        FROM lesson_files WHERE uploaded_by_member_id = $1 AND ${SINCE_MOSCOW_TODAY}`, [auth.memberId]);
      const used = kind === "audio" ? Number(today.rows[0]?.audio ?? 0) : Number(today.rows[0]?.documents ?? 0);
      const limit = kind === "audio" ? STUDENT_DAILY_LIMITS.audio : STUDENT_DAILY_LIMITS.document;
      if (used >= limit) return Response.json({ error: kind === "audio" ? `В день можно добавить не более ${limit} аудиозаписей` : `В день можно добавить не более ${limit} документов` }, { status: 429 });
    }
    const storage = await pool.query(`SELECT (COALESCE((SELECT sum(byte_size) FROM teacher_resources WHERE workspace_id = $1 AND status = 'active'), 0)
        + COALESCE((SELECT sum(byte_size) FROM lesson_files WHERE workspace_id = $1 AND status = 'active'), 0)
        + COALESCE((SELECT sum(byte_size) FROM lesson_attachments WHERE workspace_id = $1 AND status = 'active'), 0))::bigint AS bytes`, [auth.workspaceId]);
    if (Number(storage.rows[0]?.bytes ?? 0) + bytes.byteLength > MAX_WORKSPACE_MATERIAL_BYTES) return Response.json({ error: "В кабинете закончилось место (5 ГБ)" }, { status: 409 });
    const fileId = randomUUID();
    const objectKey = lessonFileObjectKey(auth.workspaceId, lesson.lessonId, fileId, detected.extension);
    await putLessonFile(objectKey, bytes, detected.contentType);
    await pool.query(`INSERT INTO lesson_files (id, workspace_id, lesson_id, uploaded_by_member_id, object_key, content_type, original_filename, byte_size, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [fileId, auth.workspaceId, lesson.lessonId, auth.memberId, objectKey, detected.contentType, filename, bytes.byteLength, expiresAt]);
    const title = kind === "audio" ? "Добавлена аудиозапись к уроку" : "Добавлен документ к уроку";
    if (auth.role === "student") {
      await pool.query(`INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body)
        SELECT $1, teacher.id, $2, $3, 'lesson_material_added', $5, 'Ученик добавил файл к материалам урока.'
        FROM members teacher WHERE teacher.workspace_id = $4 AND teacher.role = 'owner' AND teacher.status = 'active' ORDER BY teacher.created_at LIMIT 1`,
      [randomUUID(), lesson.studentId, lesson.lessonId, auth.workspaceId, title]);
    } else {
      await notifyLessonStudents(auth.workspaceId, lesson, "lesson_material_added", title, "Преподаватель добавил файл к материалам урока.");
    }
    return Response.json({ ok: true, id: fileId });
  } catch (error) {
    console.error("Failed to upload lesson file", error);
    return Response.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Файл не выбран" }, { status: 400 });
  // The uploader deletes their own file; the teacher can delete any file in the workspace.
  const result = await getPostgresPool().query(`UPDATE lesson_files SET status = 'deleting', deleted_at = now()
    WHERE id = $1 AND workspace_id = $2 AND status = 'active' AND (uploaded_by_member_id = $3 OR $4 <> 'student') RETURNING id`, [id, auth.workspaceId, auth.memberId, auth.role]);
  if (!result.rowCount) return Response.json({ error: "Файл не найден" }, { status: 404 });
  return Response.json({ ok: true });
}
