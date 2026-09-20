import { assertSameOrigin, getAuthConfig } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { requestPasswordRecovery } from "@/lib/supabase-password";
import { z } from "zod";

const recoverySchema = z.object({
  email: z.string().trim().email().max(254),
}).strict();

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config) return Response.json({ error: "Авторизация ещё не настроена" }, { status: 503 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = recoverySchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Введите корректный email" }, { status: 400 });

  try {
    await requestPasswordRecovery(config, parsed.data.email.toLowerCase(), new URL("/", request.url).toString());
  } catch {
    return Response.json({ error: "Сервис восстановления временно недоступен" }, { status: 502 });
  }

  // The response is deliberately identical whether the account exists or not.
  return Response.json({ ok: true });
}
