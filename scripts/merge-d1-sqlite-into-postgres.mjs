import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const sqlitePath = process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1]);
const shouldApply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;

if (!sqlitePath) throw new Error("Usage: node scripts/merge-d1-sqlite-into-postgres.mjs /absolute/path/export.sqlite [--apply]");
if (!connectionString) throw new Error("DATABASE_URL is required");

const source = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new pg.Pool({ connectionString, max: 1, application_name: "tutor-platform-d1-merge" });
const client = await pool.connect();

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const timestampColumns = new Set([
  "access_expires_at", "last_activity_at", "created_at", "updated_at", "expires_at", "claimed_at",
  "accepted_at", "starts_at", "ends_at", "completed_at", "cancelled_at", "previous_starts_at",
  "occurred_at", "proposed_starts_at", "proposed_ends_at", "cancellation_deadline_at", "resolved_at", "read_at",
]);
const booleanColumns = new Set(["is_platform_admin", "is_trial_contact", "can_view_availability", "is_active"]);
const renamedColumns = new Map([
  ["users.auth_subject", "legacy_auth_subject"],
  ["teacher_registrations.auth_subject", "legacy_auth_subject"],
]);
const convert = (column, value) => {
  if (value === null) return null;
  if (timestampColumns.has(column)) return new Date(Number(value));
  if (booleanColumns.has(column)) return Boolean(value);
  return value;
};
const remap = (map, value, label) => {
  if (value === null || value === undefined) return null;
  if (!map.has(String(value))) throw new Error(`Missing ${label} mapping`);
  return map.get(String(value));
};
const sourceRows = (table) => source.prepare(`select * from ${quote(table)}`).all();
const insertRow = async (table, row) => {
  const columns = Object.keys(row);
  const names = columns.map(quote).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(`insert into ${quote(table)} (${names}) values (${placeholders})`, columns.map((column) => row[column]));
};
const convertedRow = (table, row, overrides = {}) => Object.fromEntries(
  Object.entries(row).map(([column, value]) => [renamedColumns.get(`${table}.${column}`) ?? column, convert(column, value)]).concat(Object.entries(overrides)),
);
const sameDate = (left, right) => String(left ?? "") === String(right ?? "");
const millis = (value) => value instanceof Date ? value.getTime() : Number(value);
const inserted = new Map();
const recordInsert = (table) => inserted.set(table, (inserted.get(table) ?? 0) + 1);

try {
  await client.query("begin");
  const lock = await client.query("select pg_try_advisory_xact_lock($1) as locked", [821_774_033]);
  if (!lock.rows[0]?.locked) throw new Error("Another D1 merge is already running");

  const telegramBefore = Number((await client.query("select count(*)::int as count from telegram_deliveries")).rows[0].count);

  const sourceWorkspaces = sourceRows("workspaces");
  const sourceOwners = source.prepare(`
    select m.workspace_id, lower(coalesce(u.email, m.email)) as email
    from members m left join users u on u.id = m.user_id
    where m.role = 'owner'
  `).all();
  const targetOwners = await client.query(`
    select m.workspace_id, lower(coalesce(u.email, m.email)) as email
    from members m left join users u on u.id = m.user_id
    where m.role = 'owner'
  `);
  const workspaceMap = new Map();
  for (const workspace of sourceWorkspaces) {
    const owner = sourceOwners.find((row) => String(row.workspace_id) === String(workspace.id));
    const matches = targetOwners.rows.filter((row) => owner?.email && row.email === owner.email);
    if (matches.length !== 1) throw new Error("Each source workspace must match exactly one target workspace by owner email");
    workspaceMap.set(String(workspace.id), matches[0].workspace_id);
  }

  const sourceUsers = sourceRows("users");
  const targetUsers = (await client.query("select id, email, legacy_auth_subject, full_name from users")).rows;
  const targetUsersByEmail = new Map(targetUsers.map((row) => [normalizeEmail(row.email), row]));
  const occupiedUserIds = new Set(targetUsers.map((row) => String(row.id)));
  const userMap = new Map();
  const usersToInsert = [];
  for (const row of sourceUsers) {
    const existing = targetUsersByEmail.get(normalizeEmail(row.email));
    if (existing) {
      userMap.set(String(row.id), existing.id);
      await client.query(`
        update users set
          legacy_auth_subject = coalesce(legacy_auth_subject, $2),
          full_name = case when btrim(coalesce(full_name, '')) = '' then $3 else full_name end
        where id = $1
      `, [existing.id, row.auth_subject, row.full_name]);
      continue;
    }
    if (row.is_platform_admin) throw new Error("Refusing to import an unmatched platform administrator");
    if (occupiedUserIds.has(String(row.id))) throw new Error("Unrelated user ID collision");
    userMap.set(String(row.id), String(row.id));
    occupiedUserIds.add(String(row.id));
    usersToInsert.push(convertedRow("users", row, { password_hash: null, password_set_at: null, disabled_at: null }));
  }

  const sourceMembers = sourceRows("members");
  const targetMembers = (await client.query("select * from members")).rows;
  const occupiedMemberIds = new Set(targetMembers.map((row) => String(row.id)));
  const memberMap = new Map();
  const membersToInsert = [];
  for (const row of sourceMembers) {
    const workspaceId = remap(workspaceMap, row.workspace_id, "workspace");
    const userId = remap(userMap, row.user_id, "user");
    const candidates = new Map();
    for (const candidate of targetMembers) {
      if (candidate.workspace_id !== workspaceId || candidate.role !== row.role) continue;
      if (userId && candidate.user_id === userId) candidates.set(candidate.id, candidate);
      if (row.email && normalizeEmail(candidate.email) === normalizeEmail(row.email)) candidates.set(candidate.id, candidate);
      if (row.role === "owner") candidates.set(candidate.id, candidate);
    }
    if (candidates.size > 1) throw new Error("Ambiguous member match");
    if (candidates.size === 1) {
      const existing = [...candidates.values()][0];
      memberMap.set(String(row.id), existing.id);
      await client.query(`
        update members set
          display_name = case when btrim(coalesce(display_name, '')) = '' then $2 else display_name end,
          professional_title = case when btrim(coalesce(professional_title, '')) = '' then $3 else professional_title end,
          email = case when btrim(coalesce(email, '')) = '' then $4 else email end,
          phone = case when btrim(coalesce(phone, '')) = '' then $5 else phone end,
          notes = case when btrim(coalesce(notes, '')) = '' then $6 else notes end
        where id = $1
      `, [existing.id, row.display_name, row.professional_title, row.email, row.phone, row.notes]);
      continue;
    }
    if (occupiedMemberIds.has(String(row.id))) throw new Error("Unrelated member ID collision");
    memberMap.set(String(row.id), String(row.id));
    occupiedMemberIds.add(String(row.id));
    membersToInsert.push(convertedRow("members", row, { workspace_id: workspaceId, user_id: userId }));
  }

  const targetSeries = (await client.query("select * from lesson_series")).rows;
  const occupiedSeriesIds = new Set(targetSeries.map((row) => String(row.id)));
  const seriesMap = new Map();
  const seriesToInsert = [];
  for (const row of sourceRows("lesson_series")) {
    const workspaceId = remap(workspaceMap, row.workspace_id, "workspace");
    const studentId = remap(memberMap, row.student_id, "student");
    const existing = targetSeries.find((candidate) =>
      candidate.workspace_id === workspaceId && candidate.student_id === studentId &&
      candidate.weekday === row.weekday && candidate.start_minutes === row.start_minutes &&
      candidate.duration_minutes === row.duration_minutes && sameDate(candidate.active_from, row.active_from) &&
      sameDate(candidate.active_until, row.active_until));
    if (existing) {
      seriesMap.set(String(row.id), existing.id);
      continue;
    }
    if (occupiedSeriesIds.has(String(row.id))) throw new Error("Unrelated lesson series ID collision");
    seriesMap.set(String(row.id), String(row.id));
    occupiedSeriesIds.add(String(row.id));
    seriesToInsert.push(convertedRow("lesson_series", row, { workspace_id: workspaceId, student_id: studentId }));
  }

  const targetLessons = (await client.query("select * from lessons")).rows;
  const scheduledLessons = targetLessons.filter((row) => row.status === "scheduled");
  const occupiedLessonIds = new Set(targetLessons.map((row) => String(row.id)));
  const lessonMap = new Map();
  const lessonsToInsert = [];
  for (const row of sourceRows("lessons")) {
    const workspaceId = remap(workspaceMap, row.workspace_id, "workspace");
    const studentId = remap(memberMap, row.student_id, "student");
    const existing = targetLessons.find((candidate) =>
      candidate.workspace_id === workspaceId && candidate.student_id === studentId &&
      millis(candidate.starts_at) === millis(row.starts_at) && millis(candidate.ends_at) === millis(row.ends_at));
    if (existing) {
      lessonMap.set(String(row.id), existing.id);
      continue;
    }
    if (row.status === "scheduled") {
      const conflict = scheduledLessons.find((candidate) => candidate.workspace_id === workspaceId &&
        millis(row.starts_at) < millis(candidate.ends_at) && millis(row.ends_at) > millis(candidate.starts_at));
      if (conflict) throw new Error("A source lesson overlaps a non-identical active target lesson");
    }
    if (occupiedLessonIds.has(String(row.id))) throw new Error("Unrelated lesson ID collision");
    lessonMap.set(String(row.id), String(row.id));
    occupiedLessonIds.add(String(row.id));
    const mapped = convertedRow("lessons", row, {
      workspace_id: workspaceId,
      student_id: studentId,
      series_id: remap(seriesMap, row.series_id, "series"),
      created_by_id: remap(memberMap, row.created_by_id, "creator"),
    });
    lessonsToInsert.push(mapped);
    if (row.status === "scheduled") scheduledLessons.push(mapped);
  }

  const sourceBalances = sourceRows("balance_entries");
  const targetBalances = (await client.query("select * from balance_entries")).rows;
  const targetBalanceBefore = new Map();
  for (const row of targetBalances) targetBalanceBefore.set(row.student_id, (targetBalanceBefore.get(row.student_id) ?? 0) + Number(row.lesson_units));
  const balanceMap = new Map();
  const occupiedBalanceIds = new Set(targetBalances.map((row) => String(row.id)));
  for (const row of sourceBalances) {
    const lessonId = remap(lessonMap, row.lesson_id, "lesson");
    const existing = row.kind === "lesson_charge" && lessonId
      ? targetBalances.find((candidate) => candidate.lesson_id === lessonId && candidate.kind === row.kind)
      : targetBalances.find((candidate) => String(candidate.id) === String(row.id));
    if (existing) balanceMap.set(String(row.id), existing.id);
  }
  for (const row of sourceBalances) {
    if (balanceMap.has(String(row.id))) continue;
    if (occupiedBalanceIds.has(String(row.id))) throw new Error("Unrelated balance entry ID collision");
    balanceMap.set(String(row.id), String(row.id));
    occupiedBalanceIds.add(String(row.id));
  }

  const sourceRequests = sourceRows("lesson_requests");
  const targetRequestIds = new Set((await client.query("select id from lesson_requests")).rows.map((row) => String(row.id)));
  for (const row of sourceRequests) if (targetRequestIds.has(String(row.id))) throw new Error("Lesson request ID collision");
  const requestMap = new Map(sourceRequests.map((row) => [String(row.id), String(row.id)]));

  await client.query("set local session_replication_role = replica");

  for (const row of usersToInsert) { await insertRow("users", row); recordInsert("users"); }
  for (const row of membersToInsert) { await insertRow("members", row); recordInsert("members"); }

  const targetAvailability = (await client.query("select * from availability_windows")).rows;
  const targetAvailabilityIds = new Set(targetAvailability.map((row) => String(row.id)));
  for (const row of sourceRows("availability_windows")) {
    const workspaceId = remap(workspaceMap, row.workspace_id, "workspace");
    const duplicate = targetAvailability.some((candidate) => candidate.workspace_id === workspaceId && candidate.weekday === row.weekday &&
      candidate.start_minutes === row.start_minutes && candidate.end_minutes === row.end_minutes);
    if (duplicate) continue;
    if (targetAvailabilityIds.has(String(row.id))) throw new Error("Availability window ID collision");
    await insertRow("availability_windows", convertedRow("availability_windows", row, { workspace_id: workspaceId }));
    recordInsert("availability_windows");
  }

  for (const row of seriesToInsert) { await insertRow("lesson_series", row); recordInsert("lesson_series"); }
  for (const row of lessonsToInsert) { await insertRow("lessons", row); recordInsert("lessons"); }

  const targetEventIds = new Set((await client.query("select id from lesson_events")).rows.map((row) => String(row.id)));
  const targetEventKeys = new Set((await client.query("select source_key from lesson_events where source_key is not null")).rows.map((row) => row.source_key));
  for (const row of sourceRows("lesson_events")) {
    if (row.source_key && targetEventKeys.has(row.source_key)) continue;
    if (targetEventIds.has(String(row.id))) throw new Error("Lesson event ID collision");
    await insertRow("lesson_events", convertedRow("lesson_events", row, {
      workspace_id: remap(workspaceMap, row.workspace_id, "workspace"),
      student_id: remap(memberMap, row.student_id, "student"),
      lesson_id: remap(lessonMap, row.lesson_id, "lesson"),
      actor_member_id: remap(memberMap, row.actor_member_id, "actor"),
    }));
    recordInsert("lesson_events");
  }

  for (const row of sourceBalances) {
    if (balanceMap.get(String(row.id)) !== String(row.id)) continue;
    await insertRow("balance_entries", convertedRow("balance_entries", row, {
      workspace_id: remap(workspaceMap, row.workspace_id, "workspace"),
      student_id: remap(memberMap, row.student_id, "student"),
      lesson_id: remap(lessonMap, row.lesson_id, "lesson"),
      recorded_by_id: remap(memberMap, row.recorded_by_id, "recorder"),
      reverses_entry_id: remap(balanceMap, row.reverses_entry_id, "reversed balance entry"),
    }));
    recordInsert("balance_entries");
  }

  for (const row of sourceRequests) {
    await insertRow("lesson_requests", convertedRow("lesson_requests", row, {
      workspace_id: remap(workspaceMap, row.workspace_id, "workspace"),
      student_id: remap(memberMap, row.student_id, "student"),
      lesson_id: remap(lessonMap, row.lesson_id, "lesson"),
      resolved_by_id: remap(memberMap, row.resolved_by_id, "resolver"),
    }));
    recordInsert("lesson_requests");
  }

  const targetInvitationIds = new Set((await client.query("select id from invitations")).rows.map((row) => String(row.id)));
  const targetInvitationTokens = new Set((await client.query("select token_hash from invitations")).rows.map((row) => row.token_hash));
  for (const row of sourceRows("invitations")) {
    if (targetInvitationTokens.has(row.token_hash)) continue;
    if (targetInvitationIds.has(String(row.id))) throw new Error("Invitation ID collision");
    await insertRow("invitations", convertedRow("invitations", row, {
      workspace_id: remap(workspaceMap, row.workspace_id, "workspace"),
      member_id: remap(memberMap, row.member_id, "member"),
    }));
    recordInsert("invitations");
  }

  const targetNotificationIds = new Set((await client.query("select id from notifications")).rows.map((row) => String(row.id)));
  for (const row of sourceRows("notifications")) {
    if (targetNotificationIds.has(String(row.id))) throw new Error("Notification ID collision");
    await insertRow("notifications", convertedRow("notifications", row, {
      member_id: remap(memberMap, row.member_id, "notification member"),
      student_id: remap(memberMap, row.student_id, "notification student"),
      lesson_id: remap(lessonMap, row.lesson_id, "notification lesson"),
      request_id: remap(requestMap, row.request_id, "notification request"),
      balance_entry_id: remap(balanceMap, row.balance_entry_id, "notification balance entry"),
    }));
    recordInsert("notifications");
  }

  for (const table of ["teacher_registrations", "teacher_invitations", "platform_audit_events"]) {
    const targetIds = new Set((await client.query(`select id from ${quote(table)}`)).rows.map((row) => String(row.id)));
    for (const row of sourceRows(table)) {
      if (targetIds.has(String(row.id))) throw new Error(`${table} ID collision`);
      const overrides = {};
      if ("workspace_id" in row) overrides.workspace_id = remap(workspaceMap, row.workspace_id, "workspace");
      if ("created_by_user_id" in row) overrides.created_by_user_id = remap(userMap, row.created_by_user_id, "creator user");
      if ("actor_user_id" in row) overrides.actor_user_id = remap(userMap, row.actor_user_id, "actor user");
      await insertRow(table, convertedRow(table, row, overrides));
      recordInsert(table);
    }
  }

  await client.query("set local session_replication_role = origin");

  const mappedWorkspaceIds = [...new Set(workspaceMap.values())];
  for (const workspaceId of mappedWorkspaceIds) {
    await client.query(`
      insert into data_changes (workspace_id, audience_member_id, sections, created_at)
      select workspace_id, id, 'students,lessons,balanceEntries,lessonRequests,notifications,historyEvents,profile,availability', now()
      from members where workspace_id = $1 and status = 'active'
    `, [workspaceId]);
  }

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
    if (result.rows[0].count) throw new Error(`Foreign key ${key.conname} has orphan rows`);
  }

  const expectedBalances = new Map(targetBalanceBefore);
  for (const row of sourceBalances) {
    const studentId = remap(memberMap, row.student_id, "student");
    expectedBalances.set(studentId, (expectedBalances.get(studentId) ?? 0) + Number(row.lesson_units));
  }
  const actualBalances = (await client.query("select student_id, sum(lesson_units)::int as balance from balance_entries group by student_id")).rows;
  const actualBalanceMap = new Map(actualBalances.map((row) => [row.student_id, Number(row.balance)]));
  for (const [studentId, expected] of expectedBalances) {
    if ((actualBalanceMap.get(studentId) ?? 0) !== expected) throw new Error("Student balance verification failed");
  }

  const telegramAfter = Number((await client.query("select count(*)::int as count from telegram_deliveries")).rows[0].count);
  if (telegramAfter !== telegramBefore) throw new Error("Historical notifications unexpectedly created Telegram deliveries");

  const summary = Object.fromEntries([...inserted.entries()].sort(([left], [right]) => left.localeCompare(right)));
  if (shouldApply) {
    await client.query("commit");
    console.log(`D1 merge applied: ${JSON.stringify(summary)}`);
  } else {
    await client.query("rollback");
    console.log(`D1 merge dry run passed and was rolled back: ${JSON.stringify(summary)}`);
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
  source.close();
}
