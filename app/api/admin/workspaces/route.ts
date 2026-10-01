import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthIdentity, getAuthMember, getPlatformAdmin } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { z } from "zod";

const updateWorkspaceSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  accessStatus: z.enum(["active", "blocked"]),
}).strict();

async function requirePlatformAdmin(request: Request) {
  const identity = await getAuthIdentity(request);
  if (!identity) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const admin = await getPlatformAdmin(request, identity);
  if (!admin) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  const member = await getAuthMember(request, identity);
  return { admin, member };
}

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const db = getD1();
  const rows = await db.prepare(`SELECT w.id, w.name, w.timezone, w.subscription_status, w.access_status, w.created_at, w.last_activity_at,
    owner.display_name AS owner_name, COALESCE(owner.email, owner_user.email, '') AS owner_email,
    (SELECT COUNT(*) FROM members students WHERE students.workspace_id = w.id AND students.role = 'student' AND students.status != 'archived') AS student_count
    FROM workspaces w
    LEFT JOIN members owner ON owner.id = (
      SELECT candidate.id FROM members candidate WHERE candidate.workspace_id = w.id AND candidate.role = 'owner' ORDER BY candidate.created_at LIMIT 1
    )
    LEFT JOIN users owner_user ON owner_user.id = owner.user_id
    ORDER BY w.created_at DESC`).all<Record<string, unknown>>();
  const audit = await db.prepare(`SELECT e.id, e.workspace_id, e.action, e.created_at, w.name AS workspace_name, u.full_name AS actor_name
    FROM platform_audit_events e JOIN workspaces w ON w.id = e.workspace_id JOIN users u ON u.id = e.actor_user_id
    ORDER BY e.created_at DESC LIMIT 100`).all<Record<string, unknown>>();
  return Response.json({
    currentWorkspaceId: auth.member?.workspaceId,
    workspaces: rows.results.map((row) => ({
      id: String(row.id), name: String(row.name), timezone: String(row.timezone), subscriptionStatus: String(row.subscription_status),
      accessStatus: String(row.access_status), createdAt: Number(row.created_at), lastActivityAt: row.last_activity_at == null ? null : Number(row.last_activity_at),
      ownerName: String(row.owner_name ?? "Без владельца"), ownerEmail: String(row.owner_email ?? ""), studentCount: Number(row.student_count),
    })),
    audit: audit.results.map((event) => ({
      id: String(event.id), workspaceId: String(event.workspace_id), workspaceName: String(event.workspace_name),
      actorName: String(event.actor_name), action: String(event.action), createdAt: Number(event.created_at),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = updateWorkspaceSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Некорректные параметры" }, { status: 400 });
  if (parsed.data.workspaceId === auth.member?.workspaceId && parsed.data.accessStatus === "blocked") {
    return Response.json({ error: "Нельзя заблокировать собственный кабинет администратора" }, { status: 400 });
  }

  const db = getD1();
  const workspace = await db.prepare("SELECT access_status FROM workspaces WHERE id = ?").bind(parsed.data.workspaceId).first<{ access_status: string }>();
  if (!workspace) return Response.json({ error: "Кабинет не найден" }, { status: 404 });
  if (workspace.access_status === parsed.data.accessStatus) return Response.json({ ok: true });
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE workspaces SET access_status = ?, updated_at = ? WHERE id = ?").bind(parsed.data.accessStatus, now, parsed.data.workspaceId),
    db.prepare(`INSERT INTO platform_audit_events (id, actor_user_id, workspace_id, action, previous_value, new_value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), auth.admin.userId, parsed.data.workspaceId, parsed.data.accessStatus === "blocked" ? "workspace_blocked" : "workspace_unblocked", workspace.access_status, parsed.data.accessStatus, now),
  ]);
  return Response.json({ ok: true });
}
