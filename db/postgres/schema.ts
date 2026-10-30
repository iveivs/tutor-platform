import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
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
  adminNote: text("admin_note"),
  lastActivityAt: instant("last_activity_at"),
  ...timestamps(),
}, (table) => [
  check("workspaces_subscription_status_check", sql`${table.subscriptionStatus} in ('trial', 'active', 'past_due', 'cancelled')`),
  check("workspaces_access_status_check", sql`${table.accessStatus} in ('active', 'blocked')`),
  check("workspaces_access_grant_check", sql`${table.accessGrant} in ('legacy', 'complimentary', 'trial', 'paid', 'unlimited')`),
  check("workspaces_unlimited_no_end_check", sql`${table.accessGrant} <> 'unlimited' or ${table.accessExpiresAt} is null`),
  check("workspaces_admin_note_check", sql`${table.adminNote} is null or length(${table.adminNote}) <= 2000`),
]);

// Subscription payments recorded by the platform admin (step 1: transfers, no provider yet).
export const subscriptionPayments = pgTable("subscription_payments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  months: integer("months").notNull(),
  paidOn: date("paid_on").notNull(),
  method: text("method").notNull(),
  receiptRef: text("receipt_ref"),
  accessFrom: instant("access_from").notNull(),
  accessUntil: instant("access_until").notNull(),
  status: text("status").notNull().default("paid"),
  refundedAt: instant("refunded_at"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
}, (table) => [
  check("subscription_payments_amount_check", sql`${table.amountCents} between 0 and 100000000`),
  check("subscription_payments_months_check", sql`${table.months} between 1 and 24`),
  check("subscription_payments_method_check", sql`${table.method} in ('transfer', 'cash', 'other')`),
  check("subscription_payments_status_check", sql`${table.status} in ('paid', 'refunded')`),
  check("subscription_payments_receipt_check", sql`${table.receiptRef} is null or length(${table.receiptRef}) <= 100`),
  index("idx_subscription_payments_workspace_paid").on(table.workspaceId, table.paidOn),
]);

// One row per sent access reminder (stage = days before the end, 0 = access ended), so each is sent once.
export const workspaceAccessReminders = pgTable("workspace_access_reminders", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  accessExpiresAt: instant("access_expires_at").notNull(),
  stage: smallint("stage").notNull(),
  sentAt: instant("sent_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: "workspace_access_reminders_pk", columns: [table.workspaceId, table.accessExpiresAt, table.stage] }),
  check("workspace_access_reminders_stage_check", sql`${table.stage} in (0, 1, 3, 7)`),
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
  check("platform_audit_events_action_check", sql`${table.action} in ('workspace_blocked', 'workspace_unblocked', 'access_terms_changed', 'subscription_payment_added', 'subscription_payment_refunded')`),
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
  check("teacher_invitations_access_grant_check", sql`${table.accessGrant} in ('complimentary', 'trial', 'paid', 'unlimited')`),
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
  avatarColor: text("avatar_color").notNull().default("indigo"),
  avatarObjectKey: text("avatar_object_key"),
  avatarUpdatedAt: instant("avatar_updated_at"),
  isTrialContact: boolean("is_trial_contact").notNull().default(false),
  // Set when a parent or trusted adult runs the student's account (see lib/guardian.ts).
  guardianName: text("guardian_name"),
  guardianRelation: text("guardian_relation"),
  guardianRelationOther: text("guardian_relation_other"),
  scheduleType: text("schedule_type").notNull().default("floating"),
  canViewAvailability: boolean("can_view_availability").notNull().default(false),
  lessonPriceCents: integer("lesson_price_cents"),
  doubleLessonPriceCents: integer("double_lesson_price_cents"),
  trialLessonPriceCents: integer("trial_lesson_price_cents"),
  priceCurrency: text("price_currency"),
  ...timestamps(),
}, (table) => [
  check("members_lesson_prices_check", sql`(${table.lessonPriceCents} is null or ${table.lessonPriceCents} between 0 and 100000000) and (${table.doubleLessonPriceCents} is null or ${table.doubleLessonPriceCents} between 0 and 100000000) and (${table.trialLessonPriceCents} is null or ${table.trialLessonPriceCents} between 0 and 100000000)`),
  check("members_price_currency_check", sql`${table.priceCurrency} is null or char_length(${table.priceCurrency}) between 1 and 12`),
  check("members_role_check", sql`${table.role} in ('owner', 'teacher', 'student')`),
  check("members_status_check", sql`${table.status} in ('invited', 'active', 'archived')`),
  check("members_schedule_type_check", sql`${table.scheduleType} in ('fixed', 'floating')`),
  check("members_avatar_color_check", sql`${table.avatarColor} in ('indigo', 'violet', 'rose', 'amber', 'emerald', 'cyan', 'slate')`),
  index("idx_members_workspace_role").on(table.workspaceId, table.role),
  uniqueIndex("members_workspace_user_unique").on(table.workspaceId, table.userId),
]);

export const memberDisplayPreferences = pgTable("member_display_preferences", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  viewerMemberId: text("viewer_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  studentMemberId: text("student_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  avatarColor: text("avatar_color").notNull(),
  ...timestamps(),
}, (table) => [
  check("member_display_preferences_avatar_color_check", sql`${table.avatarColor} in ('indigo', 'violet', 'rose', 'amber', 'emerald', 'cyan', 'slate')`),
  uniqueIndex("member_display_preferences_viewer_student_unique").on(table.viewerMemberId, table.studentMemberId),
  index("idx_member_display_preferences_workspace").on(table.workspaceId),
]);

export const directMessages = pgTable("direct_messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  senderMemberId: text("sender_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  recipientMemberId: text("recipient_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  readAt: instant("read_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("direct_messages_body_length_check", sql`char_length(${table.body}) between 1 and 500`),
  check("direct_messages_participants_check", sql`${table.senderMemberId} <> ${table.recipientMemberId}`),
  index("idx_direct_messages_sender_created").on(table.senderMemberId, table.createdAt),
  index("idx_direct_messages_recipient_read_created").on(table.recipientMemberId, table.readAt, table.createdAt),
  index("idx_direct_messages_workspace_created").on(table.workspaceId, table.createdAt),
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

export const studentGroups = pgTable("student_groups", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  membersVisible: boolean("members_visible").notNull().default(false),
  status: text("status").notNull().default("active"),
  ...timestamps(),
}, (table) => [
  check("student_groups_name_check", sql`char_length(${table.name}) between 1 and 80`),
  check("student_groups_status_check", sql`${table.status} in ('active', 'archived')`),
  index("idx_student_groups_workspace").on(table.workspaceId, table.status),
]);

export const studentGroupMembers = pgTable("student_group_members", {
  groupId: text("group_id").notNull().references(() => studentGroups.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  joinedAt: instant("joined_at").notNull().defaultNow(),
  // The teacher can stop one member from writing in the group discussion.
  chatMuted: boolean("chat_muted").notNull().default(false),
}, (table) => [
  index("idx_student_group_members_member").on(table.memberId),
]);

// Group chat: teacher announcements (one may be pinned) and the members' discussion.
export const groupChatMessages = pgTable("group_chat_messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => studentGroups.id, { onDelete: "cascade" }),
  authorMemberId: text("author_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  deletedAt: instant("deleted_at"),
  deletedByMemberId: text("deleted_by_member_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("group_chat_messages_kind_check", sql`${table.kind} in ('announcement', 'discussion')`),
  check("group_chat_messages_body_check", sql`char_length(${table.body}) between 1 and 1000`),
  check("group_chat_messages_pinned_check", sql`not ${table.pinned} or ${table.kind} = 'announcement'`),
  index("idx_group_chat_messages_group_kind_created").on(table.groupId, table.kind, table.createdAt),
  index("idx_group_chat_messages_author_created").on(table.authorMemberId, table.createdAt),
]);

// How far each member has read each tab of a group chat (unread counters, "read by N of M").
export const groupChatReads = pgTable("group_chat_reads", {
  groupId: text("group_id").notNull().references(() => studentGroups.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  lastReadAt: instant("last_read_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: "group_chat_reads_pk", columns: [table.groupId, table.memberId, table.kind] }),
  check("group_chat_reads_kind_check", sql`${table.kind} in ('announcement', 'discussion')`),
]);

export const studentGroupSlots = pgTable("student_group_slots", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => studentGroups.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  activeFrom: date("active_from").notNull(),
  activeUntil: date("active_until"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps(),
}, (table) => [
  check("student_group_slots_weekday_check", sql`${table.weekday} between 1 and 7`),
  check("student_group_slots_start_check", sql`${table.startMinutes} between 0 and 1439`),
  check("student_group_slots_duration_check", sql`${table.durationMinutes} between 15 and 240`),
  index("idx_student_group_slots_group").on(table.groupId, table.isActive),
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
  // Group lessons: one row per member; members of one group may share a time slot.
  classId: text("class_id").references(() => studentGroups.id, { onDelete: "set null" }),
  classSlotId: text("class_slot_id").references(() => studentGroupSlots.id, { onDelete: "set null" }),
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
  index("idx_lessons_class_starts_at").on(table.classId, table.startsAt),
  uniqueIndex("lessons_class_slot_occurrence_unique").on(table.classSlotId, table.studentId, table.startsAt).where(sql`${table.classSlotId} is not null`),
  index("idx_lessons_pending_charge").on(table.chargeStatus, table.startsAt),
  uniqueIndex("lessons_series_start_unique").on(table.seriesId, table.startsAt).where(sql`${table.status} <> 'cancelled'`),
]);

export const teacherDayNotes = pgTable("teacher_day_notes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  authorMemberId: text("author_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  noteDate: date("note_date", { mode: "string" }).notNull(),
  body: text("body").notNull(),
  ...timestamps(),
}, (table) => [
  check("teacher_day_notes_body_length_check", sql`char_length(${table.body}) between 1 and 1000`),
  uniqueIndex("teacher_day_notes_author_date_unique").on(table.authorMemberId, table.noteDate),
  index("idx_teacher_day_notes_workspace_date").on(table.workspaceId, table.noteDate),
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

export const lessonHomework = pgTable("lesson_homework", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
  assignment: text("assignment"),
  studentResponse: text("student_response"),
  assignmentUpdatedByMemberId: text("assignment_updated_by_member_id").references(() => members.id, { onDelete: "set null" }),
  responseUpdatedByMemberId: text("response_updated_by_member_id").references(() => members.id, { onDelete: "set null" }),
  assignmentUpdatedAt: instant("assignment_updated_at"),
  responseUpdatedAt: instant("response_updated_at"),
  ...timestamps(),
}, (table) => [
  check("lesson_homework_assignment_length_check", sql`${table.assignment} is null or char_length(${table.assignment}) between 1 and 4000`),
  check("lesson_homework_response_length_check", sql`${table.studentResponse} is null or char_length(${table.studentResponse}) between 1 and 4000`),
  check("lesson_homework_content_check", sql`${table.assignment} is not null or ${table.studentResponse} is not null`),
  uniqueIndex("lesson_homework_lesson_unique").on(table.lessonId),
  index("idx_lesson_homework_workspace_lesson").on(table.workspaceId, table.lessonId),
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

export const teacherResources = pgTable("teacher_resources", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  uploadedByMemberId: text("uploaded_by_member_id").references(() => members.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  originalFilename: text("original_filename").notNull(),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  contentSha256: text("content_sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  folder: text("folder"),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  versionNumber: integer("version_number").notNull().default(1),
  lastUsedAt: instant("last_used_at"),
  audioCheckedAt: instant("audio_checked_at"),
  status: text("status").notNull().default("active"),
  deletedAt: instant("deleted_at"),
  ...timestamps(),
}, (table) => [
  check("teacher_resources_content_type_check", sql`${table.contentType} in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/webp', 'audio/mpeg')`),
  check("teacher_resources_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 26214400`),
  check("teacher_resources_status_check", sql`${table.status} in ('active', 'deleting', 'deleted')`),
  check("teacher_resources_title_length_check", sql`char_length(${table.title}) between 1 and 120`),
  check("teacher_resources_folder_length_check", sql`${table.folder} is null or char_length(${table.folder}) between 1 and 80`),
  check("teacher_resources_tags_count_check", sql`cardinality(${table.tags}) <= 10`),
  check("teacher_resources_version_check", sql`${table.versionNumber} >= 1`),
  uniqueIndex("teacher_resources_object_key_unique").on(table.objectKey),
  uniqueIndex("teacher_resources_workspace_hash_active_unique").on(table.workspaceId, table.contentSha256).where(sql`${table.status} = 'active'`),
  index("idx_teacher_resources_workspace_created").on(table.workspaceId, table.createdAt),
  index("idx_teacher_resources_cleanup").on(table.status, table.updatedAt),
]);

export const teacherResourceUploadEvents = pgTable("teacher_resource_upload_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  resourceId: text("resource_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  originalFilename: text("original_filename").notNull(),
  contentType: text("content_type").notNull(),
  contentSha256: text("content_sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("teacher_resource_upload_events_version_check", sql`${table.versionNumber} >= 1`),
  check("teacher_resource_upload_events_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 26214400`),
  uniqueIndex("teacher_resource_upload_events_resource_version_unique").on(table.resourceId, table.versionNumber),
  index("idx_teacher_resource_upload_events_workspace_created").on(table.workspaceId, table.createdAt),
]);

export const teacherResourceFileCleanup = pgTable("teacher_resource_file_cleanup", {
  id: text("id").primaryKey(),
  objectKey: text("object_key").notNull(),
  ...timestamps(),
}, (table) => [
  uniqueIndex("teacher_resource_file_cleanup_object_key_unique").on(table.objectKey),
  index("idx_teacher_resource_file_cleanup_created").on(table.createdAt),
]);

export const lessonResourceLinks = pgTable("lesson_resource_links", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
  resourceId: text("resource_id").notNull().references(() => teacherResources.id, { onDelete: "cascade" }),
  sharedByMemberId: text("shared_by_member_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("lesson_resource_links_lesson_resource_unique").on(table.lessonId, table.resourceId),
  index("idx_lesson_resource_links_workspace_lesson").on(table.workspaceId, table.lessonId),
  index("idx_lesson_resource_links_resource").on(table.resourceId),
]);

export const studentResourceLinks = pgTable("student_resource_links", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  resourceId: text("resource_id").notNull().references(() => teacherResources.id, { onDelete: "cascade" }),
  sharedByMemberId: text("shared_by_member_id").references(() => members.id, { onDelete: "set null" }),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("student_resource_links_student_resource_unique").on(table.studentId, table.resourceId),
  index("idx_student_resource_links_workspace_student").on(table.workspaceId, table.studentId),
  index("idx_student_resource_links_resource").on(table.resourceId),
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
  check("balance_entries_amount_check", sql`${table.amountCents} is null or ${table.amountCents} between 0 and 1000000000`),
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

export const notificationPreferences = pgTable("notification_preferences", {
  memberId: text("member_id").primaryKey().references(() => members.id, { onDelete: "cascade" }),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  telegramSchedule: boolean("telegram_schedule").notNull().default(true),
  telegramMessages: boolean("telegram_messages").notNull().default(false),
  telegramMaterials: boolean("telegram_materials").notNull().default(false),
  pushSchedule: boolean("push_schedule").notNull().default(true),
  pushMessages: boolean("push_messages").notNull().default(true),
  pushMaterials: boolean("push_materials").notNull().default(true),
  ...timestamps(),
});

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
  check("telegram_deliveries_kind_check", sql`${table.kind} in ('lesson_reminder', 'schedule_changed', 'new_request', 'new_message', 'new_material', 'account')`),
  check("telegram_deliveries_status_check", sql`${table.status} in ('pending', 'sending', 'sent', 'failed', 'cancelled')`),
  check("telegram_deliveries_attempts_check", sql`${table.attempts} >= 0`),
  uniqueIndex("telegram_deliveries_dedupe_key_unique").on(table.dedupeKey),
  index("idx_telegram_deliveries_due").on(table.status, table.nextAttemptAt),
  index("idx_telegram_deliveries_member_created").on(table.memberId, table.createdAt),
]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  language: text("language").notNull().default("ru"),
  lastSuccessAt: instant("last_success_at"),
  ...timestamps(),
}, (table) => [
  check("push_subscriptions_language_check", sql`${table.language} in ('ru', 'en')`),
  uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
  index("idx_push_subscriptions_member").on(table.memberId),
]);

export const pushDeliveries = pgTable("push_deliveries", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  notificationId: text("notification_id").references(() => notifications.id, { onDelete: "set null" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: instant("next_attempt_at").notNull().defaultNow(),
  sentAt: instant("sent_at"),
  lastError: text("last_error"),
  ...timestamps(),
}, (table) => [
  check("push_deliveries_kind_check", sql`${table.kind} in ('lesson_reminder', 'schedule_changed', 'new_request', 'new_message', 'new_material', 'test', 'account')`),
  check("push_deliveries_status_check", sql`${table.status} in ('pending', 'sending', 'sent', 'failed', 'cancelled')`),
  check("push_deliveries_attempts_check", sql`${table.attempts} >= 0`),
  uniqueIndex("push_deliveries_dedupe_key_unique").on(table.dedupeKey),
  index("idx_push_deliveries_due").on(table.status, table.nextAttemptAt),
  index("idx_push_deliveries_member_created").on(table.memberId, table.createdAt),
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

// Anonymized platform statistics (numbers only): one row per Moscow day, kept forever.
export const platformDailyStats = pgTable("platform_daily_stats", {
  day: date("day").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

// Host load once an hour, kept 90 days; the daily row keeps its average and peak.
export const platformHourlyLoad = pgTable("platform_hourly_load", {
  hour: instant("hour").primaryKey(),
  data: jsonb("data").notNull(),
});

// Platform-wide settings entered by the admin, e.g. cost rates for the economics estimate.
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

// Hourly request counters written by the app (lib/request-metrics.ts); kept 90 days.
export const platformRequestStats = pgTable("platform_request_stats", {
  hour: instant("hour").notNull(),
  kind: text("kind").notNull(),
  requests: integer("requests").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  totalMs: bigint("total_ms", { mode: "number" }).notNull().default(0),
  buckets: integer("buckets").array().notNull().default(sql`'{0,0,0,0,0}'`),
  bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  peakOpen: integer("peak_open").notNull().default(0),
}, (table) => [
  primaryKey({ name: "platform_request_stats_pk", columns: [table.hour, table.kind] }),
  check("platform_request_stats_kind_check", sql`${table.kind} in ('page', 'api', 'file', 'realtime')`),
]);

// Last time each admin alert went out (throttling).
export const platformAlerts = pgTable("platform_alerts", {
  key: text("key").primaryKey(),
  lastSentAt: instant("last_sent_at").notNull(),
});

// Admin ↔ teacher communication (see «Связь с администрацией» in docs/BACKEND_RULES.md).
export const supportThreads = pgTable("support_threads", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open"),
  lastMessageAt: instant("last_message_at").notNull().defaultNow(),
  adminReadAt: instant("admin_read_at"),
  teacherReadAt: instant("teacher_read_at"),
}, (table) => [check("support_threads_status_check", sql`${table.status} in ('open', 'waiting', 'resolved')`)]);

export const supportMessages = pgTable("support_messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  fromAdmin: boolean("from_admin").notNull(),
  authorMemberId: text("author_member_id").references(() => members.id, { onDelete: "set null" }),
  topic: text("topic"),
  body: text("body").notNull(),
  device: text("device"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("support_messages_body_check", sql`char_length(${table.body}) between 1 and 2000`),
  check("support_messages_topic_check", sql`${table.topic} is null or ${table.topic} in ('bug', 'question', 'idea', 'payment')`),
  check("support_messages_device_check", sql`${table.device} is null or char_length(${table.device}) <= 200`),
  index("idx_support_messages_workspace_created").on(table.workspaceId, table.createdAt),
]);

export const platformNews = pgTable("platform_news", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  important: boolean("important").notNull().default(false),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: instant("published_at").notNull().defaultNow(),
}, (table) => [
  check("platform_news_title_check", sql`char_length(${table.title}) between 1 and 120`),
  check("platform_news_body_check", sql`char_length(${table.body}) between 1 and 4000`),
]);

export const platformNewsReads = pgTable("platform_news_reads", {
  newsId: text("news_id").notNull().references(() => platformNews.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  readAt: instant("read_at").notNull().defaultNow(),
  acknowledgedAt: instant("acknowledged_at"),
}, (table) => [primaryKey({ name: "platform_news_reads_pk", columns: [table.newsId, table.memberId] })]);

export const contentReports = pgTable("content_reports", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  reporterMemberId: text("reporter_member_id").references(() => members.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  comment: text("comment"),
  status: text("status").notNull().default("open"),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: instant("resolved_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("content_reports_type_check", sql`${table.resourceType} in ('teacher_resource', 'lesson_attachment', 'lesson_file')`),
  check("content_reports_reason_check", sql`${table.reason} in ('copyright', 'inappropriate', 'personal_data', 'other')`),
  check("content_reports_status_check", sql`${table.status} in ('open', 'dismissed', 'removed')`),
  check("content_reports_comment_check", sql`${table.comment} is null or char_length(${table.comment}) <= 500`),
  index("idx_content_reports_status_created").on(table.status, table.createdAt),
  uniqueIndex("content_reports_open_unique").on(table.resourceType, table.resourceId, table.reporterMemberId).where(sql`${table.status} = 'open'`),
]);

// Audio and documents attached to a lesson by the teacher or a student; removed 90 days after the lesson.
export const lessonFiles = pgTable("lesson_files", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  uploadedByMemberId: text("uploaded_by_member_id").references(() => members.id, { onDelete: "set null" }),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  originalFilename: text("original_filename").notNull(),
  byteSize: integer("byte_size").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: instant("expires_at").notNull(),
  deletedAt: instant("deleted_at"),
  audioCheckedAt: instant("audio_checked_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("lesson_files_type_check", sql`${table.contentType} in ('audio/mpeg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')`),
  check("lesson_files_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 20971520`),
  check("lesson_files_status_check", sql`${table.status} in ('active', 'deleting', 'deleted')`),
  check("lesson_files_filename_check", sql`char_length(${table.originalFilename}) between 1 and 160`),
  uniqueIndex("lesson_files_object_key_unique").on(table.objectKey),
  index("idx_lesson_files_lesson_active").on(table.lessonId, table.status),
  index("idx_lesson_files_expiry").on(table.status, table.expiresAt),
  index("idx_lesson_files_uploader_created").on(table.uploadedByMemberId, table.createdAt),
]);
