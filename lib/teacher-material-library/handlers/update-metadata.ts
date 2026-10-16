import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin } from "@/lib/auth";
import { hasCurrentContentRulesAcceptance } from "@/lib/lesson-materials";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { metadataSchema, normalizeTags, requireTeacher } from "@/lib/teacher-material-library/shared";

export async function updateTeacherMaterialMetadata(request: Request) {
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
