CREATE TABLE `lesson_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`student_id` text NOT NULL,
	`lesson_id` text,
	`actor_member_id` text,
	`source_key` text NOT NULL,
	`event_type` text NOT NULL,
	`previous_starts_at` integer,
	`starts_at` integer,
	`ends_at` integer,
	`note` text,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lesson_events_type_check" CHECK("lesson_events"."event_type" in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'series_stopped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_events_source_key_unique` ON `lesson_events` (`source_key`);--> statement-breakpoint
CREATE INDEX `idx_lesson_events_workspace_occurred` ON `lesson_events` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_lesson_events_student_occurred` ON `lesson_events` (`student_id`,`occurred_at`);--> statement-breakpoint
INSERT INTO `lesson_events` (`id`, `workspace_id`, `student_id`, `lesson_id`, `actor_member_id`, `source_key`, `event_type`, `starts_at`, `ends_at`, `occurred_at`)
SELECT 'history-' || `id`, `workspace_id`, `student_id`, `id`, NULL, 'lesson-' || `status` || ':' || `id`,
  CASE `status` WHEN 'completed' THEN 'completed' ELSE 'cancelled' END,
  `starts_at`, `ends_at`,
  CASE `status` WHEN 'completed' THEN COALESCE(`completed_at`, `ends_at`) ELSE COALESCE(`cancelled_at`, `updated_at`) END
FROM `lessons`
WHERE `status` IN ('completed', 'cancelled');
