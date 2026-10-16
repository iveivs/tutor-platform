import { getD1 } from "@/db/d1";
import { requirePlatformAdmin } from "@/lib/admin-workspaces/shared";

export async function readAdminWorkspaces(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const db = getD1();
  const rows = await db.prepare(`SELECT w.id, w.name, w.timezone, w.subscription_status, w.access_status, w.access_grant,
    w.access_expires_at, w.created_at, w.last_activity_at, owner.display_name AS owner_name,
    COALESCE(owner.email, owner_user.email, '') AS owner_email,
    (SELECT COUNT(*) FROM members students WHERE students.workspace_id = w.id AND students.role = 'student' AND students.status != 'archived') AS student_count
    FROM workspaces w LEFT JOIN members owner ON owner.id = (
      SELECT candidate.id FROM members candidate WHERE candidate.workspace_id = w.id AND candidate.role = 'owner' ORDER BY candidate.created_at LIMIT 1
    ) LEFT JOIN users owner_user ON owner_user.id = owner.user_id ORDER BY w.created_at DESC`).all<Record<string, unknown>>();
  const invitations = await db.prepare(`SELECT id, display_name, email, professional_title, access_grant, expires_at, created_at
    FROM teacher_invitations WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC`).bind(Date.now()).all<Record<string, unknown>>();
  const audit = await db.prepare(`SELECT e.id, e.workspace_id, e.action, e.created_at, w.name AS workspace_name, u.full_name AS actor_name
    FROM platform_audit_events e JOIN workspaces w ON w.id = e.workspace_id JOIN users u ON u.id = e.actor_user_id
    ORDER BY e.created_at DESC LIMIT 100`).all<Record<string, unknown>>();
  return Response.json({
    currentWorkspaceId: auth.member?.workspaceId,
    workspaces: rows.results.map((row) => ({
      id: String(row.id), name: String(row.name), timezone: String(row.timezone), subscriptionStatus: String(row.subscription_status),
      accessStatus: String(row.access_status), accessGrant: String(row.access_grant), accessExpiresAt: row.access_expires_at == null ? null : Number(row.access_expires_at),
      createdAt: Number(row.created_at), lastActivityAt: row.last_activity_at == null ? null : Number(row.last_activity_at),
      ownerName: String(row.owner_name ?? "Без владельца"), ownerEmail: String(row.owner_email ?? ""), studentCount: Number(row.student_count),
    })),
    invitations: invitations.results.map((invitation) => ({
      id: String(invitation.id), name: String(invitation.display_name), email: String(invitation.email), professionalTitle: String(invitation.professional_title),
      accessGrant: String(invitation.access_grant), expiresAt: Number(invitation.expires_at), createdAt: Number(invitation.created_at),
    })),
    audit: audit.results.map((event) => ({
      id: String(event.id), workspaceId: String(event.workspace_id), workspaceName: String(event.workspace_name),
      actorName: String(event.actor_name), action: String(event.action), createdAt: Number(event.created_at),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
