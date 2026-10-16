import { assertSameOrigin } from "@/lib/auth";
import { executeLessonContentAction } from "@/lib/lesson-content/actions";
import { actionSchema, requireAuth } from "@/lib/lesson-content/shared";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";

export async function updateLessonMaterials(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const limited = await enforceNodeRateLimit(request, "lesson_materials_write", 20, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    const json = await readLimitedJson<unknown>(request);
    if (!json.ok) return json.response;
    const parsed = actionSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "Проверьте данные" }, { status: 400 });
    return executeLessonContentAction({ request, auth, body: parsed.data });
  } catch (error) {
    console.error("Failed to update lesson materials", error);
    return Response.json({ error: "Не удалось сохранить материалы урока" }, { status: 500 });
  }
}
