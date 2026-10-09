import "server-only";

export type TelegramStartMessage = {
  chatId: string;
  telegramUserId: string;
  username: string | null;
  token: string;
};

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: string | number; type?: string };
    from?: { id?: string | number; username?: string };
  };
};

export function telegramBotUsername() {
  return process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";
}

export function telegramConfigured() {
  const direct = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const relayed = Boolean(process.env.TELEGRAM_API_BASE_URL?.trim() && process.env.TELEGRAM_RELAY_SECRET?.trim());
  return Boolean((direct || relayed) && telegramBotUsername() && process.env.TELEGRAM_WEBHOOK_SECRET?.trim());
}

export function buildTelegramStartUrl(token: string) {
  const username = telegramBotUsername();
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) throw new Error("Telegram bot username is not configured");
  return `https://t.me/${username}?start=${encodeURIComponent(token)}`;
}

export function parseTelegramStart(update: TelegramUpdate): TelegramStartMessage | null {
  const message = update.message;
  const text = message?.text?.trim();
  const match = text?.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{32,64})$/);
  if (!match || message?.chat?.type !== "private" || message.chat.id === undefined || message.from?.id === undefined) return null;
  return {
    chatId: String(message.chat.id),
    telegramUserId: String(message.from.id),
    username: message.from.username?.slice(0, 64) ?? null,
    token: match[1],
  };
}

export async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const relayBaseUrl = process.env.TELEGRAM_API_BASE_URL?.trim().replace(/\/+$/, "");
  const relaySecret = process.env.TELEGRAM_RELAY_SECRET?.trim();
  if (!token && !(relayBaseUrl && relaySecret)) throw new Error("Telegram delivery is not configured");
  const url = relayBaseUrl ? `${relayBaseUrl}/sendMessage` : `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(relayBaseUrl && relaySecret ? { "x-telegram-relay-secret": relaySecret } : {}),
    },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; description?: string; error_code?: number } | null;
  if (!response.ok || !result?.ok) {
    const error = new Error(`Telegram delivery failed (${result?.error_code ?? response.status})`);
    Object.assign(error, { status: result?.error_code ?? response.status, description: result?.description });
    throw error;
  }
}
