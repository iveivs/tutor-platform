import { env } from "cloudflare:workers";
import { getD1 } from "@/db/d1";
import { actionBodySchema, type ActionBody } from "@/lib/app-data/action-schema";
import { executeAppDataAction } from "@/lib/app-data/write-actions";
import {
  conflict,
  databaseConstraintName,
  invalid,
  requireMember,
} from "@/lib/app-data/route-utils";
import { assertSameOrigin } from "@/lib/auth";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readOnlyResponse } from "@/lib/workspace-access";
import { enforceRateLimit, readLimitedJson } from "@/lib/request-security";

export async function handleWriteAppData(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const nodeLimited = await enforceNodeRateLimit(request, "api_write:/api/app-data", 60);
    if (nodeLimited) return nodeLimited;
    const json = await readLimitedJson<unknown>(request);
    if (!json.ok) return json.response;
    const parsed = actionBodySchema.safeParse(json.value);
    if (!parsed.success) return invalid();
    const body: ActionBody = parsed.data;
    const auth = await requireMember(request);
    if (auth instanceof Response) return auth;
    // A read-only workspace (paid access ended) can still mark its notifications read.
    if (body.action !== "markNotificationsRead" && "accessMode" in auth && auth.accessMode === "read_only") return readOnlyResponse();
    if (auth.role === "student" && body.action === "submitStudentRequest") {
      const nodeStudentLimited = await enforceNodeRateLimit(request, "student_request", 10, `${auth.workspaceId}:${auth.memberId}`);
      if (nodeStudentLimited) return nodeStudentLimited;
      const limited = await enforceRateLimit(env.STUDENT_REQUEST_RATE_LIMITER, `${auth.workspaceId}:${auth.memberId}`, "student_request");
      if (limited) return limited;
    }
    if (!["submitStudentRequest", "markNotificationsRead", "updateOwnAvatarColor"].includes(body.action) && !["owner", "teacher"].includes(auth.role)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    const db = getD1();
    const id = crypto.randomUUID();

    const actionResponse = await executeAppDataAction({ request, db, body, auth, id });
    if (actionResponse) return actionResponse;

    return Response.json({ ok: true, id });
  } catch (error) {
    const constraint = databaseConstraintName(error);
    if ((error instanceof Error && error.message.includes("UNIQUE constraint failed: lesson_requests.")) || constraint?.startsWith("lesson_requests_pending_")) return Response.json({ error: "Такой запрос уже ожидает решения" }, { status: 409 });
    if ((error instanceof Error && error.message.includes("UNIQUE constraint failed: balance_entries.reverses_entry_id")) || constraint === "balance_entries_reversal_unique") return Response.json({ error: "Эта оплата уже отменена" }, { status: 409 });
    if (constraint === "lessons_workspace_time_exclusion") return conflict();
    console.error("Failed to update app data", error);
    return Response.json({ error: "Не удалось сохранить изменения" }, { status: 500 });
  }
}


