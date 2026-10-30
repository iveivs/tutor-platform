import pg from "pg";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readVapidConfig, sendWebPush } from "./web-push.mjs";
import { accessReminderStage, accessReminderText } from "./access-reminders.mjs";
import { collectPlatformStats } from "./platform-stats.mjs";
import { compressAudio } from "./audio-compress.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const intervalMs = Number(process.env.JOB_INTERVAL_MS ?? 15 * 60 * 1000);
if (!Number.isFinite(intervalMs) || intervalMs < 10_000) throw new Error("JOB_INTERVAL_MS must be at least 10000");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
const vapid = readVapidConfig();
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
  // Lesson audio and documents follow the same rule: removed after their expiry or when deleted.
  const files = await client.query(`SELECT id, object_key FROM lesson_files
    WHERE status = 'deleting' OR (status = 'active' AND expires_at <= now()) ORDER BY expires_at LIMIT 100`);
  for (const file of files.rows) {
    try {
      await photoStorage.client.send(new DeleteObjectCommand({ Bucket: photoStorage.bucket, Key: String(file.object_key) }));
      await client.query("UPDATE lesson_files SET status = 'deleted', deleted_at = COALESCE(deleted_at, now()) WHERE id = $1", [file.id]);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

async function deleteTeacherMaterials(client) {
  if (!photoStorage) return { deleted: 0, failed: 0 };
  const due = await client.query(`SELECT id, object_key FROM teacher_resources
    WHERE status = 'deleting' ORDER BY updated_at LIMIT 100`);
  let deleted = 0;
  let failed = 0;
  for (const resource of due.rows) {
    try {
      await photoStorage.client.send(new DeleteObjectCommand({ Bucket: photoStorage.bucket, Key: String(resource.object_key) }));
      await client.query("UPDATE teacher_resources SET status = 'deleted', deleted_at = COALESCE(deleted_at, now()), updated_at = now() WHERE id = $1", [resource.id]);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  const replacedFiles = await client.query(`SELECT id, object_key FROM teacher_resource_file_cleanup
    ORDER BY created_at LIMIT 100`);
  for (const file of replacedFiles.rows) {
    try {
      await photoStorage.client.send(new DeleteObjectCommand({ Bucket: photoStorage.bucket, Key: String(file.object_key) }));
      await client.query("DELETE FROM teacher_resource_file_cleanup WHERE id = $1", [file.id]);
      deleted += 1;
    } catch {
      await client.query("UPDATE teacher_resource_file_cleanup SET updated_at = now() WHERE id = $1", [file.id]).catch(() => undefined);
      failed += 1;
    }
  }
  return { deleted, failed };
}

function membersLabel(count) {
  const word = count % 10 === 1 && count % 100 !== 11 ? "участник" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "участника" : "участников";
  return `${count} ${word}`;
}

// Who gets reminders on each external channel: Telegram needs an active connection,
// push needs at least one device subscription; both respect the "schedule" preference.
const reminderChannels = {
  telegram: {
    recipientFilter: (memberColumn) => `JOIN telegram_connections connection ON connection.member_id = ${memberColumn} AND connection.disabled_at IS NULL
      LEFT JOIN notification_preferences preference ON preference.member_id = ${memberColumn}`,
    preferenceCondition: "COALESCE(preference.telegram_schedule, true)",
  },
  push: {
    recipientFilter: (memberColumn) => `LEFT JOIN notification_preferences preference ON preference.member_id = ${memberColumn}`,
    preferenceCondition: "COALESCE(preference.push_schedule, true) AND EXISTS (SELECT 1 FROM push_subscriptions subscription WHERE subscription.member_id = preference_member.id)",
  },
};

// Student reminders as (member_id, lesson_id, dedupe_key, title, body) for one channel.
function studentReminderRowsSql(channel) {
  const { recipientFilter, preferenceCondition } = reminderChannels[channel];
  return `WITH upcoming AS (
      SELECT min(l.id) AS lesson_id, COALESCE(l.group_id, l.id) AS lesson_key, l.workspace_id, l.student_id,
        min(l.starts_at) AS starts_at, max(l.ends_at) AS ends_at, w.timezone,
        owner.display_name AS owner_name, class_group.name AS class_name,
        COALESCE((SELECT SUM(b.lesson_units) FROM balance_entries b WHERE b.student_id = l.student_id), 0)::int AS balance
      FROM lessons l
      JOIN workspaces w ON w.id = l.workspace_id
      JOIN members owner ON owner.workspace_id = l.workspace_id AND owner.role = 'owner' AND owner.status = 'active'
      LEFT JOIN student_groups class_group ON class_group.id = l.class_id
      WHERE l.status = 'scheduled' AND l.starts_at > now() AND l.starts_at <= now() + interval '24 hours'
        AND (w.access_expires_at IS NULL OR w.access_expires_at > now())
      GROUP BY COALESCE(l.group_id, l.id), l.workspace_id, l.student_id, w.timezone, owner.display_name, class_group.name
    )
    SELECT student_id AS member_id, lesson_id,
      'lesson-reminder:' || lesson_key || ':' || student_id AS dedupe_key,
      'Напоминание об уроке' AS title,
      to_char(starts_at AT TIME ZONE timezone, 'DD.MM.YYYY в HH24:MI') ||
      CASE WHEN class_name IS NOT NULL THEN E'\\nГруппа: ' || class_name ELSE '' END ||
      E'\\nПреподаватель: ' || owner_name ||
      -- Same balance as in the student portal: sum of the student's balance entries at reminder time.
      E'\\nБаланс: ' || CASE WHEN balance < 0 THEN 'долг ' ELSE '' END || abs(balance) || ' ' ||
      CASE WHEN abs(balance) % 10 = 1 AND abs(balance) % 100 <> 11 THEN 'занятие'
        WHEN abs(balance) % 10 BETWEEN 2 AND 4 AND abs(balance) % 100 NOT BETWEEN 12 AND 14 THEN 'занятия'
        ELSE 'занятий' END AS body
    FROM upcoming
    JOIN members preference_member ON preference_member.id = student_id
    ${recipientFilter("student_id")}
    WHERE ${preferenceCondition}`;
}

// One digest per owner and lesson day, as title + body lines, for one channel.
async function teacherDigests(client, channel) {
  const { recipientFilter, preferenceCondition } = reminderChannels[channel];
  const result = await client.query(`WITH trigger_days AS (
      SELECT DISTINCT l.workspace_id, owner.id AS owner_id, w.timezone,
        (l.starts_at AT TIME ZONE w.timezone)::date AS lesson_date
      FROM lessons l
      JOIN workspaces w ON w.id = l.workspace_id
      JOIN members owner ON owner.workspace_id = l.workspace_id AND owner.role = 'owner' AND owner.status = 'active'
      JOIN members preference_member ON preference_member.id = owner.id
      ${recipientFilter("owner.id")}
      WHERE l.status = 'scheduled' AND l.starts_at > now() AND l.starts_at <= now() + interval '24 hours'
        AND (w.access_expires_at IS NULL OR w.access_expires_at > now())
        AND ${preferenceCondition}
    ), day_lessons AS (
      SELECT days.workspace_id, days.owner_id, days.timezone, days.lesson_date,
        min(l.id) AS lesson_id, min(l.starts_at) AS starts_at, max(l.ends_at) AS ends_at,
        count(*)::int AS lesson_count, bool_or(l.class_id IS NOT NULL) AS is_group,
        min(CASE WHEN l.class_id IS NOT NULL THEN class_group.name ELSE student.display_name END) AS student_name
      FROM trigger_days days
      JOIN lessons l ON l.workspace_id = days.workspace_id
        AND l.status = 'scheduled'
        AND l.starts_at > now()
        AND (l.starts_at AT TIME ZONE days.timezone)::date = days.lesson_date
      JOIN members student ON student.id = l.student_id
      LEFT JOIN student_groups class_group ON class_group.id = l.class_id
      -- A group session (one row per member) is one line of the digest.
      GROUP BY days.workspace_id, days.owner_id, days.timezone, days.lesson_date,
        COALESCE(l.group_id, l.class_id || ':' || l.starts_at::text, l.id)
    )
    SELECT owner_id AS member_id, workspace_id, lesson_date::text AS lesson_date,
      min(lesson_id) AS lesson_id,
      to_char(lesson_date, 'DD.MM.YYYY') AS date_label,
      lesson_date = ((now() AT TIME ZONE timezone)::date + 1) AS is_tomorrow,
      json_agg(json_build_object(
        'start', to_char(starts_at AT TIME ZONE timezone, 'HH24:MI'),
        'end', to_char(ends_at AT TIME ZONE timezone, 'HH24:MI'),
        'studentName', student_name,
        'lessonCount', lesson_count,
        'isGroup', is_group
      ) ORDER BY starts_at, student_name) AS lessons
    FROM day_lessons
    GROUP BY owner_id, workspace_id, timezone, lesson_date
    ORDER BY lesson_date, owner_id`);
  return result.rows.map((digest) => {
    const lessons = Array.isArray(digest.lessons) ? digest.lessons : [];
    return {
      memberId: digest.member_id,
      lessonId: digest.lesson_id,
      dedupeKey: `lesson-reminder-day:${digest.workspace_id}:${digest.lesson_date}:${digest.member_id}`,
      title: digest.is_tomorrow ? "Расписание на завтра" : "Расписание на сегодня",
      body: [
        String(digest.date_label),
        ...lessons.map((lesson) => `• ${lesson.start}–${lesson.end} — ${lesson.studentName}${lesson.isGroup ? ` · группа, ${membersLabel(Number(lesson.lessonCount))}` : Number(lesson.lessonCount) > 1 ? " · двойной урок" : ""}`),
      ].join("\n"),
    };
  });
}

// The owner of a workspace whose access ends soon (or has just ended) gets an in-app notification,
// Telegram and push. workspace_access_reminders makes each stage go out once per end date.
async function enqueueAccessReminders(client) {
  const due = await client.query(`SELECT w.id, w.access_grant, w.access_expires_at, w.access_expires_at <= now() AS ended,
      (w.access_expires_at AT TIME ZONE w.timezone)::date - (now() AT TIME ZONE w.timezone)::date AS days_left,
      to_char(w.access_expires_at AT TIME ZONE w.timezone, 'DD.MM.YYYY') AS end_label, owner.id AS owner_id
    FROM workspaces w
    JOIN members owner ON owner.id = (SELECT m.id FROM members m WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1)
    WHERE w.access_status = 'active' AND w.access_expires_at IS NOT NULL
      AND w.access_expires_at > now() - interval '3 days' AND w.access_expires_at <= now() + interval '8 days'`);
  for (const row of due.rows) {
    const daysLeft = Number(row.days_left);
    const stage = accessReminderStage(daysLeft, Boolean(row.ended));
    if (stage === null) continue;
    const { title, body } = accessReminderText({ stage, daysLeft, accessGrant: String(row.access_grant), endLabel: String(row.end_label) });
    await client.query("BEGIN");
    try {
      const claimed = await client.query(`INSERT INTO workspace_access_reminders (workspace_id, access_expires_at, stage)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [row.id, row.access_expires_at, stage]);
      if (claimed.rowCount) {
        const dedupeKey = `access:${row.id}:${new Date(row.access_expires_at).toISOString()}:${stage}`;
        await client.query(`INSERT INTO notifications (id, member_id, type, title, body)
          VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`, [row.owner_id, stage === 0 ? "access_ended" : "access_expiring", title, body]);
        await client.query(`INSERT INTO telegram_deliveries (member_id, kind, dedupe_key, message)
          SELECT connection.member_id, 'account', $2, $3 FROM telegram_connections connection
          WHERE connection.member_id = $1 AND connection.disabled_at IS NULL
          ON CONFLICT (dedupe_key) DO NOTHING`, [row.owner_id, dedupeKey, `${title}\n${body}`]);
        if (vapid) await client.query(`INSERT INTO push_deliveries (member_id, kind, dedupe_key, title, body)
          SELECT $1, 'account', $2, $3, $4 WHERE EXISTS (SELECT 1 FROM push_subscriptions subscription WHERE subscription.member_id = $1)
          ON CONFLICT (dedupe_key) DO NOTHING`, [row.owner_id, dedupeKey, title, body]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

async function enqueueTelegramReminders(client) {
  await client.query(`UPDATE telegram_deliveries delivery
    SET status = 'cancelled', updated_at = now()
    FROM members recipient
    WHERE delivery.member_id = recipient.id
      AND recipient.role IN ('owner', 'teacher')
      AND delivery.kind = 'lesson_reminder'
      AND delivery.status IN ('pending', 'failed')
      AND delivery.dedupe_key LIKE 'lesson-reminder:%'
      AND delivery.dedupe_key NOT LIKE 'lesson-reminder-day:%'`);

  await client.query(`INSERT INTO telegram_deliveries (member_id, lesson_id, kind, dedupe_key, message)
    SELECT member_id, lesson_id, 'lesson_reminder', dedupe_key, title || E'\\n' || body
    FROM (${studentReminderRowsSql("telegram")}) reminder
    ON CONFLICT (dedupe_key) DO NOTHING`);

  for (const digest of await teacherDigests(client, "telegram")) {
    await client.query(`INSERT INTO telegram_deliveries (member_id, lesson_id, kind, dedupe_key, message)
      VALUES ($1, $2, 'lesson_reminder', $3, $4)
      ON CONFLICT (dedupe_key) DO NOTHING`, [digest.memberId, digest.lessonId, digest.dedupeKey, `${digest.title}\n${digest.body}`]);
  }
}

async function enqueuePushReminders(client) {
  if (!vapid) return;
  await client.query(`INSERT INTO push_deliveries (member_id, lesson_id, kind, dedupe_key, title, body)
    SELECT member_id, lesson_id, 'lesson_reminder', dedupe_key, title, body
    FROM (${studentReminderRowsSql("push")}) reminder
    ON CONFLICT (dedupe_key) DO NOTHING`);
  for (const digest of await teacherDigests(client, "push")) {
    await client.query(`INSERT INTO push_deliveries (member_id, lesson_id, kind, dedupe_key, title, body)
      VALUES ($1, $2, 'lesson_reminder', $3, $4, $5)
      ON CONFLICT (dedupe_key) DO NOTHING`, [digest.memberId, digest.lessonId, digest.dedupeKey, digest.title, digest.body]);
  }
}


// A read-only workspace (paid access ended) gets no external messages except its access notices.
const cancelReadOnlySql = (table) => `UPDATE ${table} delivery SET status = 'cancelled', last_error = 'read_only', updated_at = now()
  FROM members recipient JOIN workspaces workspace ON workspace.id = recipient.workspace_id
  WHERE delivery.member_id = recipient.id AND delivery.status = 'pending' AND delivery.kind <> 'account'
    AND workspace.access_expires_at IS NOT NULL AND workspace.access_expires_at <= now()`;

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
  await client.query(cancelReadOnlySql("telegram_deliveries"));
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

const englishPushText = {
  lesson_reminder: "Lesson reminder",
  schedule_changed: "Schedule update",
  new_request: "New student request",
  new_message: "New message",
  new_material: "New lesson material",
  account: "Your Tyuttori access",
  test: "Test notification",
};

// Same number as the in-app counter: unread among the latest 30 notifications, and for a
// teacher pending requests instead of their "new request" notifications.
async function pushBadgeCount(client, memberId, role) {
  const result = await client.query(`SELECT
      (SELECT count(*) FROM (SELECT read_at, type FROM notifications WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30) recent
        WHERE recent.read_at IS NULL AND ($2::text = 'student' OR recent.type <> 'new_request'))::int
      + CASE WHEN $2::text = 'student' THEN 0 ELSE (SELECT count(*) FROM lesson_requests request
        JOIN members recipient ON recipient.id = $1 WHERE request.workspace_id = recipient.workspace_id AND request.status = 'pending')::int END AS count`, [memberId, role]);
  return Number(result.rows[0]?.count ?? 0);
}

function pushMessage(delivery, language, badge) {
  const teacher = delivery.role !== "student";
  const english = language === "en";
  const isTest = delivery.kind === "test";
  return {
    title: english ? (teacher && delivery.kind === "lesson_reminder" ? "Upcoming lessons" : englishPushText[delivery.kind] ?? "Tyuttori") : String(delivery.title),
    body: english ? (isTest ? "Notifications on this device are working." : "Open Tyuttori to see the details.") : String(delivery.body),
    url: !teacher || isTest ? "/" : delivery.kind === "lesson_reminder" ? "/?view=today" : delivery.kind === "account" ? "/?view=settings" : "/?view=activity",
    badge,
    tag: delivery.kind === "new_message" ? "new_message" : `delivery-${delivery.id}`,
  };
}

async function deliverPushMessages(client) {
  if (!vapid) return;
  await client.query("UPDATE push_deliveries SET status = 'pending', updated_at = now() WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'");
  await client.query(cancelReadOnlySql("push_deliveries"));
  for (let index = 0; index < 100; index += 1) {
    const claimed = await client.query(`WITH due AS (
        SELECT delivery.id FROM push_deliveries delivery
        WHERE delivery.status = 'pending' AND delivery.next_attempt_at <= now()
        ORDER BY delivery.next_attempt_at, delivery.id FOR UPDATE OF delivery SKIP LOCKED LIMIT 1
      )
      UPDATE push_deliveries delivery SET status = 'sending', attempts = attempts + 1, updated_at = now()
      FROM due, members recipient, workspaces workspace
      WHERE delivery.id = due.id AND recipient.id = delivery.member_id AND workspace.id = recipient.workspace_id
      RETURNING delivery.id, delivery.member_id, delivery.kind, delivery.title, delivery.body, delivery.attempts,
        recipient.role, recipient.status = 'active' AND workspace.access_status <> 'blocked' AS can_receive`);
    const delivery = claimed.rows[0];
    if (!delivery) break;
    const subscriptions = delivery.can_receive
      ? (await client.query("SELECT id, endpoint, p256dh, auth, language FROM push_subscriptions WHERE member_id = $1", [delivery.member_id])).rows
      : [];
    if (subscriptions.length === 0) {
      await client.query("UPDATE push_deliveries SET status = 'cancelled', last_error = 'no_subscription', updated_at = now() WHERE id = $1", [delivery.id]);
      continue;
    }
    const badge = await pushBadgeCount(client, delivery.member_id, String(delivery.role));
    let delivered = false;
    let retry = false;
    let reason = null;
    for (const subscription of subscriptions) {
      const result = await sendWebPush(subscription, pushMessage(delivery, subscription.language, badge), vapid, {
        urgency: delivery.kind === "new_message" || delivery.kind === "test" ? "high" : "normal",
      });
      if (result.outcome === "ok") {
        delivered = true;
        await client.query("UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1", [subscription.id]);
      } else if (result.outcome === "gone") {
        await client.query("DELETE FROM push_subscriptions WHERE id = $1", [subscription.id]);
      } else {
        reason = result.reason;
        if (result.outcome === "retry") retry = true;
      }
    }
    if (delivered) {
      await client.query("UPDATE push_deliveries SET status = 'sent', sent_at = now(), last_error = $2, updated_at = now() WHERE id = $1", [delivery.id, reason]);
    } else if (!retry && !reason) {
      await client.query("UPDATE push_deliveries SET status = 'cancelled', last_error = 'subscriptions_expired', updated_at = now() WHERE id = $1", [delivery.id]);
    } else if (!retry || Number(delivery.attempts) >= 5) {
      await client.query("UPDATE push_deliveries SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1", [delivery.id, reason]);
    } else {
      const retryMinutes = Math.min(60, 2 ** Number(delivery.attempts));
      await client.query("UPDATE push_deliveries SET status = 'pending', next_attempt_at = now() + ($2 * interval '1 minute'), last_error = $3, updated_at = now() WHERE id = $1", [delivery.id, retryMinutes, reason]);
    }
  }
}

// Push is delivered within seconds: a LISTEN connection wakes this runner on every new
// push_deliveries row, and a one-minute timer picks up retries. Telegram keeps its cycle.
let pushRun = null;
let pushAgain = false;

function runPushDeliveries() {
  if (!vapid || stopping) return Promise.resolve();
  if (pushRun) {
    pushAgain = true;
    return pushRun;
  }
  pushRun = (async () => {
    do {
      pushAgain = false;
      const client = await pool.connect();
      let locked = false;
      try {
        const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["tutor:push-delivery"]);
        locked = Boolean(lock.rows[0]?.locked);
        if (locked) await deliverPushMessages(client);
      } finally {
        if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["tutor:push-delivery"]).catch(() => undefined);
        client.release();
      }
    } while (pushAgain && !stopping);
  })().catch((error) => {
    console.error(JSON.stringify({ event: "push_delivery_failed", reason: error instanceof Error ? error.name : "unknown" }));
  }).finally(() => {
    pushRun = null;
  });
  return pushRun;
}

let stopPushListener;

async function listenForPushDeliveries() {
  const retryTimer = setInterval(() => void runPushDeliveries(), 60_000);
  let debounce;
  while (!stopping) {
    const listener = new pg.Client({ connectionString: databaseUrl, application_name: "tutor-push-listener" });
    try {
      await listener.connect();
      await listener.query("LISTEN tutor_push_deliveries");
      listener.on("notification", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => void runPushDeliveries(), 200);
      });
      void runPushDeliveries();
      await new Promise((resolve) => {
        listener.once("error", resolve);
        listener.once("end", resolve);
        stopPushListener = resolve;
      });
    } catch {
      // Reconnect below; the retry timer still delivers in the meantime.
    } finally {
      stopPushListener = undefined;
      await listener.end().catch(() => undefined);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  clearInterval(retryTimer);
  clearTimeout(debounce);
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
    await client.query(`INSERT INTO balance_entries (id, workspace_id, student_id, lesson_id, kind, lesson_units, amount_cents, note, occurred_at, recorded_by_id)
      SELECT replace(gen_random_uuid()::text, '-', ''), l.workspace_id, l.student_id, l.id, 'lesson_charge', -1,
        CASE WHEN l.group_id IS NOT NULL AND m.double_lesson_price_cents IS NOT NULL THEN CASE WHEN l.id = (SELECT MIN(part.id) FROM lessons part WHERE part.group_id = l.group_id) THEN m.double_lesson_price_cents - m.double_lesson_price_cents / 2 ELSE m.double_lesson_price_cents / 2 END ELSE m.lesson_price_cents END, 'Урок проведён', l.ends_at, l.created_by_id
      FROM lessons l JOIN members m ON m.id = l.student_id WHERE l.workspace_id = $1 AND l.lesson_type = 'regular' AND l.status = 'scheduled' AND l.charge_status = 'pending' AND l.ends_at <= $2
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
    await enqueueAccessReminders(client);
    await enqueueTelegramReminders(client);
    await deliverTelegramMessages(client);
    await enqueuePushReminders(client);
    await runPushDeliveries();
    await collectPlatformStats(client).catch((error) => console.error(JSON.stringify({ event: "platform_stats_failed", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" })));
    await compressAudio(client, photoStorage).catch(() => undefined);
    const photoCleanup = await deleteExpiredLessonPhotos(client);
    const materialCleanup = await deleteTeacherMaterials(client);
    await client.query("DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'");
    await client.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days'");
    await client.query("DELETE FROM telegram_link_tokens WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days'");
    await client.query("DELETE FROM telegram_deliveries WHERE status IN ('sent', 'cancelled') AND updated_at < now() - interval '90 days'");
    await client.query("DELETE FROM push_deliveries WHERE status IN ('sent', 'cancelled', 'failed') AND updated_at < now() - interval '30 days'");
    await client.query("DELETE FROM rate_limit_buckets WHERE expires_at < now() - interval '1 hour'");
    await client.query("UPDATE job_runs SET status = 'succeeded', finished_at = now(), detail = $1 WHERE id = $2", [`processed ${workspaces.rowCount} workspaces; photos deleted ${photoCleanup.deleted}, failed ${photoCleanup.failed}; materials deleted ${materialCleanup.deleted}, failed ${materialCleanup.failed}`, runId]);
  } catch (error) {
    if (runId) await client.query("UPDATE job_runs SET status = 'failed', finished_at = now(), detail = $1 WHERE id = $2", [error instanceof Error ? error.message.slice(0, 1000) : "unknown error", runId]).catch(() => undefined);
    console.error(JSON.stringify({ event: "lesson_maintenance_failed", reason: error instanceof Error ? error.name : "unknown" }));
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["tutor:lesson-maintenance"]).catch(() => undefined);
    client.release();
  }
}

async function loop() {
  const pushListener = vapid && process.env.RUN_JOBS_ONCE !== "true" ? listenForPushDeliveries() : Promise.resolve();
  while (!stopping) {
    await runOnce();
    if (process.env.RUN_JOBS_ONCE === "true") break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      wakeSleep = () => { clearTimeout(timer); resolve(); };
    });
    wakeSleep = undefined;
  }
  stopping = true;
  stopPushListener?.();
  await pushListener;
  await pushRun;
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; wakeSleep?.(); stopPushListener?.(); });
await loop();
