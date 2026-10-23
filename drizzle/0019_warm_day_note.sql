CREATE TABLE `teacher_day_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`author_member_id` text NOT NULL,
	`note_date` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "teacher_day_notes_body_length_check" CHECK(length("teacher_day_notes"."body") between 1 and 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_day_notes_author_date_unique` ON `teacher_day_notes` (`author_member_id`,`note_date`);
--> statement-breakpoint
CREATE INDEX `idx_teacher_day_notes_workspace_date` ON `teacher_day_notes` (`workspace_id`,`note_date`);
--> statement-breakpoint
CREATE TRIGGER `data_changes_teacher_day_notes_insert` AFTER INSERT ON `teacher_day_notes` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections) VALUES (NEW.workspace_id, NEW.author_member_id, 'dayNotes');
END;
--> statement-breakpoint
CREATE TRIGGER `data_changes_teacher_day_notes_update` AFTER UPDATE ON `teacher_day_notes` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections) VALUES (NEW.workspace_id, NEW.author_member_id, 'dayNotes');
END;
--> statement-breakpoint
CREATE TRIGGER `data_changes_teacher_day_notes_delete` AFTER DELETE ON `teacher_day_notes` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections) VALUES (OLD.workspace_id, OLD.author_member_id, 'dayNotes');
END;
