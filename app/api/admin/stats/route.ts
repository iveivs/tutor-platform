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

const defaultRates = { serverRubPerMonth: 650, storageRubPerGbMonth: 2.56, trafficRubPerGb: 1.5, proPriceRub: 169, maxPriceRub: 299, feePercent: 7.5 };

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const pool = getPostgresPool();
  const [days, hours, rates] = await Promise.all([
    pool.query("SELECT day::text AS day, data FROM platform_daily_stats WHERE day > current_date - 120 ORDER BY day"),
    pool.query("SELECT hour, data FROM platform_hourly_load WHERE hour > now() - interval '7 days' ORDER BY hour"),
    pool.query("SELECT value FROM platform_settings WHERE key = 'cost_rates'"),
  ]);
  return Response.json({
    days: days.rows.map((row) => ({ day: String(row.day), ...row.data })),
    hours: hours.rows.map((row) => ({ hour: new Date(row.hour).getTime(), ...row.data })),
    rates: { ...defaultRates, ...(rates.rows[0]?.value ?? {}) },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof Response) return auth;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = ratesSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте ставки" }, { status: 400 });
  await getPostgresPool().query(`INSERT INTO platform_settings (key, value) VALUES ('cost_rates', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [parsed.data]);
  return Response.json({ ok: true });
}
