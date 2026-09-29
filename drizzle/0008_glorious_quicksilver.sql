CREATE TABLE `availability_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minutes` integer NOT NULL,
	`end_minutes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "availability_windows_weekday_check" CHECK("availability_windows"."weekday" between 1 and 7),
	CONSTRAINT "availability_windows_start_check" CHECK("availability_windows"."start_minutes" between 0 and 1439),
	CONSTRAINT "availability_windows_end_check" CHECK("availability_windows"."end_minutes" > "availability_windows"."start_minutes" and "availability_windows"."end_minutes" <= "availability_windows"."start_minutes" + 1440)
);
--> statement-breakpoint
CREATE INDEX `idx_availability_windows_workspace_weekday` ON `availability_windows` (`workspace_id`,`weekday`);--> statement-breakpoint
ALTER TABLE `members` ADD `can_view_availability` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TRIGGER `data_changes_availability_insert` AFTER INSERT ON `availability_windows` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'availability' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND (role IN ('owner', 'teacher') OR can_view_availability = 1);
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_availability_delete` AFTER DELETE ON `availability_windows` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT OLD.workspace_id, id, 'availability' FROM members
  WHERE workspace_id = OLD.workspace_id AND status = 'active' AND (role IN ('owner', 'teacher') OR can_view_availability = 1);
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_lessons_availability_insert` AFTER INSERT ON `lessons` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'availability' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND can_view_availability = 1;
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_lessons_availability_update` AFTER UPDATE ON `lessons` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'availability' FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND can_view_availability = 1;
END;--> statement-breakpoint
CREATE TRIGGER `data_changes_member_availability_update` AFTER UPDATE OF `can_view_availability` ON `members` BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, NEW.id, 'students,availability' WHERE NEW.status = 'active';
END;
