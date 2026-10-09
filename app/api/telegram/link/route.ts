import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember, randomToken, sha256 } from "@/lib/auth";
import { buildTelegramStartUrl, telegramBotUsername, telegramConfigured } from "@/lib/telegram";

export async function GET(request: Request) {
  const member = await getAuthMember(request);
  if (!member) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const result = await getPostgresPool().query(`SELECT username, connected_at
    FROM telegram_connections WHERE member_id = $1 AND disabled_at IS NULL LIMIT 1`, [member.memberId]);
  const connection = result.rows[0];
  return Response.json({
    configured: telegramConfigured(),
    botUsername: telegramBotUsername() || null,
    connected: Boolean(connection),
    username: connection?.username ? String(connection.username) : null,
    connectedAt: connection?.connected_at instanceof Date ? connection.connected_at.toISOString() : null,
  });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const member = await getAuthMember(request);
  if (!member) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!telegramConfigured()) return Response.json({ error: "Telegram-бот пока не настроен" }, { status: 503 });

  const token = randomToken();
  const tokenHash = await sha256(token);
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE telegram_link_tokens SET consumed_at = now() WHERE member_id = $1 AND consumed_at IS NULL", [member.memberId]);
    await client.query(`INSERT INTO telegram_link_tokens (id, member_id, token_hash, expires_at)
      VALUES ($1, $2, $3, now() + interval '15 minutes')`, [randomUUID(), member.memberId, tokenHash]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return Response.json({ url: buildTelegramStartUrl(token), expiresInSeconds: 900 });
}

export async function DELETE(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const member = await getAuthMember(request);
  if (!member) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE telegram_connections SET disabled_at = now(), updated_at = now() WHERE member_id = $1 AND disabled_at IS NULL", [member.memberId]);
    await client.query("UPDATE telegram_link_tokens SET consumed_at = now() WHERE member_id = $1 AND consumed_at IS NULL", [member.memberId]);
    await client.query("UPDATE telegram_deliveries SET status = 'cancelled', updated_at = now() WHERE member_id = $1 AND status IN ('pending', 'failed')", [member.memberId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return Response.json({ ok: true });
}
