import type { Pool, PoolClient } from "pg";

type Executor = Pool | PoolClient;

/**
 * A message from the platform admin to one member: an in-app notification plus Telegram and push
 * (kind «account», so it is delivered even while the workspace is read-only).
 */
export async function notifyFromAdmin(db: Executor, memberId: string, type: string, title: string, body: string, dedupeKey: string) {
  await db.query("INSERT INTO notifications (id, member_id, type, title, body) VALUES (gen_random_uuid()::text, $1, $2, $3, $4)", [memberId, type, title, body]);
  await db.query(`INSERT INTO telegram_deliveries (member_id, kind, dedupe_key, message)
    SELECT member_id, 'account', $2, $3 FROM telegram_connections WHERE member_id = $1 AND disabled_at IS NULL
    ON CONFLICT (dedupe_key) DO NOTHING`, [memberId, dedupeKey, `${title}\n${body}`]);
  await db.query(`INSERT INTO push_deliveries (member_id, kind, dedupe_key, title, body)
    SELECT $1, 'account', $2, $3, $4 WHERE EXISTS (SELECT 1 FROM push_subscriptions WHERE member_id = $1)
    ON CONFLICT (dedupe_key) DO NOTHING`, [memberId, dedupeKey, title, body]);
}

/** The owner member of a workspace, who receives admin messages for it. */
export async function workspaceOwner(db: Executor, workspaceId: string) {
  const result = await db.query("SELECT id FROM members WHERE workspace_id = $1 AND role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1", [workspaceId]);
  return result.rows[0] ? String(result.rows[0].id) : null;
}

/** «iPhone · Safari» from a User-Agent, enough to reproduce a bug; never the full string. */
export function deviceLabel(userAgent: string | null) {
  if (!userAgent) return null;
  const device = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "Устройство";
  const browser = /YaBrowser/.test(userAgent) ? "Яндекс Браузер" : /Edg\//.test(userAgent) ? "Edge" : /CriOS|Chrome\//.test(userAgent) ? "Chrome" : /FxiOS|Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "браузер";
  return `${device} · ${browser}`;
}
