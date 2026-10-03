CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE lessons ADD CONSTRAINT lessons_workspace_time_exclusion
  EXCLUDE USING gist (
    workspace_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status <> 'cancelled');
--> statement-breakpoint
ALTER TABLE balance_entries ADD CONSTRAINT balance_entries_reverses_entry_fk
  FOREIGN KEY (reverses_entry_id) REFERENCES balance_entries(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER teacher_registrations_set_updated_at BEFORE UPDATE ON teacher_registrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER teacher_invitations_set_updated_at BEFORE UPDATE ON teacher_invitations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER members_set_updated_at BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lesson_series_set_updated_at BEFORE UPDATE ON lesson_series FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lessons_set_updated_at BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lesson_requests_set_updated_at BEFORE UPDATE ON lesson_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_member_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'students,profile'
  FROM members WHERE workspace_id = NEW.workspace_id AND status = 'active';
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_student_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, TG_ARGV[0]
  FROM members
  WHERE workspace_id = NEW.workspace_id
    AND status = 'active'
    AND (id = NEW.student_id OR role IN ('owner', 'teacher'));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_notification_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT workspace_id, NEW.member_id, 'notifications' FROM members WHERE id = NEW.member_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_availability_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_workspace text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed_workspace := OLD.workspace_id;
  ELSE
    changed_workspace := NEW.workspace_id;
  END IF;
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT changed_workspace, id, 'availability'
  FROM members
  WHERE workspace_id = changed_workspace
    AND status = 'active'
    AND (role IN ('owner', 'teacher') OR can_view_availability);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_lesson_availability_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT NEW.workspace_id, id, 'availability'
  FROM members
  WHERE workspace_id = NEW.workspace_id AND status = 'active' AND can_view_availability;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_member_availability_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.can_view_availability IS DISTINCT FROM OLD.can_view_availability AND NEW.status = 'active' THEN
    INSERT INTO data_changes (workspace_id, audience_member_id, sections)
    VALUES (NEW.workspace_id, NEW.id, 'students,availability');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER data_changes_members_insert AFTER INSERT ON members FOR EACH ROW EXECUTE FUNCTION emit_member_changes();
CREATE TRIGGER data_changes_members_update AFTER UPDATE ON members FOR EACH ROW EXECUTE FUNCTION emit_member_changes();
CREATE TRIGGER data_changes_series_insert AFTER INSERT ON lesson_series FOR EACH ROW EXECUTE FUNCTION emit_student_changes('students,lessons');
CREATE TRIGGER data_changes_series_update AFTER UPDATE ON lesson_series FOR EACH ROW EXECUTE FUNCTION emit_student_changes('students,lessons');
CREATE TRIGGER data_changes_lessons_insert AFTER INSERT ON lessons FOR EACH ROW EXECUTE FUNCTION emit_student_changes('students,lessons');
CREATE TRIGGER data_changes_lessons_update AFTER UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION emit_student_changes('students,lessons');
CREATE TRIGGER data_changes_requests_insert AFTER INSERT ON lesson_requests FOR EACH ROW EXECUTE FUNCTION emit_student_changes('requests,lessons,historyEvents');
CREATE TRIGGER data_changes_requests_update AFTER UPDATE ON lesson_requests FOR EACH ROW EXECUTE FUNCTION emit_student_changes('requests,lessons,historyEvents');
CREATE TRIGGER data_changes_balance_insert AFTER INSERT ON balance_entries FOR EACH ROW EXECUTE FUNCTION emit_student_changes('students,lessons,balanceEntries,historyEvents');
CREATE TRIGGER data_changes_lesson_events_insert AFTER INSERT ON lesson_events FOR EACH ROW EXECUTE FUNCTION emit_student_changes('historyEvents');
CREATE TRIGGER data_changes_notifications_insert AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION emit_notification_change();
CREATE TRIGGER data_changes_notifications_update AFTER UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION emit_notification_change();
CREATE TRIGGER data_changes_availability_insert AFTER INSERT ON availability_windows FOR EACH ROW EXECUTE FUNCTION emit_availability_change();
CREATE TRIGGER data_changes_availability_delete AFTER DELETE ON availability_windows FOR EACH ROW EXECUTE FUNCTION emit_availability_change();
CREATE TRIGGER data_changes_lessons_availability_insert AFTER INSERT ON lessons FOR EACH ROW EXECUTE FUNCTION emit_lesson_availability_change();
CREATE TRIGGER data_changes_lessons_availability_update AFTER UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION emit_lesson_availability_change();
CREATE TRIGGER data_changes_member_availability_update AFTER UPDATE OF can_view_availability ON members FOR EACH ROW EXECUTE FUNCTION emit_member_availability_change();
