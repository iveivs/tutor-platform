ALTER TABLE `notifications` ADD `student_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `notifications` ADD `lesson_id` text REFERENCES lessons(id);--> statement-breakpoint
ALTER TABLE `notifications` ADD `request_id` text REFERENCES lesson_requests(id);--> statement-breakpoint
ALTER TABLE `notifications` ADD `balance_entry_id` text REFERENCES balance_entries(id);--> statement-breakpoint
UPDATE notifications
SET student_id = member_id
WHERE student_id IS NULL
  AND member_id IN (SELECT id FROM members WHERE role = 'student');--> statement-breakpoint
UPDATE notifications
SET request_id = (
  SELECT request.id
  FROM lesson_requests request
  JOIN members recipient ON recipient.id = notifications.member_id
  WHERE request.workspace_id = recipient.workspace_id
    AND request.created_at = notifications.created_at
  ORDER BY request.id
  LIMIT 1
)
WHERE type = 'new_request' AND request_id IS NULL;--> statement-breakpoint
UPDATE notifications
SET request_id = (
  SELECT request.id
  FROM lesson_requests request
  WHERE request.student_id = notifications.member_id
    AND request.resolved_at BETWEEN notifications.created_at AND notifications.created_at + 999
  ORDER BY request.id
  LIMIT 1
)
WHERE type = 'request_resolved' AND request_id IS NULL;--> statement-breakpoint
UPDATE notifications
SET student_id = (SELECT student_id FROM lesson_requests WHERE id = notifications.request_id)
WHERE student_id IS NULL AND request_id IS NOT NULL;
