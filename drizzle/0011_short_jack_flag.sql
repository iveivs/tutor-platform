CREATE TABLE `platform_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "platform_audit_events_action_check" CHECK("platform_audit_events"."action" in ('workspace_blocked', 'workspace_unblocked'))
);
--> statement-breakpoint
CREATE INDEX `idx_platform_audit_workspace_created` ON `platform_audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_audit_actor_created` ON `platform_audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `is_platform_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `access_status` text DEFAULT 'active' NOT NULL CHECK (`access_status` in ('active', 'blocked'));--> statement-breakpoint
UPDATE `users` SET `is_platform_admin` = 1, `updated_at` = (unixepoch() * 1000)
WHERE `id` IN (
	SELECT `user_id` FROM `members`
	WHERE `workspace_id` = '1' AND `role` = 'owner' AND `status` = 'active' AND `user_id` IS NOT NULL
);
