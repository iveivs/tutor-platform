CREATE TABLE `teacher_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`professional_title` text DEFAULT 'Репетитор' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`workspace_id` text,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "teacher_registrations_status_check" CHECK("teacher_registrations"."status" in ('pending', 'claimed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_registrations_auth_subject_unique` ON `teacher_registrations` (`auth_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_registrations_email_unique` ON `teacher_registrations` (`email`);--> statement-breakpoint
CREATE INDEX `idx_teacher_registrations_status_expires` ON `teacher_registrations` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `last_activity_at` integer;