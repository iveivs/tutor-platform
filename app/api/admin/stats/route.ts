import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/admin-workspaces/shared";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

// Anonymized platform statistics for the admin «Статистика» tab: daily rows written by the worker,
// hourly host load and the admin's cost rates. Nothing here identifies a workspace or a person.
const ratesSchema = z.object({
  serverRubPerMonth: z.number().min(0).max(1_000_000),
  storageRubPerGbMonth: z.number().min(0).max(10_000),
  trafficRubPerGb: z.number().min(0).max(10_000),
  proPriceRub: z.number().min(0).max(100_000),
  maxPriceRub: z.number().min(0).max(100_000),
  feePercent: z.number().min(0).max(50),
}).strict();

const alertsSchema = z.object({ alertMemberId: z.string().min(1).max(128).nullable() }).strict();

const defaultRates = { serverRubPerMonth: 650, storageRubPerGbMonth: 2.56, trafficRubPerGb: 1.5, proPriceRub: 169, maxPriceRub: 299, feePercent: 7.5 };

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const pool = getPostgresPool();
  const [days, hours, rates, requestHours, alerts, owners] = await Promise.all([
    pool.query("SELECT day::text AS day, data FROM platform_daily_stats WHERE day > current_date - 120 ORDER BY day"),
    pool.query("SELECT hour, data FROM platform_hourly_load WHERE hour > now() - interval '7 days' ORDER BY hour"),
    pool.query("SELECT value FROM platform_settings WHERE key = 'cost_rates'"),
    pool.query("SELECT hour, kind, requests, errors, total_ms, buckets, bytes, peak_open FROM platform_request_stats WHERE hour > now() - interval '7 days' ORDER BY hour"),
    pool.query("SELECT value FROM platform_settings WHERE key = 'alerts'"),
    // Who can receive alerts: workspace owners (the admin picks their own teacher account).
    pool.query("SELECT m.id, m.display_name FROM members m WHERE m.role = 'owner' AND m.status = 'active' ORDER BY m.display_name"),
  ]);
  return Response.json({
    days: days.rows.map((row) => ({ day: String(row.day), ...row.data })),
    hours: hours.rows.map((row) => ({ hour: new Date(row.hour).getTime(), ...row.data })),
    rates: { ...defaultRates, ...(rates.rows[0]?.value ?? {}) },
    requestHours: requestHours.rows.map((row) => ({ hour: new Date(row.hour).getTime(), kind: String(row.kind), requests: Number(row.requests), errors: Number(row.errors), totalMs: Number(row.total_ms), buckets: (row.buckets as number[]).map(Number), bytes: Number(row.bytes), peakOpen: Number(row.peak_open) })),
    alertMemberId: alerts.rows[0]?.value?.memberId ?? null,
    owners: owners.rows.map((row) => ({ id: String(row.id), name: String(row.display_name) })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const alerts = alertsSchema.safeParse(json.value);
  if (alerts.success) {
    if (alerts.data.alertMemberId) {
      const owner = await getPostgresPool().query("SELECT 1 FROM members WHERE id = $1 AND role = 'owner' AND status = 'active'", [alerts.data.alertMemberId]);
      if (!owner.rowCount) return Response.json({ error: "Кабинет не найден" }, { status: 404 });
    }
    await getPostgresPool().query(`INSERT INTO platform_settings (key, value) VALUES ('alerts', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [{ memberId: alerts.data.alertMemberId }]);
    return Response.json({ ok: true });
  }
  const parsed = ratesSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте ставки" }, { status: 400 });
  await getPostgresPool().query(`INSERT INTO platform_settings (key, value) VALUES ('cost_rates', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [parsed.data]);
  return Response.json({ ok: true });
}
