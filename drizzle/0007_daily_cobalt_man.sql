ALTER TABLE `lessons` ADD `group_id` text;--> statement-breakpoint
CREATE INDEX `idx_lessons_group_id` ON `lessons` (`group_id`);