CREATE TABLE `direct_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sender_member_id` text NOT NULL,
	`recipient_member_id` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "direct_messages_body_length_check" CHECK(length("direct_messages"."body") between 1 and 1000),
	CONSTRAINT "direct_messages_participants_check" CHECK("direct_messages"."sender_member_id" <> "direct_messages"."recipient_member_id")
);
--> statement-breakpoint
CREATE INDEX `idx_direct_messages_sender_created` ON `direct_messages` (`sender_member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_direct_messages_recipient_read_created` ON `direct_messages` (`recipient_member_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_direct_messages_workspace_created` ON `direct_messages` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `member_display_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`viewer_member_id` text NOT NULL,
	`student_member_id` text NOT NULL,
	`avatar_color` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`viewer_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_display_preferences_avatar_color_check" CHECK("member_display_preferences"."avatar_color" in ('indigo', 'violet', 'rose', 'amber', 'emerald', 'cyan', 'slate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_display_preferences_viewer_student_unique` ON `member_display_preferences` (`viewer_member_id`,`student_member_id`);--> statement-breakpoint
CREATE INDEX `idx_member_display_preferences_workspace` ON `member_display_preferences` (`workspace_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`display_name` text NOT NULL,
	`professional_title` text DEFAULT 'Репетитор' NOT NULL,
	`email` text,
	`phone` text,
	`notes` text,
	`avatar_color` text DEFAULT 'indigo' NOT NULL,
	`avatar_object_key` text,
	`avatar_updated_at` integer,
	`is_trial_contact` integer DEFAULT false NOT NULL,
	`schedule_type` text DEFAULT 'floating' NOT NULL,
	`can_view_availability` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "members_role_check" CHECK("__new_members"."role" in ('owner', 'teacher', 'student')),
	CONSTRAINT "members_status_check" CHECK("__new_members"."status" in ('invited', 'active', 'archived')),
	CONSTRAINT "members_schedule_type_check" CHECK("__new_members"."schedule_type" in ('fixed', 'floating')),
	CONSTRAINT "members_avatar_color_check" CHECK("__new_members"."avatar_color" in ('indigo', 'violet', 'rose', 'amber', 'emerald', 'cyan', 'slate'))
);
--> statement-breakpoint
INSERT INTO `__new_members`("id", "workspace_id", "user_id", "role", "status", "display_name", "professional_title", "email", "phone", "notes", "is_trial_contact", "schedule_type", "can_view_availability", "created_at", "updated_at") SELECT "id", "workspace_id", "user_id", "role", "status", "display_name", "professional_title", "email", "phone", "notes", "is_trial_contact", "schedule_type", "can_view_availability", "created_at", "updated_at" FROM `members`;--> statement-breakpoint
DROP TABLE `members`;--> statement-breakpoint
ALTER TABLE `__new_members` RENAME TO `members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_members_workspace_role` ON `members` (`workspace_id`,`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_workspace_user_unique` ON `members` (`workspace_id`,`user_id`);
