import { getPostgresPool } from "@/db/postgres";
import { requirePlatformAdmin } from "@/lib/admin-workspaces/shared";
import { subscriptionPriceCents } from "@/lib/subscription-config";

const ms = (value: unknown) => value == null ? null : new Date(value as string | Date).getTime();

export async function readAdminWorkspaces(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const pool = getPostgresPool();
  const [rows, invitations, payments, audit] = await Promise.all([
    pool.query(`SELECT w.id, w.name, w.timezone, w.subscription_status, w.access_status, w.access_grant,
      w.access_expires_at, w.admin_note, w.created_at, w.last_activity_at, owner.display_name AS owner_name,
      owner.professional_title AS owner_title, COALESCE(owner.email, owner_user.email, '') AS owner_email,
      (SELECT count(*) FROM members students WHERE students.workspace_id = w.id AND students.role = 'student' AND students.status <> 'archived' AND NOT students.is_trial_contact)::int AS student_count,
      (SELECT count(*) FROM student_groups g WHERE g.workspace_id = w.id AND g.status = 'active')::int AS group_count,
      (COALESCE((SELECT sum(r.byte_size) FROM teacher_resources r WHERE r.workspace_id = w.id AND r.status = 'active'), 0)
        + COALESCE((SELECT sum(a.byte_size) FROM lesson_attachments a WHERE a.workspace_id = w.id AND a.status = 'active'), 0))::bigint AS storage_bytes
      FROM workspaces w LEFT JOIN members owner ON owner.id = (
        SELECT candidate.id FROM members candidate WHERE candidate.workspace_id = w.id AND candidate.role = 'owner' ORDER BY candidate.created_at LIMIT 1
      ) LEFT JOIN users owner_user ON owner_user.id = owner.user_id ORDER BY w.created_at DESC`),
    pool.query(`SELECT id, display_name, email, professional_title, access_grant, expires_at, created_at
      FROM teacher_invitations WHERE status = 'pending' AND expires_at > now() ORDER BY created_at DESC`),
    pool.query(`SELECT id, workspace_id, amount_cents, months, paid_on::text AS paid_on, method, receipt_ref,
      access_until, status, created_at FROM subscription_payments ORDER BY paid_on DESC, created_at DESC LIMIT 1000`),
    pool.query(`SELECT e.id, e.workspace_id, e.action, e.previous_value, e.new_value, e.created_at, w.name AS workspace_name, u.full_name AS actor_name
      FROM platform_audit_events e JOIN workspaces w ON w.id = e.workspace_id JOIN users u ON u.id = e.actor_user_id
      ORDER BY e.created_at DESC LIMIT 300`),
  ]);
  return Response.json({
    currentWorkspaceId: auth.member?.workspaceId,
    priceCents: subscriptionPriceCents(),
    workspaces: rows.rows.map((row) => ({
      id: String(row.id), name: String(row.name), timezone: String(row.timezone), subscriptionStatus: String(row.subscription_status),
      accessStatus: String(row.access_status), accessGrant: String(row.access_grant), accessExpiresAt: ms(row.access_expires_at),
      adminNote: row.admin_note == null ? "" : String(row.admin_note),
      createdAt: ms(row.created_at), lastActivityAt: ms(row.last_activity_at),
      ownerName: String(row.owner_name ?? "Без владельца"), ownerTitle: String(row.owner_title ?? ""), ownerEmail: String(row.owner_email ?? ""),
      studentCount: Number(row.student_count), groupCount: Number(row.group_count), storageBytes: Number(row.storage_bytes),
    })),
    invitations: invitations.rows.map((invitation) => ({
      id: String(invitation.id), name: String(invitation.display_name), email: String(invitation.email), professionalTitle: String(invitation.professional_title),
      accessGrant: String(invitation.access_grant), expiresAt: ms(invitation.expires_at), createdAt: ms(invitation.created_at),
    })),
    payments: payments.rows.map((payment) => ({
      id: String(payment.id), workspaceId: String(payment.workspace_id), amountCents: Number(payment.amount_cents), months: Number(payment.months),
      paidOn: String(payment.paid_on), method: String(payment.method), receiptRef: payment.receipt_ref == null ? "" : String(payment.receipt_ref),
      accessUntil: ms(payment.access_until), status: String(payment.status), createdAt: ms(payment.created_at),
    })),
    audit: audit.rows.map((event) => ({
      id: String(event.id), workspaceId: String(event.workspace_id), workspaceName: String(event.workspace_name),
      actorName: String(event.actor_name), action: String(event.action), previousValue: event.previous_value == null ? null : String(event.previous_value),
      newValue: event.new_value == null ? null : String(event.new_value), createdAt: ms(event.created_at),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
