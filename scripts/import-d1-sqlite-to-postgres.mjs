import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const sqlitePath = process.argv[2];
const connectionString = process.env.DATABASE_URL;
if (!sqlitePath) throw new Error("Usage: npm run db:import:d1 -- /absolute/path/to/d1-export.sqlite");
if (!connectionString) throw new Error("DATABASE_URL is required");

const tables = [
  "workspaces", "users", "members", "availability_windows", "lesson_series", "lessons",
  "lesson_events", "balance_entries", "lesson_requests", "invitations", "notifications",
  "data_changes", "teacher_registrations", "teacher_invitations", "platform_audit_events",
];

const timestampColumns = new Set([
  "access_expires_at", "last_activity_at", "created_at", "updated_at", "expires_at", "claimed_at",
  "accepted_at", "starts_at", "ends_at", "completed_at", "cancelled_at", "previous_starts_at",
  "occurred_at", "proposed_starts_at", "proposed_ends_at", "cancellation_deadline_at", "resolved_at", "read_at",
]);
const booleanColumns = new Set(["is_platform_admin", "is_trial_contact", "can_view_availability", "is_active"]);
const renamedColumns = new Map([["users.auth_subject", "legacy_auth_subject"], ["teacher_registrations.auth_subject", "legacy_auth_subject"]]);
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const targetColumn = (table, column) => renamedColumns.get(`${table}.${column}`) ?? column;
const convert = (column, value) => {
  if (value === null) return null;
  if (timestampColumns.has(column)) return new Date(Number(value));
  if (booleanColumns.has(column)) return Boolean(value);
  return value;
};

const source = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new pg.Pool({ connectionString, max: 1, application_name: "tutor-platform-d1-import" });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const lock = await client.query("select pg_try_advisory_xact_lock($1) as locked", [821_774_032]);
  if (!lock.rows[0]?.locked) throw new Error("Another D1 import is already running");

  for (const table of tables) {
    const target = await client.query(`select count(*)::int as count from ${quote(table)}`);
    if (target.rows[0].count !== 0) throw new Error(`Target table ${table} is not empty`);
  }

  await client.query("SET LOCAL session_replication_role = replica");
  for (const table of tables) {
    const exists = source.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table);
    if (!exists) throw new Error(`Source table ${table} is missing`);
    const columns = source.prepare(`pragma table_info(${quote(table)})`).all().map((row) => String(row.name));
    const rows = source.prepare(`select * from ${quote(table)}`).all();
    if (rows.length) {
      const names = columns.map((column) => quote(targetColumn(table, column))).join(", ");
      const values = columns.map((_, index) => `$${index + 1}`).join(", ");
      const identity = table === "data_changes" ? " OVERRIDING SYSTEM VALUE" : "";
      const statement = `insert into ${quote(table)} (${names})${identity} values (${values})`;
      for (const row of rows) await client.query(statement, columns.map((column) => convert(column, row[column])));
    }
    const count = await client.query(`select count(*)::int as count from ${quote(table)}`);
    if (count.rows[0].count !== rows.length) throw new Error(`Row count mismatch for ${table}`);
    console.log(`${table}: ${rows.length}`);
  }
  await client.query("SET LOCAL session_replication_role = origin");
  await client.query("select setval(pg_get_serial_sequence('data_changes', 'id'), greatest(coalesce((select max(id) from data_changes), 0), 1), (select count(*) > 0 from data_changes))");

  const foreignKeys = await client.query(`
    select con.conname, rel.relname as child_table, child.attname as child_column,
           parent.relname as parent_table, parent_col.attname as parent_column
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_class parent on parent.oid = con.confrelid
    join unnest(con.conkey, con.confkey) with ordinality keys(child_num, parent_num, ord) on true
    join pg_attribute child on child.attrelid = rel.oid and child.attnum = keys.child_num
    join pg_attribute parent_col on parent_col.attrelid = parent.oid and parent_col.attnum = keys.parent_num
    where con.contype = 'f' and rel.relnamespace = 'public'::regnamespace
  `);
  for (const key of foreignKeys.rows) {
    const result = await client.query(`select count(*)::int as count from ${quote(key.child_table)} c left join ${quote(key.parent_table)} p on c.${quote(key.child_column)} = p.${quote(key.parent_column)} where c.${quote(key.child_column)} is not null and p.${quote(key.parent_column)} is null`);
    if (result.rows[0].count) throw new Error(`Foreign key ${key.conname} has ${result.rows[0].count} orphan rows`);
  }

  const targetBalances = await client.query("select student_id, sum(lesson_units)::int as balance from balance_entries group by student_id order by student_id");
  const sourceBalances = source.prepare("select student_id, sum(lesson_units) as balance from balance_entries group by student_id order by student_id").all();
  if (JSON.stringify(targetBalances.rows) !== JSON.stringify(sourceBalances)) throw new Error("Student balance verification failed");

  await client.query("COMMIT");
  console.log("D1 import and integrity verification completed.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
  source.close();
}
