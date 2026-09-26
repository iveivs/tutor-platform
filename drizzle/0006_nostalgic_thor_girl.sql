CREATE TABLE `data_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`audience_member_id` text NOT NULL,
	`sections` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audience_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_data_changes_audience_id` ON `data_changes` (`audience_member_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_data_changes_workspace_id` ON `data_changes` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TRIGGER `data_changes_members_insert` AFTER INSERT ON `members` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,profile' FROM members WHERE workspace_id = NEW.workspace_id AND status = 'active';
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_members_update` AFTER UPDATE ON `members` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,profile' FROM members WHERE workspace_id = NEW.workspace_id AND status = 'active';
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_series_insert` AFTER INSERT ON `lesson_series` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,lessons' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_series_update` AFTER UPDATE ON `lesson_series` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,lessons' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_lessons_insert` AFTER INSERT ON `lessons` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,lessons' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_lessons_update` AFTER UPDATE ON `lessons` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,lessons' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_requests_insert` AFTER INSERT ON `lesson_requests` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'requests,lessons,historyEvents' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_requests_update` AFTER UPDATE ON `lesson_requests` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'requests,lessons,historyEvents' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_balance_insert` AFTER INSERT ON `balance_entries` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,lessons,balanceEntries,historyEvents' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_lesson_events_insert` AFTER INSERT ON `lesson_events` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'historyEvents' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_notifications_insert` AFTER INSERT ON `notifications` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT workspace_id, NEW.member_id, 'notifications' FROM members WHERE id = NEW.member_id;
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_notifications_update` AFTER UPDATE ON `notifications` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT workspace_id, NEW.member_id, 'notifications' FROM members WHERE id = NEW.member_id;
END;
