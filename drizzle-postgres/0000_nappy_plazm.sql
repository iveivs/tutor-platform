CREATE TABLE "auth_audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text,
	"event_type" text NOT NULL,
	"email_hash" text,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"consumed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_purpose_check" CHECK ("auth_tokens"."purpose" in ('set_password', 'password_reset', 'email_verification'))
);
--> statement-breakpoint
CREATE TABLE "availability_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minutes" integer NOT NULL,
	"end_minutes" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_windows_weekday_check" CHECK ("availability_windows"."weekday" between 1 and 7),
	CONSTRAINT "availability_windows_start_check" CHECK ("availability_windows"."start_minutes" between 0 and 1439),
	CONSTRAINT "availability_windows_end_check" CHECK ("availability_windows"."end_minutes" > "availability_windows"."start_minutes" and "availability_windows"."end_minutes" <= "availability_windows"."start_minutes" + 1440)
);
--> statement-breakpoint
CREATE TABLE "balance_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"student_id" text NOT NULL,
	"lesson_id" text,
	"kind" text NOT NULL,
	"lesson_units" integer NOT NULL,
	"amount_cents" integer,
	"reverses_entry_id" text,
	"note" text,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"recorded_by_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_entries_kind_check" CHECK ("balance_entries"."kind" in ('payment', 'lesson_charge', 'adjustment', 'refund'))
);
--> statement-breakpoint
CREATE TABLE "data_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" text NOT NULL,
	"audience_member_id" text NOT NULL,
	"sections" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"member_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"accepted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"detail" text,
	CONSTRAINT "job_runs_status_check" CHECK ("job_runs"."status" in ('running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "lesson_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"student_id" text NOT NULL,
	"lesson_id" text,
	"actor_member_id" text,
	"source_key" text NOT NULL,
	"event_type" text NOT NULL,
	"previous_starts_at" timestamp (3) with time zone,
	"starts_at" timestamp (3) with time zone,
	"ends_at" timestamp (3) with time zone,
	"note" text,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_events_type_check" CHECK ("lesson_events"."event_type" in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'series_stopped'))
);
--> statement-breakpoint
CREATE TABLE "lesson_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"student_id" text NOT NULL,
	"lesson_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_starts_at" timestamp (3) with time zone,
	"proposed_ends_at" timestamp (3) with time zone,
	"message" text,
	"cancellation_deadline_at" timestamp (3) with time zone,
	"resolved_by_id" text,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_requests_type_check" CHECK ("lesson_requests"."type" in ('cancel', 'reschedule', 'new_lesson')),
	CONSTRAINT "lesson_requests_status_check" CHECK ("lesson_requests"."status" in ('pending', 'approved', 'declined', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "lesson_series" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"student_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minutes" integer NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"active_from" date NOT NULL,
	"active_until" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_series_weekday_check" CHECK ("lesson_series"."weekday" between 1 and 7),
	CONSTRAINT "lesson_series_start_minutes_check" CHECK ("lesson_series"."start_minutes" between 0 and 1439),
	CONSTRAINT "lesson_series_duration_check" CHECK ("lesson_series"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"student_id" text NOT NULL,
	"series_id" text,
	"group_id" text,
	"lesson_type" text DEFAULT 'regular' NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"charge_status" text DEFAULT 'pending' NOT NULL,
	"created_by_id" text NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"cancelled_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_status_check" CHECK ("lessons"."status" in ('scheduled', 'completed', 'cancelled')),
	CONSTRAINT "lessons_type_check" CHECK ("lessons"."lesson_type" in ('regular', 'trial')),
	CONSTRAINT "lessons_charge_status_check" CHECK ("lessons"."charge_status" in ('pending', 'charged', 'waived')),
	CONSTRAINT "lessons_time_check" CHECK ("lessons"."ends_at" > "lessons"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"professional_title" text DEFAULT 'Репетитор' NOT NULL,
	"email" text,
	"phone" text,
	"notes" text,
	"is_trial_contact" boolean DEFAULT false NOT NULL,
	"schedule_type" text DEFAULT 'floating' NOT NULL,
	"can_view_availability" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_role_check" CHECK ("members"."role" in ('owner', 'teacher', 'student')),
	CONSTRAINT "members_status_check" CHECK ("members"."status" in ('invited', 'active', 'archived')),
	CONSTRAINT "members_schedule_type_check" CHECK ("members"."schedule_type" in ('fixed', 'floating'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"student_id" text,
	"lesson_id" text,
	"request_id" text,
	"balance_entry_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"action" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_audit_events_action_check" CHECK ("platform_audit_events"."action" in ('workspace_blocked', 'workspace_unblocked'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_started_at" timestamp (3) with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "rate_limit_buckets_count_check" CHECK ("rate_limit_buckets"."request_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "teacher_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"professional_title" text DEFAULT 'Репетитор' NOT NULL,
	"access_grant" text DEFAULT 'complimentary' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"workspace_id" text,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"accepted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_invitations_status_check" CHECK ("teacher_invitations"."status" in ('pending', 'accepted', 'revoked')),
	CONSTRAINT "teacher_invitations_access_grant_check" CHECK ("teacher_invitations"."access_grant" in ('complimentary', 'trial', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "teacher_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_auth_subject" text,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"professional_title" text DEFAULT 'Репетитор' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"workspace_id" text,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"claimed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_registrations_status_check" CHECK ("teacher_registrations"."status" in ('pending', 'claimed'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"legacy_auth_subject" text,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text,
	"password_set_at" timestamp (3) with time zone,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"subscription_status" text DEFAULT 'trial' NOT NULL,
	"access_status" text DEFAULT 'active' NOT NULL,
	"access_grant" text DEFAULT 'legacy' NOT NULL,
	"access_expires_at" timestamp (3) with time zone,
	"last_activity_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_subscription_status_check" CHECK ("workspaces"."subscription_status" in ('trial', 'active', 'past_due', 'cancelled')),
	CONSTRAINT "workspaces_access_status_check" CHECK ("workspaces"."access_status" in ('active', 'blocked')),
	CONSTRAINT "workspaces_access_grant_check" CHECK ("workspaces"."access_grant" in ('legacy', 'complimentary', 'trial', 'paid'))
);
--> statement-breakpoint
ALTER TABLE "auth_audit_events" ADD CONSTRAINT "auth_audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_windows" ADD CONSTRAINT "availability_windows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_student_id_members_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_recorded_by_id_members_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_changes" ADD CONSTRAINT "data_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_changes" ADD CONSTRAINT "data_changes_audience_member_id_members_id_fk" FOREIGN KEY ("audience_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_events" ADD CONSTRAINT "lesson_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_events" ADD CONSTRAINT "lesson_events_student_id_members_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_events" ADD CONSTRAINT "lesson_events_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_events" ADD CONSTRAINT "lesson_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_requests" ADD CONSTRAINT "lesson_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_requests" ADD CONSTRAINT "lesson_requests_student_id_members_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_requests" ADD CONSTRAINT "lesson_requests_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_requests" ADD CONSTRAINT "lesson_requests_resolved_by_id_members_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_student_id_members_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_student_id_members_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_series_id_lesson_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lesson_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_id_members_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_id_members_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_lesson_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."lesson_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_balance_entry_id_balance_entries_id_fk" FOREIGN KEY ("balance_entry_id") REFERENCES "public"."balance_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_invitations" ADD CONSTRAINT "teacher_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_invitations" ADD CONSTRAINT "teacher_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_registrations" ADD CONSTRAINT "teacher_registrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_audit_user_created" ON "auth_audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_user_expires" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_user_purpose_expires" ON "auth_tokens" USING btree ("user_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "idx_availability_windows_workspace_weekday" ON "availability_windows" USING btree ("workspace_id","weekday");--> statement-breakpoint
CREATE INDEX "idx_balance_entries_student_occurred" ON "balance_entries" USING btree ("student_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_entries_lesson_charge_unique" ON "balance_entries" USING btree ("lesson_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_entries_reversal_unique" ON "balance_entries" USING btree ("reverses_entry_id") WHERE "balance_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_data_changes_audience_id" ON "data_changes" USING btree ("audience_member_id","id");--> statement-breakpoint
CREATE INDEX "idx_data_changes_workspace_id" ON "data_changes" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_invitations_member" ON "invitations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_job_runs_name_started" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_events_source_key_unique" ON "lesson_events" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "idx_lesson_events_workspace_occurred" ON "lesson_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_events_student_occurred" ON "lesson_events" USING btree ("student_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_requests_workspace_status" ON "lesson_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_lesson_requests_student_created" ON "lesson_requests" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_requests_pending_lesson_unique" ON "lesson_requests" USING btree ("student_id","lesson_id") WHERE "lesson_requests"."status" = 'pending' and "lesson_requests"."lesson_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_requests_pending_new_lesson_unique" ON "lesson_requests" USING btree ("student_id","type") WHERE "lesson_requests"."status" = 'pending' and "lesson_requests"."lesson_id" is null;--> statement-breakpoint
CREATE INDEX "idx_lesson_series_workspace_student" ON "lesson_series" USING btree ("workspace_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_lessons_workspace_starts_at" ON "lessons" USING btree ("workspace_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_lessons_student_starts_at" ON "lessons" USING btree ("student_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_lessons_group_id" ON "lessons" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_lessons_pending_charge" ON "lessons" USING btree ("charge_status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_series_start_unique" ON "lessons" USING btree ("series_id","starts_at") WHERE "lessons"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "idx_members_workspace_role" ON "members" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "members_workspace_user_unique" ON "members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_member_read_created" ON "notifications" USING btree ("member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_platform_audit_workspace_created" ON "platform_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_platform_audit_actor_created" ON "platform_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_scope_key_unique" ON "rate_limit_buckets" USING btree ("scope","key_hash");--> statement-breakpoint
CREATE INDEX "idx_rate_limit_buckets_expires" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_invitations_token_hash_unique" ON "teacher_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_invitations_pending_email_unique" ON "teacher_invitations" USING btree (lower("email")) WHERE "teacher_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_teacher_invitations_status_expires" ON "teacher_invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_registrations_legacy_subject_unique" ON "teacher_registrations" USING btree ("legacy_auth_subject") WHERE "teacher_registrations"."legacy_auth_subject" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_registrations_email_unique" ON "teacher_registrations" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "idx_teacher_registrations_status_expires" ON "teacher_registrations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_legacy_auth_subject_unique" ON "users" USING btree ("legacy_auth_subject") WHERE "users"."legacy_auth_subject" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "users" USING btree (lower("email"));