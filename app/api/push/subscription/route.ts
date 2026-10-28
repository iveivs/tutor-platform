import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";
import { vapidPublicKey } from "@/lib/web-push-config";
import { isAllowedPushEndpoint, isValidSubscriptionKeys } from "@/scripts/web-push.mjs";

export const runtime = "nodejs";

const MAX_DEVICES_PER_MEMBER = 10;

const subscriptionSchema = z.object({
  endpoint: z.string().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }).strict(),
  language: z.enum(["ru", "en"]),
}).strict();

const removalSchema = z.object({ endpoint: z.string().max(1000) }).strict();

export async function GET(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const result = await getPostgresPool().query("SELECT count(*)::int AS devices FROM push_subscriptions WHERE member_id = $1", [auth.memberId]);
  return Response.json({ publicKey: vapidPublicKey(), devices: Number(result.rows[0]?.devices ?? 0) });
}

// Saves this browser's subscription for the signed-in member. The same endpoint signed in
// under another account moves to that account, so one device never notifies two people.
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!vapidPublicKey()) return Response.json({ error: "Уведомления на устройства пока не настроены" }, { status: 503 });
  const limited = await enforceNodeRateLimit(request, "push_subscription", 20, auth.memberId);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = subscriptionSchema.safeParse(json.value);
  if (!parsed.success || !isAllowedPushEndpoint(parsed.data.endpoint) || !isValidSubscriptionKeys(parsed.data.keys.p256dh, parsed.data.keys.auth)) {
    return Response.json({ error: "Этот браузер не поддерживает уведомления Тьюттори" }, { status: 400 });
  }
  const { endpoint, keys, language } = parsed.data;
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO push_subscriptions (id, member_id, endpoint, p256dh, auth, language)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (endpoint) DO UPDATE SET member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth, language = EXCLUDED.language, updated_at = now()`,
    [randomUUID(), auth.memberId, endpoint, keys.p256dh, keys.auth, language]);
    await client.query(`DELETE FROM push_subscriptions WHERE id IN (
        SELECT id FROM push_subscriptions WHERE member_id = $1 ORDER BY updated_at DESC OFFSET $2
      )`, [auth.memberId, MAX_DEVICES_PER_MEMBER]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = removalSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Запрос отклонён" }, { status: 400 });
  await getPostgresPool().query("DELETE FROM push_subscriptions WHERE member_id = $1 AND endpoint = $2", [auth.memberId, parsed.data.endpoint]);
  return Response.json({ ok: true });
}
