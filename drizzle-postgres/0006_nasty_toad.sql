CREATE TABLE "lesson_homework" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"assignment" text,
	"student_response" text,
	"assignment_updated_by_member_id" text,
	"response_updated_by_member_id" text,
	"assignment_updated_at" timestamp (3) with time zone,
	"response_updated_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_homework_assignment_length_check" CHECK ("lesson_homework"."assignment" is null or char_length("lesson_homework"."assignment") between 1 and 4000),
	CONSTRAINT "lesson_homework_response_length_check" CHECK ("lesson_homework"."student_response" is null or char_length("lesson_homework"."student_response") between 1 and 4000),
	CONSTRAINT "lesson_homework_content_check" CHECK ("lesson_homework"."assignment" is not null or "lesson_homework"."student_response" is not null)
);
--> statement-breakpoint
ALTER TABLE "lesson_homework" ADD CONSTRAINT "lesson_homework_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_homework" ADD CONSTRAINT "lesson_homework_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_homework" ADD CONSTRAINT "lesson_homework_assignment_updated_by_member_id_members_id_fk" FOREIGN KEY ("assignment_updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_homework" ADD CONSTRAINT "lesson_homework_response_updated_by_member_id_members_id_fk" FOREIGN KEY ("response_updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_homework_lesson_unique" ON "lesson_homework" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "idx_lesson_homework_workspace_lesson" ON "lesson_homework" USING btree ("workspace_id","lesson_id");
--> statement-breakpoint
CREATE TRIGGER lesson_homework_set_updated_at BEFORE UPDATE ON lesson_homework FOR EACH ROW EXECUTE FUNCTION set_updated_at();
