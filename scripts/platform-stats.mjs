// Anonymized platform statistics, collected by the worker: only counts and sizes, never names,
// e-mails, message texts or file names. Load once an hour (kept 90 days), everything else in one
// row per Moscow day that is refreshed through the day and stays as the day's final value.
import { readFile, statfs } from "node:fs/promises";
import { cpus } from "node:os";

async function hostLoad() {
  const [loadavg, meminfo, disk] = await Promise.all([
    readFile("/proc/loadavg", "utf8").catch(() => ""),
    readFile("/proc/meminfo", "utf8").catch(() => ""),
    statfs("/").catch(() => null),
  ]);
  const memory = (key) => Number(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
  const memTotal = memory("MemTotal");
  return {
    cores: cpus().length,
    load1: Number(loadavg.split(" ")[0] ?? 0),
    memoryUsedBytes: memTotal ? memTotal - memory("MemAvailable") : null,
    memoryTotalBytes: memTotal || null,
    diskUsedBytes: disk ? (disk.blocks - disk.bfree) * disk.bsize : null,
    diskTotalBytes: disk ? disk.blocks * disk.bsize : null,
  };
}

async function writeHourlyLoad(client) {
  const exists = await client.query("SELECT 1 FROM platform_hourly_load WHERE hour = date_trunc('hour', now())");
  if (exists.rowCount) return;
  const [load, db, queues, live] = await Promise.all([
    hostLoad(),
    client.query("SELECT pg_database_size(current_database())::bigint AS bytes"),
    client.query(`SELECT (SELECT count(*) FROM telegram_deliveries WHERE status = 'pending')::int AS telegram,
      (SELECT count(*) FROM push_deliveries WHERE status = 'pending')::int AS push`),
    client.query("SELECT count(DISTINCT user_id)::int AS users FROM auth_sessions WHERE revoked_at IS NULL AND last_seen_at > now() - interval '1 hour'"),
  ]);
  await client.query("INSERT INTO platform_hourly_load (hour, data) VALUES (date_trunc('hour', now()), $1) ON CONFLICT (hour) DO NOTHING", [{
    ...load,
    databaseBytes: Number(db.rows[0].bytes),
    pendingTelegram: queues.rows[0].telegram,
    pendingPush: queues.rows[0].push,
    activeUsersHour: live.rows[0].users,
  }]);
  await client.query("DELETE FROM platform_hourly_load WHERE hour < now() - interval '90 days'");
}

const percentile = (values, share) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

async function writeDailyStats(client) {
  const day = "(now() AT TIME ZONE 'Europe/Moscow')::date";
  const since = `(${day})::timestamp AT TIME ZONE 'Europe/Moscow'`;
  const [totals, active, files, perWorkspace, actions, channels, load] = await Promise.all([
    client.query(`SELECT (SELECT count(*) FROM workspaces)::int AS workspaces,
        (SELECT count(*) FROM workspaces WHERE created_at >= ${since})::int AS workspaces_new,
        (SELECT count(*) FROM members WHERE role = 'student' AND status <> 'archived' AND NOT is_trial_contact)::int AS students,
        (SELECT count(*) FROM members WHERE role = 'student' AND NOT is_trial_contact AND created_at >= ${since})::int AS students_new,
        (SELECT count(*) FROM student_groups WHERE status = 'active')::int AS groups,
        (SELECT count(*) FROM workspaces WHERE access_grant = 'paid' AND access_status = 'active' AND (access_expires_at IS NULL OR access_expires_at > now()))::int AS paying`),
    // Active = had a session request in the window; no per-visit log is kept anywhere.
    client.query(`SELECT member.role IN ('owner', 'teacher') AS teacher,
        count(DISTINCT s.user_id) FILTER (WHERE s.last_seen_at >= ${since})::int AS day,
        count(DISTINCT s.user_id) FILTER (WHERE s.last_seen_at > now() - interval '7 days')::int AS week,
        count(DISTINCT s.user_id) FILTER (WHERE s.last_seen_at > now() - interval '30 days')::int AS month
      FROM auth_sessions s JOIN members member ON member.user_id = s.user_id AND member.status = 'active'
      GROUP BY 1`),
    client.query(`SELECT kind, count(*)::int AS files, COALESCE(sum(bytes), 0)::bigint AS bytes FROM (
        SELECT CASE WHEN content_type = 'application/pdf' THEN 'pdf' WHEN content_type LIKE 'image/%' THEN 'image'
          WHEN content_type LIKE 'audio/%' THEN 'audio' ELSE 'word' END AS kind, byte_size AS bytes
        FROM teacher_resources WHERE status = 'active'
        UNION ALL SELECT 'photo', byte_size FROM lesson_attachments WHERE status = 'active'
      ) f GROUP BY kind`),
    client.query(`SELECT w.id,
        (SELECT count(*) FROM members m WHERE m.workspace_id = w.id AND m.role = 'student' AND m.status <> 'archived' AND NOT m.is_trial_contact)::int AS students,
        (COALESCE((SELECT sum(byte_size) FROM teacher_resources r WHERE r.workspace_id = w.id AND r.status = 'active'), 0)
          + COALESCE((SELECT sum(byte_size) FROM lesson_attachments a WHERE a.workspace_id = w.id AND a.status = 'active'), 0))::bigint AS bytes
      FROM workspaces w`),
    client.query(`SELECT (SELECT count(*) FROM lessons WHERE created_at >= ${since})::int AS lessons,
        (SELECT count(*) FROM balance_entries WHERE kind = 'payment' AND created_at >= ${since})::int AS payments,
        (SELECT count(*) FROM lesson_requests WHERE created_at >= ${since})::int AS requests,
        (SELECT count(*) FROM direct_messages WHERE created_at >= ${since})::int AS direct_messages,
        (SELECT count(*) FROM group_chat_messages WHERE created_at >= ${since})::int AS group_messages,
        (SELECT count(*) FROM teacher_resource_upload_events WHERE created_at >= ${since})::int AS uploads,
        (SELECT count(*) FROM lesson_attachments WHERE created_at >= ${since})::int AS photos`),
    client.query(`SELECT (SELECT count(*) FROM members WHERE status = 'active' AND user_id IS NOT NULL)::int AS accounts,
        (SELECT count(DISTINCT member_id) FROM telegram_connections WHERE disabled_at IS NULL)::int AS telegram,
        (SELECT count(DISTINCT member_id) FROM push_subscriptions)::int AS push`),
    client.query(`SELECT avg((data->>'load1')::numeric) AS load_avg, max((data->>'load1')::numeric) AS load_peak,
        max((data->>'memoryUsedBytes')::bigint) AS memory_peak, max((data->>'activeUsersHour')::int) AS users_peak
      FROM platform_hourly_load WHERE hour >= ${since}`),
  ]);
  const byRole = Object.fromEntries(active.rows.map((row) => [row.teacher ? "teachers" : "students", { day: row.day, week: row.week, month: row.month }]));
  const students = perWorkspace.rows.map((row) => Number(row.students));
  const bytes = perWorkspace.rows.map((row) => Number(row.bytes));
  const data = {
    ...Object.fromEntries(Object.entries(totals.rows[0]).map(([key, value]) => [key.replace(/_(\w)/g, (_, c) => c.toUpperCase()), value])),
    active: { teachers: byRole.teachers ?? { day: 0, week: 0, month: 0 }, students: byRole.students ?? { day: 0, week: 0, month: 0 } },
    files: Object.fromEntries(files.rows.map((row) => [row.kind, { files: row.files, bytes: Number(row.bytes) }])),
    workspaceSize: {
      students: { median: percentile(students, 0.5), p90: percentile(students, 0.9), max: Math.max(0, ...students) },
      bytes: { median: percentile(bytes, 0.5), p90: percentile(bytes, 0.9), max: Math.max(0, ...bytes) },
      largestBytes: [...bytes].sort((a, b) => b - a).slice(0, 5),
    },
    actions: Object.fromEntries(Object.entries(actions.rows[0]).map(([key, value]) => [key.replace(/_(\w)/g, (_, c) => c.toUpperCase()), value])),
    channels: channels.rows[0],
    load: { avg: load.rows[0].load_avg == null ? null : Number(load.rows[0].load_avg), peak: load.rows[0].load_peak == null ? null : Number(load.rows[0].load_peak), memoryPeakBytes: load.rows[0].memory_peak == null ? null : Number(load.rows[0].memory_peak), activeUsersPeakHour: load.rows[0].users_peak },
  };
  await client.query(`INSERT INTO platform_daily_stats (day, data) VALUES (${day}, $1)
    ON CONFLICT (day) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [data]);
}

/** One call per worker cycle; a failure here never stops the lesson jobs. */
export async function collectPlatformStats(client) {
  await writeHourlyLoad(client);
  await writeDailyStats(client);
}
