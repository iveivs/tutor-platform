CREATE TABLE "teacher_resource_file_cleanup" (
	"id" text PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_resource_upload_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_resource_upload_events_version_check" CHECK ("teacher_resource_upload_events"."version_number" >= 1),
	CONSTRAINT "teacher_resource_upload_events_size_check" CHECK ("teacher_resource_upload_events"."byte_size" > 0 and "teacher_resource_upload_events"."byte_size" <= 26214400)
);
--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD COLUMN "folder" text;--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD COLUMN "version_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD COLUMN "last_used_at" timestamp (3) with time zone;--> statement-breakpoint
INSERT INTO "teacher_resource_upload_events"
  ("id", "workspace_id", "resource_id", "version_number", "original_filename", "content_type", "content_sha256", "byte_size", "created_at")
SELECT "id" || ':v1', "workspace_id", "id", 1, "original_filename", "content_type", "content_sha256", "byte_size", "created_at"
FROM "teacher_resources"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "teacher_resource_upload_events" ADD CONSTRAINT "teacher_resource_upload_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_resource_file_cleanup_object_key_unique" ON "teacher_resource_file_cleanup" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "idx_teacher_resource_file_cleanup_created" ON "teacher_resource_file_cleanup" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_resource_upload_events_resource_version_unique" ON "teacher_resource_upload_events" USING btree ("resource_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_teacher_resource_upload_events_workspace_created" ON "teacher_resource_upload_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD CONSTRAINT "teacher_resources_folder_length_check" CHECK ("teacher_resources"."folder" is null or char_length("teacher_resources"."folder") between 1 and 80);--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD CONSTRAINT "teacher_resources_tags_count_check" CHECK (cardinality("teacher_resources"."tags") <= 10);--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD CONSTRAINT "teacher_resources_version_check" CHECK ("teacher_resources"."version_number" >= 1);--> statement-breakpoint
CREATE TRIGGER teacher_resource_file_cleanup_set_updated_at BEFORE UPDATE ON teacher_resource_file_cleanup FOR EACH ROW EXECUTE FUNCTION set_updated_at();
