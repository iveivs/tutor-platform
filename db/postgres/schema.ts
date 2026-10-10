import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: "date" });
const timestamps = () => ({
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  subscriptionStatus: text("subscription_status").notNull().default("trial"),
  accessStatus: text("access_status").notNull().default("active"),
  accessGrant: text("access_grant").notNull().default("legacy"),
  accessExpiresAt: instant("access_expires_at"),
  lastActivityAt: instant("last_activity_at"),
  ...timestamps(),
}, (table) => [
  check("workspaces_subscription_status_check", sql`${table.subscriptionStatus} in ('trial', 'active', 'past_due', 'cancelled')`),
  check("workspaces_access_status_check", sql`${table.accessStatus} in ('active', 'blocked')`),
  check("workspaces_access_grant_check", sql`${table.accessGrant} in ('legacy', 'complimentary', 'trial', 'paid')`),
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  legacyAuthSubject: text("legacy_auth_subject"),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash"),
  passwordSetAt: instant("password_set_at"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  disabledAt: instant("disabled_at"),
  ...timestamps(),
}, (table) => [
  uniqueIndex("users_legacy_auth_subject_unique").on(table.legacyAuthSubject).where(sql`${table.legacyAuthSubject} is not null`),
  uniqueIndex("users_email_normalized_unique").on(sql`lower(${table.email})`),
]);

export const platformAuditEvents = pgTable("platform_audit_events", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("platform_audit_events_action_check", sql`${table.action} in ('workspace_blocked', 'workspace_unblocked')`),
  index("idx_platform_audit_workspace_created").on(table.workspaceId, table.createdAt),
  index("idx_platform_audit_actor_created").on(table.actorUserId, table.createdAt),
]);

export const teacherRegistrations = pgTable("teacher_registrations", {
  id: text("id").primaryKey(),
  legacyAuthSubject: text("legacy_auth_subject"),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  professionalTitle: text("professional_title").notNull().default("Репетитор"),
  status: text("status").notNull().default("pending"),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  expiresAt: instant("expires_at").notNull(),
  claimedAt: instant("claimed_at"),
  ...timestamps(),
}, (table) => [
  check("teacher_registrations_status_check", sql`${table.status} in ('pending', 'claimed')`),
  uniqueIndex("teacher_registrations_legacy_subject_unique").on(table.legacyAuthSubject).where(sql`${table.legacyAuthSubject} is not null`),
  uniqueIndex("teacher_registrations_email_unique").on(sql`lower(${table.email})`),
  index("idx_teacher_registrations_status_expires").on(table.status, table.expiresAt),
]);

export const teacherInvitations = pgTable("teacher_invitations", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  professionalTitle: text("professional_title").notNull().default("Репетитор"),
  accessGrant: text("access_grant").notNull().default("complimentary"),
  status: text("status").notNull().default("pending"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  expiresAt: instant("expires_at").notNull(),
  acceptedAt: instant("accepted_at"),
  ...timestamps(),
}, (table) => [
  check("teacher_invitations_status_check", sql`${table.status} in ('pending', 'accepted', 'revoked')`),
  check("teacher_invitations_access_grant_check", sql`${table.accessGrant} in ('complimentary', 'trial', 'paid')`),
  uniqueIndex("teacher_invitations_token_hash_unique").on(table.tokenHash),
  uniqueIndex("teacher_invitations_pending_email_unique").on(sql`lower(${table.email})`).where(sql`${table.status} = 'pending'`),
  index("idx_teacher_invitations_status_expires").on(table.status, table.expiresAt),
]);

export const members = pgTable("members", {
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
  isTrialContact: boolean("is_trial_contact").notNull().default(false),
  scheduleType: text("schedule_type").notNull().default("floating"),
  canViewAvailability: boolean("can_view_availability").notNull().default(false),
  ...timestamps(),
}, (table) => [
  check("members_role_check", sql`${table.role} in ('owner', 'teacher', 'student')`),
  check("members_status_check", sql`${table.status} in ('invited', 'active', 'archived')`),
  check("members_schedule_type_check", sql`${table.scheduleType} in ('fixed', 'floating')`),
  index("idx_members_workspace_role").on(table.workspaceId, table.role),
  uniqueIndex("members_workspace_user_unique").on(table.workspaceId, table.userId),
]);

/** Immutable proof that a user accepted a specific legal document version. */
export const legalAcceptances = pgTable("legal_acceptances", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => members.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  documentVersion: text("document_version").notNull(),
  source: text("source").notNull(),
  subjectContext: text("subject_context"),
  userAgent: text("user_agent"),
  acceptedAt: instant("accepted_at").notNull().defaultNow(),
}, (table) => [
  check("legal_acceptances_document_type_check", sql`${table.documentType} in ('terms', 'personal_data_consent', 'content_rules', 'parental_consent')`),
  check("legal_acceptances_source_check", sql`${table.source} in ('teacher_invite', 'student_invite', 'in_app')`),
  check("legal_acceptances_subject_context_check", sql`${table.subjectContext} is null or ${table.subjectContext} in ('adult', 'legal_representative')`),
  index("idx_legal_acceptances_user_accepted").on(table.userId, table.acceptedAt),
  index("idx_legal_acceptances_member_accepted").on(table.memberId, table.acceptedAt),
]);

export const availabilityWindows = pgTable("availability_windows", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("availability_windows_weekday_check", sql`${table.weekday} between 1 and 7`),
  check("availability_windows_start_check", sql`${table.startMinutes} between 0 and 1439`),
  check("availability_windows_end_check", sql`${table.endMinutes} > ${table.startMinutes} and ${table.endMinutes} <= ${table.startMinutes} + 1440`),
  index("idx_availability_windows_workspace_weekday").on(table.workspaceId, table.weekday),
]);

export const lessonSeries = pgTable("lesson_series", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  activeFrom: date("active_from", { mode: "string" }).notNull(),
  activeUntil: date("active_until", { mode: "string" }),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps(),
}, (table) => [
  check("lesson_series_weekday_check", sql`${table.weekday} between 1 and 7`),
  check("lesson_series_start_minutes_check", sql`${table.startMinutes} between 0 and 1439`),
  check("lesson_series_duration_check", sql`${table.durationMinutes} > 0`),
  index("idx_lesson_series_workspace_student").on(table.workspaceId, table.studentId),
]);

export const lessons = pgTable("lessons", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  seriesId: text("series_id").references(() => lessonSeries.id, { onDelete: "set null" }),
  groupId: text("group_id"),
  lessonType: text("lesson_type").notNull().default("regular"),
  startsAt: instant("starts_at").notNull(),
  endsAt: instant("ends_at").notNull(),
  status: text("status").notNull().default("scheduled"),
  chargeStatus: text("charge_status").notNull().default("pending"),
  createdById: text("created_by_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  completedAt: instant("completed_at"),
  cancelledAt: instant("cancelled_at"),
  ...timestamps(),
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

export const lessonNotes = pgTable("lesson_notes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
  authorMemberId: text("author_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  visibility: text("visibility").notNull().default("shared"),
  body: text("body").notNull(),
  ...timestamps(),
}, (table) => [
  check("lesson_notes_visibility_check", sql`${table.visibility} in ('shared', 'teacher_private')`),
  check("lesson_notes_body_length_check", sql`char_length(${table.body}) between 1 and 4000`),
  uniqueIndex("lesson_notes_author_visibility_unique").on(table.lessonId, table.authorMemberId, table.visibility),
  index("idx_lesson_notes_workspace_lesson").on(table.workspaceId, table.lessonId),
]);

export const lessonAttachments = pgTable("lesson_attachments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  uploadedByMemberId: text("uploaded_by_member_id").references(() => members.id, { onDelete: "set null" }),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull().default("image/webp"),
  byteSize: integer("byte_size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: instant("expires_at").notNull(),
  deletedAt: instant("deleted_at"),
  ...timestamps(),
}, (table) => [
  check("lesson_attachments_status_check", sql`${table.status} in ('active', 'deleting', 'deleted')`),
  check("lesson_attachments_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 5242880`),
  check("lesson_attachments_dimensions_check", sql`${table.width} > 0 and ${table.height} > 0`),
  uniqueIndex("lesson_attachments_object_key_unique").on(table.objectKey),
  index("idx_lesson_attachments_lesson_active").on(table.lessonId, table.status),
  index("idx_lesson_attachments_expiry").on(table.status, table.expiresAt),
  index("idx_lesson_attachments_workspace_created").on(table.workspaceId, table.createdAt),
]);

export const lessonEvents = pgTable("lesson_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  actorMemberId: text("actor_member_id").references(() => members.id, { onDelete: "set null" }),
  sourceKey: text("source_key").notNull(),
  eventType: text("event_type").notNull(),
  previousStartsAt: instant("previous_starts_at"),
  startsAt: instant("starts_at"),
  endsAt: instant("ends_at"),
  note: text("note"),
  occurredAt: instant("occurred_at").notNull().defaultNow(),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("lesson_events_type_check", sql`${table.eventType} in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'series_stopped')`),
  uniqueIndex("lesson_events_source_key_unique").on(table.sourceKey),
  index("idx_lesson_events_workspace_occurred").on(table.workspaceId, table.occurredAt),
  index("idx_lesson_events_student_occurred").on(table.studentId, table.occurredAt),
]);

export const balanceEntries = pgTable("balance_entries", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "restrict" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  lessonUnits: integer("lesson_units").notNull(),
  amountCents: integer("amount_cents"),
  reversesEntryId: text("reverses_entry_id"),
  note: text("note"),
  occurredAt: instant("occurred_at").notNull().defaultNow(),
  recordedById: text("recorded_by_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("balance_entries_kind_check", sql`${table.kind} in ('payment', 'lesson_charge', 'adjustment', 'refund')`),
  index("idx_balance_entries_student_occurred").on(table.studentId, table.occurredAt),
  uniqueIndex("balance_entries_lesson_charge_unique").on(table.lessonId, table.kind),
  uniqueIndex("balance_entries_reversal_unique").on(table.reversesEntryId).where(sql`${table.reversesEntryId} is not null`),
]);

export const lessonRequests = pgTable("lesson_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  proposedStartsAt: instant("proposed_starts_at"),
  proposedEndsAt: instant("proposed_ends_at"),
  message: text("message"),
  cancellationDeadlineAt: instant("cancellation_deadline_at"),
  resolvedById: text("resolved_by_id").references(() => members.id, { onDelete: "set null" }),
  resolvedAt: instant("resolved_at"),
  ...timestamps(),
}, (table) => [
  check("lesson_requests_type_check", sql`${table.type} in ('cancel', 'reschedule', 'new_lesson')`),
  check("lesson_requests_status_check", sql`${table.status} in ('pending', 'approved', 'declined', 'expired')`),
  index("idx_lesson_requests_workspace_status").on(table.workspaceId, table.status),
  index("idx_lesson_requests_student_created").on(table.studentId, table.createdAt),
  uniqueIndex("lesson_requests_pending_lesson_unique").on(table.studentId, table.lessonId).where(sql`${table.status} = 'pending' and ${table.lessonId} is not null`),
  uniqueIndex("lesson_requests_pending_new_lesson_unique").on(table.studentId, table.type).where(sql`${table.status} = 'pending' and ${table.lessonId} is null`),
]);

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: instant("expires_at").notNull(),
  acceptedAt: instant("accepted_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
  index("idx_invitations_member").on(table.memberId),
]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  studentId: text("student_id").references(() => members.id, { onDelete: "set null" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  requestId: text("request_id").references(() => lessonRequests.id, { onDelete: "set null" }),
  balanceEntryId: text("balance_entry_id").references(() => balanceEntries.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: instant("read_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [index("idx_notifications_member_read_created").on(table.memberId, table.readAt, table.createdAt)]);

export const telegramConnections = pgTable("telegram_connections", {
  memberId: text("member_id").primaryKey().references(() => members.id, { onDelete: "cascade" }),
  chatId: text("chat_id").notNull(),
  telegramUserId: text("telegram_user_id").notNull(),
  username: text("username"),
  connectedAt: instant("connected_at").notNull().defaultNow(),
  disabledAt: instant("disabled_at"),
  updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("telegram_connections_chat_id_unique").on(table.chatId),
  index("idx_telegram_connections_active").on(table.disabledAt),
]);

export const telegramLinkTokens = pgTable("telegram_link_tokens", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: instant("expires_at").notNull(),
  consumedAt: instant("consumed_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("telegram_link_tokens_hash_unique").on(table.tokenHash),
  index("idx_telegram_link_tokens_member_expires").on(table.memberId, table.expiresAt),
]);

export const telegramDeliveries = pgTable("telegram_deliveries", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  notificationId: text("notification_id").references(() => notifications.id, { onDelete: "set null" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: instant("next_attempt_at").notNull().defaultNow(),
  sentAt: instant("sent_at"),
  lastError: text("last_error"),
  ...timestamps(),
}, (table) => [
  check("telegram_deliveries_kind_check", sql`${table.kind} in ('lesson_reminder', 'schedule_changed', 'new_request')`),
  check("telegram_deliveries_status_check", sql`${table.status} in ('pending', 'sending', 'sent', 'failed', 'cancelled')`),
  check("telegram_deliveries_attempts_check", sql`${table.attempts} >= 0`),
  uniqueIndex("telegram_deliveries_dedupe_key_unique").on(table.dedupeKey),
  index("idx_telegram_deliveries_due").on(table.status, table.nextAttemptAt),
  index("idx_telegram_deliveries_member_created").on(table.memberId, table.createdAt),
]);

export const dataChanges = pgTable("data_changes", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  audienceMemberId: text("audience_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  sections: text("sections").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_data_changes_audience_id").on(table.audienceMemberId, table.id),
  index("idx_data_changes_workspace_id").on(table.workspaceId, table.id),
]);

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: instant("expires_at").notNull(),
  lastSeenAt: instant("last_seen_at").notNull().defaultNow(),
  revokedAt: instant("revoked_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
  index("idx_auth_sessions_user_expires").on(table.userId, table.expiresAt),
]);

export const authTokens = pgTable("auth_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email"),
  purpose: text("purpose").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: instant("expires_at").notNull(),
  consumedAt: instant("consumed_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("auth_tokens_purpose_check", sql`${table.purpose} in ('set_password', 'password_reset', 'email_verification')`),
  uniqueIndex("auth_tokens_token_hash_unique").on(table.tokenHash),
  index("idx_auth_tokens_user_purpose_expires").on(table.userId, table.purpose, table.expiresAt),
]);

export const authAuditEvents = pgTable("auth_audit_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  emailHash: text("email_hash"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [index("idx_auth_audit_user_created").on(table.userId, table.createdAt)]);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  windowStartedAt: instant("window_started_at").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  expiresAt: instant("expires_at").notNull(),
}, (table) => [
  uniqueIndex("rate_limit_buckets_scope_key_unique").on(table.scope, table.keyHash),
  index("idx_rate_limit_buckets_expires").on(table.expiresAt),
  check("rate_limit_buckets_count_check", sql`${table.requestCount} >= 0`),
]);

export const jobRuns = pgTable("job_runs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  jobName: text("job_name").notNull(),
  status: text("status").notNull(),
  startedAt: instant("started_at").notNull().defaultNow(),
  finishedAt: instant("finished_at"),
  detail: text("detail"),
}, (table) => [
  check("job_runs_status_check", sql`${table.status} in ('running', 'succeeded', 'failed', 'skipped')`),
  index("idx_job_runs_name_started").on(table.jobName, table.startedAt),
]);
