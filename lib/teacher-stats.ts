import type { Pool } from "pg";

// Teacher statistics for a period of local (workspace time zone) dates, both ends inclusive.
// A double lesson is two lesson rows sharing group_id and counts as one lesson here; so does a group session
// (one row per member sharing class_id and start), which is held if at least one member had it.

export type TeacherStatsStudent = { id: string; name: string; lessons: number; chargedCents: number; balance: number };
export type TeacherStats = {
  from: string;
  to: string;
  currency: string | null;
  lessons: { completed: number; previousCompleted: number; minutes: number; trial: number; cancelled: number; planned: number; rescheduled: number };
  money: { receivedCents: number; payments: number; chargedCents: number; debtStudents: number; debtLessons: number; debtCents: number };
  people: { workingDays: number; activeStudents: number; newStudents: number; paused: number };
  daily: Array<{ date: string; lessons: number }>;
  students: TeacherStatsStudent[];
};

export type LessonRow = { lesson_key: string; student_ids: string[]; local_date: string; minutes: number; status: string; trial: boolean };

const shiftDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
export const periodLength = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

// Pure part: lesson rows of the period to counters and the per-day series.
export function summarizeLessons(rows: LessonRow[], from: string, to: string) {
  const completed = rows.filter((row) => row.status === "completed");
  const counts = new Map<string, number>();
  for (const row of completed) counts.set(row.local_date, (counts.get(row.local_date) ?? 0) + 1);
  const daily: Array<{ date: string; lessons: number }> = [];
  for (let date = from; date <= to; date = shiftDays(date, 1)) daily.push({ date, lessons: counts.get(date) ?? 0 });
  return {
    completed: completed.length,
    minutes: completed.reduce((sum, row) => sum + row.minutes, 0),
    trial: completed.filter((row) => row.trial).length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    planned: rows.filter((row) => row.status === "scheduled").length,
    workingDays: counts.size,
    activeStudents: new Set(completed.flatMap((row) => row.student_ids)).size,
    daily,
  };
}

const LESSON_KEY = "COALESCE(l.group_id, l.class_id || ':' || l.starts_at::text, l.id)";
const LESSONS_SQL = `SELECT ${LESSON_KEY} AS lesson_key, COALESCE(array_agg(DISTINCT l.student_id) FILTER (WHERE l.status = 'completed'), '{}') AS student_ids,
    to_char((min(l.starts_at) AT TIME ZONE w.timezone)::date, 'YYYY-MM-DD') AS local_date,
    (EXTRACT(EPOCH FROM max(l.ends_at) - min(l.starts_at)) / 60)::int AS minutes,
    CASE WHEN bool_or(l.status = 'completed') THEN 'completed' WHEN bool_and(l.status = 'cancelled') THEN 'cancelled' ELSE 'scheduled' END AS status,
    bool_or(l.lesson_type = 'trial') AS trial
  FROM lessons l JOIN workspaces w ON w.id = l.workspace_id
  JOIN members student ON student.id = l.student_id AND student.is_trial_contact = false
  WHERE l.workspace_id = $1 AND (l.starts_at AT TIME ZONE w.timezone)::date BETWEEN $2::date AND $3::date
  GROUP BY ${LESSON_KEY}, w.timezone`;

export async function loadTeacherStats(pool: Pool, workspaceId: string, from: string, to: string): Promise<TeacherStats> {
  const length = periodLength(from, to);
  const previousFrom = shiftDays(from, -length);
  const previousTo = shiftDays(from, -1);
  const inPeriod = (column: string) => `(${column} AT TIME ZONE w.timezone)::date BETWEEN $2::date AND $3::date`;
  const [lessons, previous, rescheduled, payments, charges, debts, newStudents, paused, perStudent, currencies] = await Promise.all([
    pool.query<LessonRow>(LESSONS_SQL, [workspaceId, from, to]),
    pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM (${LESSONS_SQL}) period WHERE status = 'completed'`, [workspaceId, previousFrom, previousTo]),
    pool.query<{ count: number }>(`SELECT count(DISTINCT ${LESSON_KEY})::int AS count FROM lesson_events e
      JOIN lessons l ON l.id = e.lesson_id JOIN workspaces w ON w.id = e.workspace_id
      WHERE e.workspace_id = $1 AND e.event_type = 'rescheduled' AND ${inPeriod("e.occurred_at")}`, [workspaceId, from, to]),
    pool.query<{ count: number; amount: string | null }>(`SELECT count(*)::int AS count, sum(b.amount_cents) AS amount FROM balance_entries b
      JOIN workspaces w ON w.id = b.workspace_id
      WHERE b.workspace_id = $1 AND b.kind = 'payment' AND ${inPeriod("b.occurred_at")}
        AND NOT EXISTS (SELECT 1 FROM balance_entries reversal WHERE reversal.reverses_entry_id = b.id)`, [workspaceId, from, to]),
    pool.query<{ amount: string | null }>(`SELECT sum(b.amount_cents) AS amount FROM balance_entries b JOIN workspaces w ON w.id = b.workspace_id
      WHERE b.workspace_id = $1 AND b.kind = 'lesson_charge' AND ${inPeriod("b.occurred_at")}`, [workspaceId, from, to]),
    pool.query<{ students: number; lessons: number; amount: string | null }>(`SELECT count(*)::int AS students, COALESCE(sum(-balance), 0)::int AS lessons, sum(-balance * lesson_price_cents) AS amount
      FROM (SELECT m.lesson_price_cents, COALESCE((SELECT sum(b.lesson_units) FROM balance_entries b WHERE b.student_id = m.id), 0) AS balance
        FROM members m WHERE m.workspace_id = $1 AND m.role = 'student' AND m.status <> 'archived' AND m.is_trial_contact = false) s
      WHERE balance < 0`, [workspaceId]),
    pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1 AND m.role = 'student' AND m.is_trial_contact = false AND ${inPeriod("m.created_at")}`, [workspaceId, from, to]),
    pool.query<{ count: number }>(`SELECT count(DISTINCT e.student_id)::int AS count FROM lesson_events e JOIN workspaces w ON w.id = e.workspace_id
      WHERE e.workspace_id = $1 AND e.event_type = 'series_stopped' AND ${inPeriod("e.occurred_at")}`, [workspaceId, from, to]),
    pool.query<{ id: string; name: string; lessons: number; charged: string | null; balance: number }>(`SELECT m.id, m.display_name AS name,
        count(DISTINCT COALESCE(l.group_id, l.id))::int AS lessons,
        (SELECT sum(b.amount_cents) FROM balance_entries b WHERE b.student_id = m.id AND b.kind = 'lesson_charge' AND ${inPeriod("b.occurred_at")}) AS charged,
        COALESCE((SELECT sum(b.lesson_units) FROM balance_entries b WHERE b.student_id = m.id), 0)::int AS balance
      FROM lessons l JOIN members m ON m.id = l.student_id AND m.is_trial_contact = false JOIN workspaces w ON w.id = l.workspace_id
      WHERE l.workspace_id = $1 AND l.status = 'completed' AND ${inPeriod("l.starts_at")}
      GROUP BY m.id, m.display_name, w.timezone ORDER BY lessons DESC, m.display_name LIMIT 8`, [workspaceId, from, to]),
    pool.query<{ currency: string }>(`SELECT DISTINCT price_currency AS currency FROM members
      WHERE workspace_id = $1 AND role = 'student' AND price_currency IS NOT NULL`, [workspaceId]),
  ]);
  const summary = summarizeLessons(lessons.rows, from, to);
  return {
    from, to,
    currency: currencies.rows.length === 1 ? currencies.rows[0].currency : null,
    lessons: { completed: summary.completed, previousCompleted: previous.rows[0]?.count ?? 0, minutes: summary.minutes, trial: summary.trial, cancelled: summary.cancelled, planned: summary.planned, rescheduled: rescheduled.rows[0]?.count ?? 0 },
    money: {
      receivedCents: Number(payments.rows[0]?.amount ?? 0), payments: payments.rows[0]?.count ?? 0, chargedCents: Number(charges.rows[0]?.amount ?? 0),
      debtStudents: debts.rows[0]?.students ?? 0, debtLessons: debts.rows[0]?.lessons ?? 0, debtCents: Number(debts.rows[0]?.amount ?? 0),
    },
    people: { workingDays: summary.workingDays, activeStudents: summary.activeStudents, newStudents: newStudents.rows[0]?.count ?? 0, paused: paused.rows[0]?.count ?? 0 },
    daily: summary.daily,
    students: perStudent.rows.map((row) => ({ id: String(row.id), name: String(row.name), lessons: Number(row.lessons), chargedCents: Number(row.charged ?? 0), balance: Number(row.balance) })),
  };
}
