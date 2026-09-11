CREATE TABLE `balance_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`lesson_id` text,
	`kind` text NOT NULL,
	`lesson_units` integer NOT NULL,
	`amount_cents` integer,
	`note` text,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`recorded_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "balance_entries_kind_check" CHECK("balance_entries"."kind" in ('payment', 'lesson_charge', 'adjustment', 'refund'))
);
--> statement-breakpoint
CREATE INDEX `idx_balance_entries_student_occurred` ON `balance_entries` (`student_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `balance_entries_lesson_charge_unique` ON `balance_entries` (`lesson_id`,`kind`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_invitations_member` ON `invitations` (`member_id`);--> statement-breakpoint
CREATE TABLE `lesson_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`lesson_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`proposed_starts_at` integer,
	`proposed_ends_at` integer,
	`message` text,
	`cancellation_deadline_at` integer,
	`resolved_by_id` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lesson_requests_type_check" CHECK("lesson_requests"."type" in ('cancel', 'reschedule', 'new_lesson')),
	CONSTRAINT "lesson_requests_status_check" CHECK("lesson_requests"."status" in ('pending', 'approved', 'declined', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `idx_lesson_requests_workspace_status` ON `lesson_requests` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_lesson_requests_student_created` ON `lesson_requests` (`student_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lesson_series` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minutes` integer NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`active_from` text NOT NULL,
	`active_until` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lesson_series_weekday_check" CHECK("lesson_series"."weekday" between 1 and 7),
	CONSTRAINT "lesson_series_start_minutes_check" CHECK("lesson_series"."start_minutes" between 0 and 1439),
	CONSTRAINT "lesson_series_duration_check" CHECK("lesson_series"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_lesson_series_workspace_student` ON `lesson_series` (`workspace_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`series_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`charge_status` text DEFAULT 'pending' NOT NULL,
	`created_by_id` text NOT NULL,
	`completed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`series_id`) REFERENCES `lesson_series`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "lessons_status_check" CHECK("lessons"."status" in ('scheduled', 'completed', 'cancelled')),
	CONSTRAINT "lessons_charge_status_check" CHECK("lessons"."charge_status" in ('pending', 'charged', 'waived')),
	CONSTRAINT "lessons_time_check" CHECK("lessons"."ends_at" > "lessons"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `idx_lessons_workspace_starts_at` ON `lessons` (`workspace_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_lessons_student_starts_at` ON `lessons` (`student_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_lessons_pending_charge` ON `lessons` (`charge_status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`schedule_type` text DEFAULT 'floating' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "members_role_check" CHECK("members"."role" in ('owner', 'teacher', 'student')),
	CONSTRAINT "members_status_check" CHECK("members"."status" in ('invited', 'active', 'archived')),
	CONSTRAINT "members_schedule_type_check" CHECK("members"."schedule_type" in ('fixed', 'floating'))
);
--> statement-breakpoint
CREATE INDEX `idx_members_workspace_role` ON `members` (`workspace_id`,`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_workspace_user_unique` ON `members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_member_read_created` ON `notifications` (`member_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_unique` ON `users` (`auth_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Moscow' NOT NULL,
	`subscription_status` text DEFAULT 'trial' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "workspaces_subscription_status_check" CHECK("workspaces"."subscription_status" in ('trial', 'active', 'past_due', 'cancelled'))
);
