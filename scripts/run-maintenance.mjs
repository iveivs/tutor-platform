import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const intervalMs = Number(process.env.JOB_INTERVAL_MS ?? 15 * 60 * 1000);
if (!Number.isFinite(intervalMs) || intervalMs < 10_000) throw new Error("JOB_INTERVAL_MS must be at least 10000");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
let stopping = false;
let wakeSleep;

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
    await client.query("DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'");
    await client.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days'");
    await client.query("DELETE FROM rate_limit_buckets WHERE expires_at < now() - interval '1 hour'");
    await client.query("UPDATE job_runs SET status = 'succeeded', finished_at = now(), detail = $1 WHERE id = $2", [`processed ${workspaces.rowCount} workspaces`, runId]);
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
