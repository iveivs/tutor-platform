import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
};

/** One tenant today is one teacher; later it can represent a school or studio. */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  subscriptionStatus: text("subscription_status").notNull().default("trial"),
  accessStatus: text("access_status").notNull().default("active"),
  lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }),
  ...timestamps,
}, (table) => [
  check("workspaces_subscription_status_check", sql`${table.subscriptionStatus} in ('trial', 'active', 'past_due', 'cancelled')`),
  check("workspaces_access_status_check", sql`${table.accessStatus} in ('active', 'blocked')`),
]);

/** Authentication identity. Passwords are never stored in the application database. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authSubject: text("auth_subject").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  isPlatformAdmin: integer("is_platform_admin", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex("users_auth_subject_unique").on(table.authSubject),
  uniqueIndex("users_email_unique").on(table.email),
]);

/** Immutable platform-level actions. It deliberately stores no workspace business data. */
export const platformAuditEvents = sqliteTable("platform_audit_events", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  check("platform_audit_events_action_check", sql`${table.action} in ('workspace_blocked', 'workspace_unblocked')`),
  index("idx_platform_audit_workspace_created").on(table.workspaceId, table.createdAt),
  index("idx_platform_audit_actor_created").on(table.actorUserId, table.createdAt),
]);

/** A confirmed teacher signup is claimed exactly once on its first successful login. */
export const teacherRegistrations = sqliteTable("teacher_registrations", {
  id: text("id").primaryKey(),
  authSubject: text("auth_subject").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  professionalTitle: text("professional_title").notNull().default("Репетитор"),
  status: text("status").notNull().default("pending"),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
  ...timestamps,
}, (table) => [
  check("teacher_registrations_status_check", sql`${table.status} in ('pending', 'claimed')`),
  uniqueIndex("teacher_registrations_auth_subject_unique").on(table.authSubject),
  uniqueIndex("teacher_registrations_email_unique").on(table.email),
  index("idx_teacher_registrations_status_expires").on(table.status, table.expiresAt),
]);

/** A student may exist before accepting an invitation, hence nullable userId. */
export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  displayName: text("display_name").notNull(),
  professionalTitle: text("professional_title").notNull().default("Репетитор"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  isTrialContact: integer("is_trial_contact", { mode: "boolean" }).notNull().default(false),
  scheduleType: text("schedule_type").notNull().default("floating"),
  canViewAvailability: integer("can_view_availability", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [
  check("members_role_check", sql`${table.role} in ('owner', 'teacher', 'student')`),
  check("members_status_check", sql`${table.status} in ('invited', 'active', 'archived')`),
  check("members_schedule_type_check", sql`${table.scheduleType} in ('fixed', 'floating')`),
  index("idx_members_workspace_role").on(table.workspaceId, table.role),
  uniqueIndex("members_workspace_user_unique").on(table.workspaceId, table.userId),
]);

/** Weekly working intervals. endMinutes may exceed 1440 when an interval continues after midnight. */
export const availabilityWindows = sqliteTable("availability_windows", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  check("availability_windows_weekday_check", sql`${table.weekday} between 1 and 7`),
  check("availability_windows_start_check", sql`${table.startMinutes} between 0 and 1439`),
  check("availability_windows_end_check", sql`${table.endMinutes} > ${table.startMinutes} and ${table.endMinutes} <= ${table.startMinutes} + 1440`),
  index("idx_availability_windows_workspace_weekday").on(table.workspaceId, table.weekday),
]);

/** Weekly templates generate concrete lessons; floating students have no template. */
export const lessonSeries = sqliteTable("lesson_series", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  activeFrom: text("active_from").notNull(),
  activeUntil: text("active_until"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  check("lesson_series_weekday_check", sql`${table.weekday} between 1 and 7`),
  check("lesson_series_start_minutes_check", sql`${table.startMinutes} between 0 and 1439`),
  check("lesson_series_duration_check", sql`${table.durationMinutes} > 0`),
  index("idx_lesson_series_workspace_student").on(table.workspaceId, table.studentId),
]);

export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  seriesId: text("series_id").references(() => lessonSeries.id, { onDelete: "set null" }),
  groupId: text("group_id"),
  lessonType: text("lesson_type").notNull().default("regular"),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("scheduled"),
  chargeStatus: text("charge_status").notNull().default("pending"),
  createdById: text("created_by_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
  ...timestamps,
}, (table) => [
  check("lessons_status_check", sql`${table.status} in ('scheduled', 'completed', 'cancelled')`),
  check("lessons_type_check", sql`${table.lessonType} in ('regular', 'trial')`),
  check("lessons_charge_status_check", sql`${table.chargeStatus} in ('pending', 'charged', 'waived')`),
  check("lessons_time_check", sql`${table.endsAt} > ${table.startsAt}`),
  index("idx_lessons_workspace_starts_at").on(table.workspaceId, table.startsAt),
  index("idx_lessons_student_starts_at").on(table.studentId, table.startsAt),
  index("idx_lessons_group_id").on(table.groupId),
  index("idx_lessons_pending_charge").on(table.chargeStatus, table.startsAt),
  uniqueIndex("lessons_series_start_unique").on(table.seriesId, table.startsAt).where(sql`${table.status} <> 'cancelled'`),
]);

/** Immutable lesson lifecycle entries preserve changes even when the lesson row is updated. */
export const lessonEvents = sqliteTable("lesson_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  actorMemberId: text("actor_member_id").references(() => members.id, { onDelete: "set null" }),
  sourceKey: text("source_key").notNull(),
  eventType: text("event_type").notNull(),
  previousStartsAt: integer("previous_starts_at", { mode: "timestamp_ms" }),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }),
  note: text("note"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  check("lesson_events_type_check", sql`${table.eventType} in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'series_stopped')`),
  uniqueIndex("lesson_events_source_key_unique").on(table.sourceKey),
  index("idx_lesson_events_workspace_occurred").on(table.workspaceId, table.occurredAt),
  index("idx_lesson_events_student_occurred").on(table.studentId, table.occurredAt),
]);

/** Signed lesson units: payments are positive, completed lessons are negative. */
export const balanceEntries = sqliteTable("balance_entries", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  lessonUnits: integer("lesson_units").notNull(),
  amountCents: integer("amount_cents"),
  reversesEntryId: text("reverses_entry_id"),
  note: text("note"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  recordedById: text("recorded_by_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  check("balance_entries_kind_check", sql`${table.kind} in ('payment', 'lesson_charge', 'adjustment', 'refund')`),
  index("idx_balance_entries_student_occurred").on(table.studentId, table.occurredAt),
  uniqueIndex("balance_entries_lesson_charge_unique").on(table.lessonId, table.kind),
  uniqueIndex("balance_entries_reversal_unique").on(table.reversesEntryId).where(sql`${table.reversesEntryId} is not null`),
]);

export const lessonRequests = sqliteTable("lesson_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  proposedStartsAt: integer("proposed_starts_at", { mode: "timestamp_ms" }),
  proposedEndsAt: integer("proposed_ends_at", { mode: "timestamp_ms" }),
  message: text("message"),
  cancellationDeadlineAt: integer("cancellation_deadline_at", { mode: "timestamp_ms" }),
  resolvedById: text("resolved_by_id").references(() => members.id, { onDelete: "set null" }),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  ...timestamps,
}, (table) => [
  check("lesson_requests_type_check", sql`${table.type} in ('cancel', 'reschedule', 'new_lesson')`),
  check("lesson_requests_status_check", sql`${table.status} in ('pending', 'approved', 'declined', 'expired')`),
  index("idx_lesson_requests_workspace_status").on(table.workspaceId, table.status),
  index("idx_lesson_requests_student_created").on(table.studentId, table.createdAt),
  uniqueIndex("lesson_requests_pending_lesson_unique").on(table.studentId, table.lessonId).where(sql`${table.status} = 'pending' and ${table.lessonId} is not null`),
  uniqueIndex("lesson_requests_pending_new_lesson_unique").on(table.studentId, table.type).where(sql`${table.status} = 'pending' and ${table.lessonId} is null`),
]);

/** Only a token hash is persisted; the invitation URL contains the secret token. */
export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
  index("idx_invitations_member").on(table.memberId),
]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  studentId: text("student_id").references(() => members.id, { onDelete: "set null" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  requestId: text("request_id").references(() => lessonRequests.id, { onDelete: "set null" }),
  balanceEntryId: text("balance_entry_id").references(() => balanceEntries.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("idx_notifications_member_read_created").on(table.memberId, table.readAt, table.createdAt),
]);

/** Small per-member journal used to discover which client sections need refreshing. */
export const dataChanges = sqliteTable("data_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  audienceMemberId: text("audience_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  sections: text("sections").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("idx_data_changes_audience_id").on(table.audienceMemberId, table.id),
  index("idx_data_changes_workspace_id").on(table.workspaceId, table.id),
]);
