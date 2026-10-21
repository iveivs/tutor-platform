import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

const preferencesSchema = z.object({
  soundEnabled: z.boolean(),
  telegramSchedule: z.boolean(),
  telegramMessages: z.boolean(),
  telegramMaterials: z.boolean(),
}).strict();

const defaults = {
  soundEnabled: true,
  telegramSchedule: true,
  telegramMessages: false,
  telegramMaterials: false,
};

export async function GET(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const result = await getPostgresPool().query(`SELECT sound_enabled, telegram_schedule, telegram_messages, telegram_materials
    FROM notification_preferences WHERE member_id = $1`, [auth.memberId]);
  const row = result.rows[0];
  return Response.json(row ? {
    soundEnabled: Boolean(row.sound_enabled),
    telegramSchedule: Boolean(row.telegram_schedule),
    telegramMessages: Boolean(row.telegram_messages),
    telegramMaterials: Boolean(row.telegram_materials),
  } : defaults, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = preferencesSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте настройки уведомлений" }, { status: 400 });
  const value = parsed.data;
  await getPostgresPool().query(`INSERT INTO notification_preferences
      (member_id, sound_enabled, telegram_schedule, telegram_messages, telegram_materials)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (member_id) DO UPDATE SET sound_enabled = EXCLUDED.sound_enabled,
      telegram_schedule = EXCLUDED.telegram_schedule,
      telegram_messages = EXCLUDED.telegram_messages,
      telegram_materials = EXCLUDED.telegram_materials,
      updated_at = now()`, [auth.memberId, value.soundEnabled, value.telegramSchedule, value.telegramMessages, value.telegramMaterials]);
  return Response.json({ ok: true, ...value });
}
