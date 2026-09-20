import { assertSameOrigin, getAuthConfig } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { updatePassword } from "@/lib/supabase-password";
import { z } from "zod";

const resetSchema = z.object({
  accessToken: z.string().min(1).max(4096),
  password: z.string().min(8).max(128),
}).strict();

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config) return Response.json({ error: "Авторизация ещё не настроена" }, { status: 503 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = resetSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Пароль должен содержать от 8 до 128 символов" }, { status: 400 });

  try {
    if (!await updatePassword(config, parsed.data.accessToken, parsed.data.password)) {
      return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 401 });
    }
  } catch {
    return Response.json({ error: "Сервис восстановления временно недоступен" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
