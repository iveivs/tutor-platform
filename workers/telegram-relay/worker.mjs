const allowedMethods = new Set(["getMe", "getWebhookInfo", "sendMessage", "setWebhook"]);
const maxBodyBytes = 64_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function isAuthorized(request, secret) {
  return Boolean(secret && request.headers.get("x-telegram-relay-secret") === secret);
}

async function readBody(request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBodyBytes) return null;
  const body = await request.arrayBuffer();
  return body.byteLength <= maxBodyBytes ? body : null;
}

async function telegramApi(request, env, url) {
  if (!isAuthorized(request, env.TELEGRAM_RELAY_SECRET)) return json({ ok: false }, 401);
  if (request.method !== "POST") return json({ ok: false }, 405);
  const method = url.pathname.slice("/bot/".length);
  if (!allowedMethods.has(method)) return json({ ok: false }, 404);
  const body = await readBody(request);
  if (!body) return json({ ok: false }, 413);

  let forwardedBody = body;
  if (method === "setWebhook") {
    forwardedBody = new TextEncoder().encode(JSON.stringify({
      url: `${url.origin}/telegram/webhook`,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }));
  }
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: forwardedBody,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

async function telegramWebhook(request, env) {
  if (request.method !== "POST") return json({ ok: false }, 405);
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false }, 401);
  }
  const body = await readBody(request);
  if (!body) return json({ ok: false }, 413);
  const response = await fetch(env.ORIGIN_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET,
    },
    body,
  });
  return json({ ok: response.ok }, response.ok ? 200 : 502);
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/bot/")) return telegramApi(request, env, url);
    if (url.pathname === "/telegram/webhook") return telegramWebhook(request, env);
    if (url.pathname === "/health") return json({ status: "ok" });
    return json({ ok: false }, 404);
  },
};

export default worker;
