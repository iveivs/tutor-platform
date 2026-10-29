import { getPostgresPool } from "@/db/postgres";
import { getAuthMember } from "@/lib/auth";
import { subscriptionPriceCents } from "@/lib/subscription-config";
import { accessModeAt } from "@/lib/workspace-access";

export const runtime = "nodejs";

// Access state of the signed-in member's workspace. Students only learn whether the workspace is
// read-only; the teacher also sees the access type, end date, price and own subscription payments.
export async function GET(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const pool = getPostgresPool();
  const workspace = (await pool.query("SELECT access_grant, access_expires_at FROM workspaces WHERE id = $1", [auth.workspaceId])).rows[0];
  if (!workspace) return Response.json({ error: "Кабинет не найден" }, { status: 404 });
  const accessMode = accessModeAt(workspace.access_expires_at);
  if (auth.role === "student") return Response.json({ accessMode }, { headers: { "Cache-Control": "no-store" } });
  const payments = await pool.query(`SELECT id, amount_cents, months, paid_on::text AS paid_on, method, receipt_ref, access_until, status
    FROM subscription_payments WHERE workspace_id = $1 ORDER BY paid_on DESC, created_at DESC LIMIT 50`, [auth.workspaceId]);
  return Response.json({
    accessMode,
    accessGrant: String(workspace.access_grant),
    accessExpiresAt: workspace.access_expires_at ? new Date(workspace.access_expires_at).getTime() : null,
    priceCents: subscriptionPriceCents(),
    payments: payments.rows.map((payment) => ({
      id: String(payment.id), amountCents: Number(payment.amount_cents), months: Number(payment.months), paidOn: String(payment.paid_on),
      method: String(payment.method), receiptRef: payment.receipt_ref == null ? "" : String(payment.receipt_ref),
      accessUntil: new Date(payment.access_until).getTime(), status: String(payment.status),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
