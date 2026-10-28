import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";

export const runtime = "nodejs";

// Every field is optional: the Telegram and push cards each send only what they change.
const preferencesSchema = z.object({
  soundEnabled: z.boolean(),
  telegramSchedule: z.boolean(),
  telegramMessages: z.boolean(),
  telegramMaterials: z.boolean(),
  pushSchedule: z.boolean(),
  pushMessages: z.boolean(),
  pushMaterials: z.boolean(),
}).partial().strict();

const defaults = {
  soundEnabled: true,
  telegramSchedule: true,
  telegramMessages: false,
  telegramMaterials: false,
  pushSchedule: true,
  pushMessages: true,
  pushMaterials: true,
};

const columns = "sound_enabled, telegram_schedule, telegram_messages, telegram_materials, push_schedule, push_messages, push_materials";

function toPreferences(row: Record<string, unknown> | undefined) {
  return row ? {
    soundEnabled: Boolean(row.sound_enabled),
    telegramSchedule: Boolean(row.telegram_schedule),
    telegramMessages: Boolean(row.telegram_messages),
    telegramMaterials: Boolean(row.telegram_materials),
    pushSchedule: Boolean(row.push_schedule),
    pushMessages: Boolean(row.push_messages),
    pushMaterials: Boolean(row.push_materials),
  } : defaults;
}

export async function GET(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const result = await getPostgresPool().query(`SELECT ${columns} FROM notification_preferences WHERE member_id = $1`, [auth.memberId]);
  return Response.json(toPreferences(result.rows[0]), { headers: { "Cache-Control": "no-store" } });
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
  const result = await getPostgresPool().query(`INSERT INTO notification_preferences (member_id, ${columns})
    VALUES ($1, COALESCE($2, $9), COALESCE($3, $10), COALESCE($4, $11), COALESCE($5, $12), COALESCE($6, $13), COALESCE($7, $14), COALESCE($8, $15))
    ON CONFLICT (member_id) DO UPDATE SET
      sound_enabled = COALESCE($2, notification_preferences.sound_enabled),
      telegram_schedule = COALESCE($3, notification_preferences.telegram_schedule),
      telegram_messages = COALESCE($4, notification_preferences.telegram_messages),
      telegram_materials = COALESCE($5, notification_preferences.telegram_materials),
      push_schedule = COALESCE($6, notification_preferences.push_schedule),
      push_messages = COALESCE($7, notification_preferences.push_messages),
      push_materials = COALESCE($8, notification_preferences.push_materials),
      updated_at = now()
    RETURNING ${columns}`, [
    auth.memberId,
    value.soundEnabled ?? null, value.telegramSchedule ?? null, value.telegramMessages ?? null, value.telegramMaterials ?? null,
    value.pushSchedule ?? null, value.pushMessages ?? null, value.pushMaterials ?? null,
    defaults.soundEnabled, defaults.telegramSchedule, defaults.telegramMessages, defaults.telegramMaterials,
    defaults.pushSchedule, defaults.pushMessages, defaults.pushMaterials,
  ]);
  return Response.json({ ok: true, ...toPreferences(result.rows[0]) });
}
