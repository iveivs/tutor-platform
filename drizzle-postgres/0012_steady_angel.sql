CREATE TABLE "student_resource_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"student_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"shared_by_member_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_resource_links" ADD CONSTRAINT "student_resource_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_resource_links" ADD CONSTRAINT "student_resource_links_student_id_members_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_resource_links" ADD CONSTRAINT "student_resource_links_resource_id_teacher_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."teacher_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_resource_links" ADD CONSTRAINT "student_resource_links_shared_by_member_id_members_id_fk" FOREIGN KEY ("shared_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_resource_links_student_resource_unique" ON "student_resource_links" USING btree ("student_id","resource_id");--> statement-breakpoint
CREATE INDEX "idx_student_resource_links_workspace_student" ON "student_resource_links" USING btree ("workspace_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_student_resource_links_resource" ON "student_resource_links" USING btree ("resource_id");