import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { getAuthMember } from "@/lib/auth";
import { defaultMaterialTitle } from "@/lib/teacher-material-files";

export const resourceIdSchema = z.string().uuid();
export const metadataSchema = z.object({
  id: resourceIdSchema,
  title: z.string().trim().min(1).max(120),
  folder: z.string().trim().max(80).nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
}).strict();

export async function requireTeacher(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (auth.role === "student") return Response.json({ error: "Библиотека доступна только преподавателю" }, { status: 403 });
  return auth;
}
export function normalizeTags(values: string[]) {
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

export function parseFormMetadata(form: FormData, filename: string) {
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

export function materialPayload(row: Record<string, unknown>) {
  const assignments = Array.isArray(row.assignments) ? row.assignments : [];
  const sharedStudents = Array.isArray(row.shared_students) ? row.shared_students : [];
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
    sharedStudents: sharedStudents.map((assignment) => {
      const item = assignment as Record<string, unknown>;
      return { studentId: String(item.studentId), studentName: String(item.studentName), sharedAt: new Date(String(item.sharedAt)).getTime() };
    }),
    createdAt: new Date(String(row.created_at)).getTime(),
    updatedAt: new Date(String(row.updated_at)).getTime(),
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).getTime() : null,
    url: `/api/teacher-materials/${encodeURIComponent(String(row.id))}`,
  };
}

export async function readUsage(db: Pick<ReturnType<typeof getPostgresPool>, "query">, workspaceId: string) {
  return db.query(`SELECT
    (SELECT COALESCE(sum(byte_size), 0)::bigint FROM teacher_resources WHERE workspace_id = $1 AND status = 'active') AS storage_bytes,
    (SELECT count(*)::int FROM teacher_resource_upload_events WHERE workspace_id = $1 AND created_at >= date_trunc('month', now())) AS uploads_this_month`, [workspaceId]);
}
