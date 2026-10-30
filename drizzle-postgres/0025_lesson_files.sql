-- Audio and documents attached to a lesson by the teacher or a student (for example a recording of
-- homework). Kept like lesson photos: until 90 days after the lesson, then removed by the worker.
CREATE TABLE "lesson_files" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lesson_id" text,
	"uploaded_by_member_id" text,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"original_filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_files_type_check" CHECK ("lesson_files"."content_type" in ('audio/mpeg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
	CONSTRAINT "lesson_files_size_check" CHECK ("lesson_files"."byte_size" > 0 and "lesson_files"."byte_size" <= 20971520),
	CONSTRAINT "lesson_files_status_check" CHECK ("lesson_files"."status" in ('active', 'deleting', 'deleted')),
	CONSTRAINT "lesson_files_filename_check" CHECK (char_length("lesson_files"."original_filename") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "lesson_files" ADD CONSTRAINT "lesson_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_files" ADD CONSTRAINT "lesson_files_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_files" ADD CONSTRAINT "lesson_files_uploaded_by_member_id_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_files_object_key_unique" ON "lesson_files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "idx_lesson_files_lesson_active" ON "lesson_files" USING btree ("lesson_id", "status");--> statement-breakpoint
CREATE INDEX "idx_lesson_files_expiry" ON "lesson_files" USING btree ("status", "expires_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_files_uploader_created" ON "lesson_files" USING btree ("uploaded_by_member_id", "created_at");--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_type_check";--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_type_check" CHECK ("content_reports"."resource_type" in ('teacher_resource', 'lesson_attachment', 'lesson_file'));
