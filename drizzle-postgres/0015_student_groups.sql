-- Group lessons. A group has members and weekly slots; every session is one lesson row per member
-- (class_id = group), so charges, requests, reminders and history keep working per student.
CREATE TABLE "student_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"members_visible" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_groups_name_check" CHECK (char_length("student_groups"."name") between 1 and 80),
	CONSTRAINT "student_groups_status_check" CHECK ("student_groups"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_student_groups_workspace" ON "student_groups" USING btree ("workspace_id", "status");
--> statement-breakpoint
CREATE TRIGGER student_groups_set_updated_at BEFORE UPDATE ON student_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TABLE "student_group_members" (
	"group_id" text NOT NULL,
	"member_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"joined_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_group_members_pk" PRIMARY KEY ("group_id", "member_id")
);
--> statement-breakpoint
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."student_groups"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_student_group_members_member" ON "student_group_members" USING btree ("member_id");
--> statement-breakpoint
CREATE TABLE "student_group_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minutes" integer NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"active_from" date NOT NULL,
	"active_until" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_group_slots_weekday_check" CHECK ("student_group_slots"."weekday" between 1 and 7),
	CONSTRAINT "student_group_slots_start_check" CHECK ("student_group_slots"."start_minutes" between 0 and 1439),
	CONSTRAINT "student_group_slots_duration_check" CHECK ("student_group_slots"."duration_minutes" between 15 and 240)
);
--> statement-breakpoint
ALTER TABLE "student_group_slots" ADD CONSTRAINT "student_group_slots_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."student_groups"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_group_slots" ADD CONSTRAINT "student_group_slots_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_student_group_slots_group" ON "student_group_slots" USING btree ("group_id", "is_active");
--> statement-breakpoint
CREATE TRIGGER student_group_slots_set_updated_at BEFORE UPDATE ON student_group_slots FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "class_id" text;
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "class_slot_id" text;
--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_class_id_student_groups_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."student_groups"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_class_slot_id_student_group_slots_id_fk" FOREIGN KEY ("class_slot_id") REFERENCES "public"."student_group_slots"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_lessons_class_starts_at" ON "lessons" USING btree ("class_id", "starts_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_class_slot_occurrence_unique" ON "lessons" USING btree ("class_slot_id", "student_id", "starts_at") WHERE "class_slot_id" IS NOT NULL;
--> statement-breakpoint
-- Members of one group share a time slot; any other overlap is still rejected.
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_workspace_time_exclusion";
--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_workspace_time_exclusion" EXCLUDE USING gist ("workspace_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&, (COALESCE("class_id", "id")) WITH <>) WHERE ("status" <> 'cancelled');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION emit_student_group_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_workspace text;
BEGIN
  IF TG_OP = 'DELETE' THEN changed_workspace := OLD.workspace_id; ELSE changed_workspace := NEW.workspace_id; END IF;
  INSERT INTO data_changes (workspace_id, audience_member_id, sections)
  SELECT changed_workspace, id, 'groups,lessons' FROM members WHERE workspace_id = changed_workspace AND status = 'active';
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER data_changes_student_groups AFTER INSERT OR UPDATE OR DELETE ON student_groups FOR EACH ROW EXECUTE FUNCTION emit_student_group_change();
CREATE TRIGGER data_changes_student_group_members AFTER INSERT OR UPDATE OR DELETE ON student_group_members FOR EACH ROW EXECUTE FUNCTION emit_student_group_change();
CREATE TRIGGER data_changes_student_group_slots AFTER INSERT OR UPDATE OR DELETE ON student_group_slots FOR EACH ROW EXECUTE FUNCTION emit_student_group_change();
