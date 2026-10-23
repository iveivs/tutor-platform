CREATE TABLE "teacher_day_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"author_member_id" text NOT NULL,
	"note_date" date NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_day_notes_body_length_check" CHECK (char_length("teacher_day_notes"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "teacher_day_notes" ADD CONSTRAINT "teacher_day_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "teacher_day_notes" ADD CONSTRAINT "teacher_day_notes_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_day_notes_author_date_unique" ON "teacher_day_notes" USING btree ("author_member_id","note_date");
--> statement-breakpoint
CREATE INDEX "idx_teacher_day_notes_workspace_date" ON "teacher_day_notes" USING btree ("workspace_id","note_date");
--> statement-breakpoint
CREATE TRIGGER teacher_day_notes_set_updated_at BEFORE UPDATE ON teacher_day_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_teacher_day_note_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_workspace text;
DECLARE changed_member text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed_workspace := OLD.workspace_id;
    changed_member := OLD.author_member_id;
  ELSE
    changed_workspace := NEW.workspace_id;
    changed_member := NEW.author_member_id;
  END IF;
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  VALUES (changed_workspace, changed_member, 'dayNotes');
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER data_changes_teacher_day_notes_insert AFTER INSERT ON teacher_day_notes FOR EACH ROW EXECUTE FUNCTION emit_teacher_day_note_change();
CREATE TRIGGER data_changes_teacher_day_notes_update AFTER UPDATE ON teacher_day_notes FOR EACH ROW EXECUTE FUNCTION emit_teacher_day_note_change();
CREATE TRIGGER data_changes_teacher_day_notes_delete AFTER DELETE ON teacher_day_notes FOR EACH ROW EXECUTE FUNCTION emit_teacher_day_note_change();
