import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { vapidPublicKey } from "@/lib/web-push-config";

export const runtime = "nodejs";

// Queues a test notification to every device of the signed-in member; the worker sends it.
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!vapidPublicKey()) return Response.json({ error: "Уведомления на устройства пока не настроены" }, { status: 503 });
  const limited = await enforceNodeRateLimit(request, "push_test", 3, auth.memberId);
  if (limited) return limited;
  const result = await getPostgresPool().query(`INSERT INTO push_deliveries (member_id, kind, dedupe_key, title, body)
    SELECT $1, 'test', $2, 'Проверка уведомлений', 'Уведомления на этом устройстве работают.'
    WHERE EXISTS (SELECT 1 FROM push_subscriptions WHERE member_id = $1)`, [auth.memberId, `test:${randomUUID()}`]);
  if (!result.rowCount) return Response.json({ error: "Сначала включите уведомления на этом устройстве" }, { status: 409 });
  return Response.json({ ok: true });
}
