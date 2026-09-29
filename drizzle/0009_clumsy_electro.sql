UPDATE `lesson_requests` SET `status` = 'expired', `resolved_at` = unixepoch() * 1000, `updated_at` = unixepoch() * 1000
WHERE `status` = 'pending' AND `lesson_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `lessons` source
  JOIN `lessons` active ON active.workspace_id = source.workspace_id AND active.status = 'scheduled'
    AND (active.id = source.id OR (source.group_id IS NOT NULL AND active.group_id = source.group_id))
  WHERE source.id = lesson_requests.lesson_id
);--> statement-breakpoint
UPDATE `lesson_requests` SET `status` = 'expired', `resolved_at` = unixepoch() * 1000, `updated_at` = unixepoch() * 1000
WHERE `status` = 'pending' AND `lesson_id` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `lesson_requests` earlier
  WHERE earlier.student_id = lesson_requests.student_id AND earlier.lesson_id = lesson_requests.lesson_id AND earlier.status = 'pending'
    AND (earlier.created_at < lesson_requests.created_at OR (earlier.created_at = lesson_requests.created_at AND earlier.id < lesson_requests.id))
);--> statement-breakpoint
DROP INDEX `lesson_requests_pending_lesson_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_requests_pending_lesson_unique` ON `lesson_requests` (`student_id`,`lesson_id`) WHERE "lesson_requests"."status" = 'pending' and "lesson_requests"."lesson_id" is not null;
