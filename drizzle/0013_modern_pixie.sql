PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`series_id` text,
	`group_id` text,
	`lesson_type` text DEFAULT 'regular' NOT NULL,
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
	CONSTRAINT "lessons_status_check" CHECK("__new_lessons"."status" in ('scheduled', 'completed', 'cancelled')),
	CONSTRAINT "lessons_type_check" CHECK("__new_lessons"."lesson_type" in ('regular', 'trial')),
	CONSTRAINT "lessons_charge_status_check" CHECK("__new_lessons"."charge_status" in ('pending', 'charged', 'waived')),
	CONSTRAINT "lessons_time_check" CHECK("__new_lessons"."ends_at" > "__new_lessons"."starts_at")
);
--> statement-breakpoint
INSERT INTO `__new_lessons`("id", "workspace_id", "student_id", "series_id", "group_id", "lesson_type", "starts_at", "ends_at", "status", "charge_status", "created_by_id", "completed_at", "cancelled_at", "created_at", "updated_at") SELECT "id", "workspace_id", "student_id", "series_id", "group_id", 'regular', "starts_at", "ends_at", "status", "charge_status", "created_by_id", "completed_at", "cancelled_at", "created_at", "updated_at" FROM `lessons`;--> statement-breakpoint
DROP TABLE `lessons`;--> statement-breakpoint
ALTER TABLE `__new_lessons` RENAME TO `lessons`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_lessons_workspace_starts_at` ON `lessons` (`workspace_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_lessons_student_starts_at` ON `lessons` (`student_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_lessons_group_id` ON `lessons` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_lessons_pending_charge` ON `lessons` (`charge_status`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_series_start_unique` ON `lessons` (`series_id`,`starts_at`) WHERE "lessons"."status" <> 'cancelled';
