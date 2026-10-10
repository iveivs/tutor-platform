CREATE TABLE "lesson_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lesson_id" text,
	"uploaded_by_member_id" text,
	"object_key" text NOT NULL,
	"content_type" text DEFAULT 'image/webp' NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_attachments_status_check" CHECK ("lesson_attachments"."status" in ('active', 'deleting', 'deleted')),
	CONSTRAINT "lesson_attachments_size_check" CHECK ("lesson_attachments"."byte_size" > 0 and "lesson_attachments"."byte_size" <= 5242880),
	CONSTRAINT "lesson_attachments_dimensions_check" CHECK ("lesson_attachments"."width" > 0 and "lesson_attachments"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "lesson_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"author_member_id" text NOT NULL,
	"visibility" text DEFAULT 'shared' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_notes_visibility_check" CHECK ("lesson_notes"."visibility" in ('shared', 'teacher_private')),
	CONSTRAINT "lesson_notes_body_length_check" CHECK (char_length("lesson_notes"."body") between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" DROP CONSTRAINT "legal_acceptances_source_check";--> statement-breakpoint
ALTER TABLE "lesson_attachments" ADD CONSTRAINT "lesson_attachments_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_attachments" ADD CONSTRAINT "lesson_attachments_uploaded_by_member_id_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_attachments_object_key_unique" ON "lesson_attachments" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "idx_lesson_attachments_lesson_active" ON "lesson_attachments" USING btree ("lesson_id","status");--> statement-breakpoint
CREATE INDEX "idx_lesson_attachments_expiry" ON "lesson_attachments" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_attachments_workspace_created" ON "lesson_attachments" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_notes_author_visibility_unique" ON "lesson_notes" USING btree ("lesson_id","author_member_id","visibility");--> statement-breakpoint
CREATE INDEX "idx_lesson_notes_workspace_lesson" ON "lesson_notes" USING btree ("workspace_id","lesson_id");--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_source_check" CHECK ("legal_acceptances"."source" in ('teacher_invite', 'student_invite', 'in_app'));
--> statement-breakpoint
CREATE TRIGGER lesson_notes_set_updated_at BEFORE UPDATE ON lesson_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lesson_attachments_set_updated_at BEFORE UPDATE ON lesson_attachments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
