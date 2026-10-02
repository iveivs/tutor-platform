CREATE TABLE `teacher_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`professional_title` text DEFAULT 'Репетитор' NOT NULL,
	`access_grant` text DEFAULT 'complimentary' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`workspace_id` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "teacher_invitations_status_check" CHECK("teacher_invitations"."status" in ('pending', 'accepted', 'revoked')),
	CONSTRAINT "teacher_invitations_access_grant_check" CHECK("teacher_invitations"."access_grant" in ('complimentary', 'trial', 'paid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_invitations_token_hash_unique` ON `teacher_invitations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_invitations_pending_email_unique` ON `teacher_invitations` (`email`) WHERE "teacher_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `idx_teacher_invitations_status_expires` ON `teacher_invitations` (`status`,`expires_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Moscow' NOT NULL,
	`subscription_status` text DEFAULT 'trial' NOT NULL,
	`access_status` text DEFAULT 'active' NOT NULL,
	`access_grant` text DEFAULT 'legacy' NOT NULL,
	`access_expires_at` integer,
	`last_activity_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "workspaces_subscription_status_check" CHECK("__new_workspaces"."subscription_status" in ('trial', 'active', 'past_due', 'cancelled')),
	CONSTRAINT "workspaces_access_status_check" CHECK("__new_workspaces"."access_status" in ('active', 'blocked')),
	CONSTRAINT "workspaces_access_grant_check" CHECK("__new_workspaces"."access_grant" in ('legacy', 'complimentary', 'trial', 'paid'))
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`("id", "name", "timezone", "subscription_status", "access_status", "access_grant", "access_expires_at", "last_activity_at", "created_at", "updated_at") SELECT "id", "name", "timezone", "subscription_status", "access_status", 'legacy', NULL, "last_activity_at", "created_at", "updated_at" FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
