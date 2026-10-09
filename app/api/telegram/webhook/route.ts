import { getPostgresPool } from "@/db/postgres";
import { sha256 } from "@/lib/auth";
import { parseTelegramStart, sendTelegramMessage } from "@/lib/telegram";

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expectedSecret || request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) return new Response(null, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64_000) return new Response(null, { status: 413 });
  const update = await request.json().catch(() => null);
  const start = update && typeof update === "object" ? parseTelegramStart(update) : null;
  if (!start) return Response.json({ ok: true });

  const tokenHash = await sha256(start.token);
  const client = await getPostgresPool().connect();
  let linked = false;
  try {
    await client.query("BEGIN");
    const token = await client.query(`SELECT id, member_id FROM telegram_link_tokens
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, [tokenHash]);
    const link = token.rows[0];
    if (link) {
      await client.query("DELETE FROM telegram_connections WHERE chat_id = $1 AND member_id <> $2", [start.chatId, link.member_id]);
      await client.query(`INSERT INTO telegram_connections (member_id, chat_id, telegram_user_id, username, disabled_at, connected_at, updated_at)
        VALUES ($1, $2, $3, $4, NULL, now(), now())
        ON CONFLICT (member_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, telegram_user_id = EXCLUDED.telegram_user_id,
          username = EXCLUDED.username, disabled_at = NULL, connected_at = now(), updated_at = now()`, [link.member_id, start.chatId, start.telegramUserId, start.username]);
      await client.query("UPDATE telegram_link_tokens SET consumed_at = now() WHERE id = $1", [link.id]);
      linked = true;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(JSON.stringify({ event: "telegram_link_failed", reason: error instanceof Error ? error.name : "unknown" }));
  } finally {
    client.release();
  }

  await sendTelegramMessage(start.chatId, linked
    ? "Готово! Telegram подключён к Тьюттори. Здесь будут только напоминания об уроках и важные изменения расписания."
    : "Ссылка недействительна или уже использована. Вернитесь в Тьюттори и создайте новую ссылку.").catch(() => undefined);
  return Response.json({ ok: true });
}
