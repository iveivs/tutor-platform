PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_direct_messages` (
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
	CONSTRAINT "direct_messages_body_length_check" CHECK(length("__new_direct_messages"."body") between 1 and 500),
	CONSTRAINT "direct_messages_participants_check" CHECK("__new_direct_messages"."sender_member_id" <> "__new_direct_messages"."recipient_member_id")
);
--> statement-breakpoint
INSERT INTO `__new_direct_messages`("id", "workspace_id", "sender_member_id", "recipient_member_id", "body", "read_at", "created_at") SELECT "id", "workspace_id", "sender_member_id", "recipient_member_id", "body", "read_at", "created_at" FROM `direct_messages`;--> statement-breakpoint
DROP TABLE `direct_messages`;--> statement-breakpoint
ALTER TABLE `__new_direct_messages` RENAME TO `direct_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_direct_messages_sender_created` ON `direct_messages` (`sender_member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_direct_messages_recipient_read_created` ON `direct_messages` (`recipient_member_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_direct_messages_workspace_created` ON `direct_messages` (`workspace_id`,`created_at`);