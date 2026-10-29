import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import type { adminActionSchema } from "@/lib/admin-workspaces/shared";
import { endOfMoscowDate, extendAccess } from "@/lib/workspace-access";

type AdminAction = z.infer<typeof adminActionSchema>;
type SubscriptionAction = Extract<AdminAction, { action: "setAccessTerms" | "addSubscriptionPayment" | "refundSubscriptionPayment" | "setAdminNote" }>;

const statusForGrant = (grant: string) => grant === "trial" ? "trial" : "active";
const auditValue = (grant: string, expiresAt: Date | null) => `${grant}|${expiresAt ? expiresAt.toISOString() : ""}`;

// Access terms and manual payments of a workspace. Each change and its audit entry are one transaction.
export async function updateSubscription(action: SubscriptionAction, adminUserId: string) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    if (action.action === "refundSubscriptionPayment") {
      const found = await client.query("SELECT id, workspace_id, status, amount_cents FROM subscription_payments WHERE id = $1 FOR UPDATE", [action.paymentId]);
      const payment = found.rows[0];
      if (!payment) { await client.query("ROLLBACK"); return Response.json({ error: "Платёж не найден" }, { status: 404 }); }
      if (payment.status === "refunded") { await client.query("ROLLBACK"); return Response.json({ error: "Возврат по этому платежу уже отмечен" }, { status: 409 }); }
      await client.query("UPDATE subscription_payments SET status = 'refunded', refunded_at = now() WHERE id = $1", [payment.id]);
      await client.query(`INSERT INTO platform_audit_events (id, actor_user_id, workspace_id, action, previous_value, new_value)
        VALUES ($1, $2, $3, 'subscription_payment_refunded', 'paid', $4)`, [randomUUID(), adminUserId, payment.workspace_id, String(payment.amount_cents)]);
      await client.query("COMMIT");
      return Response.json({ ok: true });
    }

    const found = await client.query("SELECT id, access_grant, access_expires_at FROM workspaces WHERE id = $1 FOR UPDATE", [action.workspaceId]);
    const workspace = found.rows[0];
    if (!workspace) { await client.query("ROLLBACK"); return Response.json({ error: "Кабинет не найден" }, { status: 404 }); }
    const owner = await client.query(`SELECT EXISTS (SELECT 1 FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND m.role = 'owner' AND u.is_platform_admin) AS is_admin`, [workspace.id]);
    workspace.is_admin = Boolean(owner.rows[0]?.is_admin);
    const previousExpiresAt: Date | null = workspace.access_expires_at ?? null;

    if (action.action === "setAdminNote") {
      await client.query("UPDATE workspaces SET admin_note = $1, updated_at = now() WHERE id = $2", [action.note.trim() || null, workspace.id]);
      await client.query("COMMIT");
      return Response.json({ ok: true });
    }

    if (action.action === "setAccessTerms") {
      // The platform admin's own workspace must never turn read-only.
      if (workspace.is_admin && action.accessUntil) { await client.query("ROLLBACK"); return Response.json({ error: "Для кабинета администратора срок доступа не ставится" }, { status: 400 }); }
      if (action.accessGrant === "unlimited" && action.accessUntil) { await client.query("ROLLBACK"); return Response.json({ error: "У бессрочного тарифа нет даты окончания" }, { status: 400 }); }
      const expiresAt = action.accessUntil ? endOfMoscowDate(action.accessUntil) : null;
      await client.query("UPDATE workspaces SET access_grant = $1, access_expires_at = $2, subscription_status = $3, updated_at = now() WHERE id = $4", [action.accessGrant, expiresAt, statusForGrant(action.accessGrant), workspace.id]);
      await client.query(`INSERT INTO platform_audit_events (id, actor_user_id, workspace_id, action, previous_value, new_value)
        VALUES ($1, $2, $3, 'access_terms_changed', $4, $5)`, [randomUUID(), adminUserId, workspace.id, auditValue(String(workspace.access_grant), previousExpiresAt), auditValue(action.accessGrant, expiresAt)]);
      await client.query("COMMIT");
      return Response.json({ ok: true, accessExpiresAt: expiresAt?.getTime() ?? null });
    }

    // «Бессрочный» is not sold: a payment would silently turn it into a paid subscription with an end date.
    if (workspace.access_grant === "unlimited") { await client.query("ROLLBACK"); return Response.json({ error: "Бессрочный тариф не оплачивается. Сначала смените тип доступа" }, { status: 400 }); }
    const { from, until } = extendAccess(previousExpiresAt, action.months);
    const paymentId = randomUUID();
    await client.query(`INSERT INTO subscription_payments (id, workspace_id, amount_cents, months, paid_on, method, receipt_ref, access_from, access_until, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [paymentId, workspace.id, action.amountCents, action.months, action.paidOn, action.method, action.receiptRef || null, from, until, adminUserId]);
    await client.query("UPDATE workspaces SET access_grant = 'paid', subscription_status = 'active', access_expires_at = $1, updated_at = now() WHERE id = $2", [until, workspace.id]);
    await client.query(`INSERT INTO platform_audit_events (id, actor_user_id, workspace_id, action, previous_value, new_value)
      VALUES ($1, $2, $3, 'subscription_payment_added', $4, $5)`, [randomUUID(), adminUserId, workspace.id, auditValue(String(workspace.access_grant), previousExpiresAt), `${action.amountCents}|${action.months}|${until.toISOString()}`]);
    await client.query("COMMIT");
    return Response.json({ ok: true, paymentId, accessExpiresAt: until.getTime() });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
