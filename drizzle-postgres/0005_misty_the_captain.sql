CREATE TABLE "lesson_resource_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"shared_by_member_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"uploaded_by_member_id" text,
	"title" text NOT NULL,
	"original_filename" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_resources_content_type_check" CHECK ("teacher_resources"."content_type" in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
	CONSTRAINT "teacher_resources_size_check" CHECK ("teacher_resources"."byte_size" > 0 and "teacher_resources"."byte_size" <= 26214400),
	CONSTRAINT "teacher_resources_status_check" CHECK ("teacher_resources"."status" in ('active', 'deleting', 'deleted')),
	CONSTRAINT "teacher_resources_title_length_check" CHECK (char_length("teacher_resources"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "lesson_resource_links" ADD CONSTRAINT "lesson_resource_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_resource_links" ADD CONSTRAINT "lesson_resource_links_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_resource_links" ADD CONSTRAINT "lesson_resource_links_resource_id_teacher_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."teacher_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_resource_links" ADD CONSTRAINT "lesson_resource_links_shared_by_member_id_members_id_fk" FOREIGN KEY ("shared_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD CONSTRAINT "teacher_resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD CONSTRAINT "teacher_resources_uploaded_by_member_id_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_resource_links_lesson_resource_unique" ON "lesson_resource_links" USING btree ("lesson_id","resource_id");--> statement-breakpoint
CREATE INDEX "idx_lesson_resource_links_workspace_lesson" ON "lesson_resource_links" USING btree ("workspace_id","lesson_id");--> statement-breakpoint
CREATE INDEX "idx_lesson_resource_links_resource" ON "lesson_resource_links" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_resources_object_key_unique" ON "teacher_resources" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_resources_workspace_hash_active_unique" ON "teacher_resources" USING btree ("workspace_id","content_sha256") WHERE "teacher_resources"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_teacher_resources_workspace_created" ON "teacher_resources" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_teacher_resources_cleanup" ON "teacher_resources" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE TRIGGER teacher_resources_set_updated_at BEFORE UPDATE ON teacher_resources FOR EACH ROW EXECUTE FUNCTION set_updated_at();
