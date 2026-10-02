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
ALTER TABLE `workspaces` ADD COLUMN `access_grant` text DEFAULT 'legacy' NOT NULL CHECK (`access_grant` in ('legacy', 'complimentary', 'trial', 'paid'));--> statement-breakpoint
ALTER TABLE `workspaces` ADD COLUMN `access_expires_at` integer;
