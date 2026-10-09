import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTelegramStartUrl, parseTelegramStart, sendTelegramMessage, telegramConfigured } from "./telegram";

afterEach(() => {
  for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_API_BASE_URL", "TELEGRAM_RELAY_SECRET"]) delete process.env[key];
  vi.unstubAllGlobals();
});

describe("Telegram account linking", () => {
  it("parses a private /start deep link", () => {
    expect(parseTelegramStart({ message: { text: "/start abcdefghijklmnopqrstuvwxyz_123456", chat: { id: 42, type: "private" }, from: { id: 7, username: "student" } } })).toEqual({
      chatId: "42", telegramUserId: "7", username: "student", token: "abcdefghijklmnopqrstuvwxyz_123456",
    });
  });

  it("rejects group messages and malformed tokens", () => {
    expect(parseTelegramStart({ message: { text: "/start short", chat: { id: -42, type: "group" }, from: { id: 7 } } })).toBeNull();
  });

  it("builds the bot deep link without an at sign", () => {
    process.env.TELEGRAM_BOT_USERNAME = "@tyuttori_bot";
    expect(buildTelegramStartUrl("abcdefghijklmnopqrstuvwxyz_123456")).toBe("https://t.me/tyuttori_bot?start=abcdefghijklmnopqrstuvwxyz_123456");
  });

  it("treats the authenticated relay as a complete delivery configuration", () => {
    process.env.TELEGRAM_BOT_USERNAME = "tyuttori_bot";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret";
    process.env.TELEGRAM_API_BASE_URL = "https://relay.example/bot";
    process.env.TELEGRAM_RELAY_SECRET = "relay-secret";
    expect(telegramConfigured()).toBe(true);
  });

  it("sends through the relay without exposing the bot token in the URL", async () => {
    process.env.TELEGRAM_API_BASE_URL = "https://relay.example/bot/";
    process.env.TELEGRAM_RELAY_SECRET = "relay-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessage("42", "Напоминание");

    expect(fetchMock).toHaveBeenCalledWith("https://relay.example/bot/sendMessage", expect.objectContaining({
      headers: expect.objectContaining({ "x-telegram-relay-secret": "relay-secret" }),
    }));
  });
});
