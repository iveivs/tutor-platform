import pg from "pg";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const intervalMs = Number(process.env.JOB_INTERVAL_MS ?? 15 * 60 * 1000);
if (!Number.isFinite(intervalMs) || intervalMs < 10_000) throw new Error("JOB_INTERVAL_MS must be at least 10000");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
let stopping = false;
let wakeSleep;

function lessonPhotoStorage() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const configuredRegion = process.env.S3_REGION?.trim();
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region: configuredRegion && configuredRegion !== "auto" ? configuredRegion : "ru-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

const photoStorage = lessonPhotoStorage();

async function deleteExpiredLessonPhotos(client) {
  if (!photoStorage) return { deleted: 0, failed: 0 };
  const due = await client.query(`SELECT id, object_key FROM lesson_attachments
    WHERE status = 'deleting' OR (status = 'active' AND expires_at <= now())
    ORDER BY expires_at LIMIT 100`);
  let deleted = 0;
  let failed = 0;
  for (const attachment of due.rows) {
    try {
      await photoStorage.client.send(new DeleteObjectCommand({ Bucket: photoStorage.bucket, Key: String(attachment.object_key) }));
      await client.query("UPDATE lesson_attachments SET status = 'deleted', deleted_at = COALESCE(deleted_at, now()), updated_at = now() WHERE id = $1", [attachment.id]);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

async function enqueueTelegramReminders(client) {
  await client.query(`WITH upcoming AS (
      SELECT min(l.id) AS lesson_id, COALESCE(l.group_id, l.id) AS lesson_key, l.workspace_id, l.student_id,
        min(l.starts_at) AS starts_at, max(l.ends_at) AS ends_at, w.timezone,
        student.display_name AS student_name, owner.id AS owner_id, owner.display_name AS owner_name
      FROM lessons l
      JOIN workspaces w ON w.id = l.workspace_id
      JOIN members student ON student.id = l.student_id
      JOIN members owner ON owner.workspace_id = l.workspace_id AND owner.role = 'owner' AND owner.status = 'active'
      WHERE l.status = 'scheduled' AND l.starts_at > now() AND l.starts_at <= now() + interval '24 hours'
      GROUP BY COALESCE(l.group_id, l.id), l.workspace_id, l.student_id, w.timezone, student.display_name, owner.id, owner.display_name
    ), recipients AS (
      SELECT lesson_id, lesson_key, student_id AS member_id,
        'Напоминание об уроке' || E'\n' || to_char(starts_at AT TIME ZONE timezone, 'DD.MM.YYYY в HH24:MI') ||
        E'\nПреподаватель: ' || owner_name AS message FROM upcoming
      UNION ALL
      SELECT lesson_id, lesson_key, owner_id AS member_id,
        'Напоминание об уроке' || E'\n' || to_char(starts_at AT TIME ZONE timezone, 'DD.MM.YYYY в HH24:MI') ||
        E'\nУченик: ' || student_name AS message FROM upcoming
    )
    INSERT INTO telegram_deliveries (member_id, lesson_id, kind, dedupe_key, message)
    SELECT recipient.member_id, recipient.lesson_id, 'lesson_reminder',
      'lesson-reminder:' || recipient.lesson_key || ':' || recipient.member_id, recipient.message
    FROM recipients recipient
    JOIN telegram_connections connection ON connection.member_id = recipient.member_id AND connection.disabled_at IS NULL
    ON CONFLICT (dedupe_key) DO NOTHING`);
}

async function sendTelegram(chatId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const relayBaseUrl = process.env.TELEGRAM_API_BASE_URL?.trim().replace(/\/+$/, "");
  const relaySecret = process.env.TELEGRAM_RELAY_SECRET?.trim();
  if (!token && !(relayBaseUrl && relaySecret)) return { ok: false, permanent: false, reason: "not_configured" };
  try {
    const response = await fetch(relayBaseUrl ? `${relayBaseUrl}/sendMessage` : `https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(relayBaseUrl && relaySecret ? { "x-telegram-relay-secret": relaySecret } : {}),
      },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.ok) return { ok: true };
    return { ok: false, permanent: response.status === 403 || result?.error_code === 403, reason: `http_${result?.error_code ?? response.status}` };
  } catch (error) {
    return { ok: false, permanent: false, reason: error instanceof Error ? error.name.slice(0, 80) : "network_error" };
  }
}

async function deliverTelegramMessages(client) {
  const direct = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const relayed = Boolean(process.env.TELEGRAM_API_BASE_URL?.trim() && process.env.TELEGRAM_RELAY_SECRET?.trim());
  if (!direct && !relayed) return;
  await client.query("UPDATE telegram_deliveries SET status = 'pending', updated_at = now() WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'");
  for (let index = 0; index < 50; index += 1) {
    const claimed = await client.query(`WITH due AS (
        SELECT delivery.id FROM telegram_deliveries delivery
        JOIN telegram_connections connection ON connection.member_id = delivery.member_id AND connection.disabled_at IS NULL
        WHERE delivery.status = 'pending' AND delivery.next_attempt_at <= now()
        ORDER BY delivery.next_attempt_at, delivery.id FOR UPDATE OF delivery SKIP LOCKED LIMIT 1
      )
      UPDATE telegram_deliveries delivery SET status = 'sending', attempts = attempts + 1, updated_at = now()
      FROM due, telegram_connections connection
      WHERE delivery.id = due.id AND connection.member_id = delivery.member_id
      RETURNING delivery.id, delivery.member_id, delivery.message, delivery.attempts, connection.chat_id`);
    const delivery = claimed.rows[0];
    if (!delivery) break;
    const result = await sendTelegram(String(delivery.chat_id), String(delivery.message));
    if (result.ok) {
      await client.query("UPDATE telegram_deliveries SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now() WHERE id = $1", [delivery.id]);
    } else if (result.permanent) {
      await client.query("BEGIN");
      try {
        await client.query("UPDATE telegram_connections SET disabled_at = now(), updated_at = now() WHERE member_id = $1", [delivery.member_id]);
        await client.query("UPDATE telegram_deliveries SET status = 'cancelled', last_error = $2, updated_at = now() WHERE id = $1", [delivery.id, result.reason]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } else if (Number(delivery.attempts) >= 5) {
      await client.query("UPDATE telegram_deliveries SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1", [delivery.id, result.reason]);
    } else {
      const retryMinutes = Math.min(60, 2 ** Number(delivery.attempts));
      await client.query("UPDATE telegram_deliveries SET status = 'pending', next_attempt_at = now() + ($2 * interval '1 minute'), last_error = $3, updated_at = now() WHERE id = $1", [delivery.id, retryMinutes, result.reason]);
    }
  }
}

async function settleWorkspace(client, workspaceId, now) {
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO lesson_events (id, workspace_id, student_id, lesson_id, source_key, event_type, starts_at, ends_at, occurred_at)
      SELECT 'completed-' || l.id, l.workspace_id, l.student_id, l.id, 'lesson-completed:' || l.id, 'completed', l.starts_at, l.ends_at, l.ends_at
      FROM lessons l WHERE l.workspace_id = $1 AND l.status = 'scheduled' AND l.charge_status = 'pending' AND l.ends_at <= $2
        AND NOT EXISTS (SELECT 1 FROM lesson_requests r LEFT JOIN lessons requested ON requested.id = r.lesson_id
          WHERE r.type = 'cancel' AND r.status = 'pending' AND r.created_at <= r.cancellation_deadline_at
            AND (r.lesson_id = l.id OR (l.group_id IS NOT NULL AND requested.group_id = l.group_id)))
      ON CONFLICT DO NOTHING`, [workspaceId, now]);
    await client.query(`INSERT INTO balance_entries (id, workspace_id, student_id, lesson_id, kind, lesson_units, note, occurred_at, recorded_by_id)
      SELECT replace(gen_random_uuid()::text, '-', ''), l.workspace_id, l.student_id, l.id, 'lesson_charge', -1, 'Урок проведён', l.ends_at, l.created_by_id
      FROM lessons l WHERE l.workspace_id = $1 AND l.lesson_type = 'regular' AND l.status = 'scheduled' AND l.charge_status = 'pending' AND l.ends_at <= $2
        AND NOT EXISTS (SELECT 1 FROM lesson_requests r LEFT JOIN lessons requested ON requested.id = r.lesson_id
          WHERE r.type = 'cancel' AND r.status = 'pending' AND r.created_at <= r.cancellation_deadline_at
            AND (r.lesson_id = l.id OR (l.group_id IS NOT NULL AND requested.group_id = l.group_id)))
      ON CONFLICT DO NOTHING`, [workspaceId, now]);
    await client.query(`UPDATE lessons SET status = 'completed', charge_status = CASE WHEN lesson_type = 'trial' THEN 'waived' ELSE 'charged' END,
      completed_at = ends_at, updated_at = $2 WHERE workspace_id = $1 AND status = 'scheduled' AND charge_status = 'pending' AND ends_at <= $2
        AND NOT EXISTS (SELECT 1 FROM lesson_requests r LEFT JOIN lessons requested ON requested.id = r.lesson_id
          WHERE r.type = 'cancel' AND r.status = 'pending' AND r.created_at <= r.cancellation_deadline_at
            AND (r.lesson_id = lessons.id OR (lessons.group_id IS NOT NULL AND requested.group_id = lessons.group_id)))`, [workspaceId, now]);
    await client.query(`INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body)
      SELECT 'debt-' || l.id, l.student_id, l.student_id, l.id, 'negative_balance', 'Отрицательный баланс',
        'После урока баланс стал отрицательным. Пожалуйста, свяжитесь с преподавателем.'
      FROM lessons l WHERE l.workspace_id = $1 AND l.charge_status = 'charged' AND l.updated_at = $2
        AND (l.group_id IS NULL OR l.ends_at = (SELECT MAX(peer.ends_at) FROM lessons peer WHERE peer.group_id = l.group_id))
        AND (SELECT COALESCE(SUM(b.lesson_units), 0) FROM balance_entries b WHERE b.student_id = l.student_id) < 0
      ON CONFLICT DO NOTHING`, [workspaceId, now]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function runOnce() {
  const client = await pool.connect();
  let locked = false;
  let runId;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["tutor:lesson-maintenance"]);
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) {
      await client.query("INSERT INTO job_runs (job_name, status, finished_at, detail) VALUES ($1, 'skipped', now(), $2)", ["lesson-maintenance", "another worker holds the advisory lock"]);
      return;
    }
    const run = await client.query("INSERT INTO job_runs (job_name, status) VALUES ($1, 'running') RETURNING id", ["lesson-maintenance"]);
    runId = run.rows[0].id;
    const workspaces = await client.query("SELECT id FROM workspaces ORDER BY id");
    const now = new Date();
    for (const workspace of workspaces.rows) await settleWorkspace(client, String(workspace.id), now);
    await enqueueTelegramReminders(client);
    await deliverTelegramMessages(client);
    const photoCleanup = await deleteExpiredLessonPhotos(client);
    await client.query("DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'");
    await client.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days'");
    await client.query("DELETE FROM telegram_link_tokens WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days'");
    await client.query("DELETE FROM telegram_deliveries WHERE status IN ('sent', 'cancelled') AND updated_at < now() - interval '90 days'");
    await client.query("DELETE FROM rate_limit_buckets WHERE expires_at < now() - interval '1 hour'");
    await client.query("UPDATE job_runs SET status = 'succeeded', finished_at = now(), detail = $1 WHERE id = $2", [`processed ${workspaces.rowCount} workspaces; photos deleted ${photoCleanup.deleted}, failed ${photoCleanup.failed}`, runId]);
  } catch (error) {
    if (runId) await client.query("UPDATE job_runs SET status = 'failed', finished_at = now(), detail = $1 WHERE id = $2", [error instanceof Error ? error.message.slice(0, 1000) : "unknown error", runId]).catch(() => undefined);
    console.error(JSON.stringify({ event: "lesson_maintenance_failed", reason: error instanceof Error ? error.name : "unknown" }));
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["tutor:lesson-maintenance"]).catch(() => undefined);
    client.release();
  }
}

async function loop() {
  while (!stopping) {
    await runOnce();
    if (process.env.RUN_JOBS_ONCE === "true") break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      wakeSleep = () => { clearTimeout(timer); resolve(); };
    });
    wakeSleep = undefined;
  }
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; wakeSleep?.(); });
await loop();
