import { getPostgresPool } from "@/db/postgres";
import { getAuthMember } from "@/lib/auth";
import { getLessonFile, studentSeesLessonSql } from "@/lib/lesson-materials";
import { materialContentDisposition } from "@/lib/teacher-material-files";

export const runtime = "nodejs";

// Streams a lesson file with the same access as lesson photos: the teacher always, a student for
// their own lesson or a file the teacher added to the session. Supports Range for audio seeking.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const { id } = await context.params;
    const result = await getPostgresPool().query(`SELECT file.object_key, file.content_type, file.original_filename, file.byte_size
      FROM lesson_files file JOIN lessons lesson ON lesson.id = file.lesson_id
      LEFT JOIN members uploader ON uploader.id = file.uploaded_by_member_id
      WHERE file.id = $1 AND file.workspace_id = $2 AND file.status = 'active' AND file.expires_at > now()
        AND ($3 <> 'student' OR lesson.student_id = $4 OR (uploader.role <> 'student' AND ${studentSeesLessonSql("lesson", "$4")})) LIMIT 1`, [id, auth.workspaceId, auth.role, auth.memberId]);
    const row = result.rows[0];
    if (!row) return Response.json({ error: "Файл не найден" }, { status: 404 });
    const size = Number(row.byte_size);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "Content-Type": String(row.content_type), "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": materialContentDisposition(String(row.original_filename), download ? "attachment" : "inline"),
    };
    const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      const bytes = await getLessonFile(String(row.object_key), { start, end });
      return new Response(Buffer.from(bytes), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(bytes.byteLength) } });
    }
    const bytes = await getLessonFile(String(row.object_key));
    return new Response(Buffer.from(bytes), { headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
  } catch (error) {
    console.error("Failed to read lesson file", error);
    return Response.json({ error: "Не удалось открыть файл" }, { status: 500 });
  }
}
