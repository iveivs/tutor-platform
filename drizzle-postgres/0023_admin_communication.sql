-- Communication between the platform admin and teachers: one support conversation per workspace,
-- platform news (important ones need «Ознакомлен») and complaints about a single file.
CREATE TABLE "support_threads" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"admin_read_at" timestamp (3) with time zone,
	"teacher_read_at" timestamp (3) with time zone,
	CONSTRAINT "support_threads_status_check" CHECK ("support_threads"."status" in ('open', 'waiting', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"from_admin" boolean NOT NULL,
	"author_member_id" text,
	"topic" text,
	"body" text NOT NULL,
	"device" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_body_check" CHECK (char_length("support_messages"."body") between 1 and 2000),
	CONSTRAINT "support_messages_topic_check" CHECK ("support_messages"."topic" is null or "support_messages"."topic" in ('bug', 'question', 'idea', 'payment')),
	CONSTRAINT "support_messages_device_check" CHECK ("support_messages"."device" is null or char_length("support_messages"."device") <= 200)
);
--> statement-breakpoint
CREATE TABLE "platform_news" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"important" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"published_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_news_title_check" CHECK (char_length("platform_news"."title") between 1 and 120),
	CONSTRAINT "platform_news_body_check" CHECK (char_length("platform_news"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "platform_news_reads" (
	"news_id" text NOT NULL,
	"member_id" text NOT NULL,
	"read_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp (3) with time zone,
	CONSTRAINT "platform_news_reads_pk" PRIMARY KEY ("news_id", "member_id")
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"reporter_member_id" text,
	"reason" text NOT NULL,
	"comment" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" text,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_type_check" CHECK ("content_reports"."resource_type" in ('teacher_resource', 'lesson_attachment')),
	CONSTRAINT "content_reports_reason_check" CHECK ("content_reports"."reason" in ('copyright', 'inappropriate', 'personal_data', 'other')),
	CONSTRAINT "content_reports_status_check" CHECK ("content_reports"."status" in ('open', 'dismissed', 'removed')),
	CONSTRAINT "content_reports_comment_check" CHECK ("content_reports"."comment" is null or char_length("content_reports"."comment") <= 500)
);
--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_news" ADD CONSTRAINT "platform_news_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_news_reads" ADD CONSTRAINT "platform_news_reads_news_id_platform_news_id_fk" FOREIGN KEY ("news_id") REFERENCES "public"."platform_news"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_news_reads" ADD CONSTRAINT "platform_news_reads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_member_id_members_id_fk" FOREIGN KEY ("reporter_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_support_messages_workspace_created" ON "support_messages" USING btree ("workspace_id", "created_at");--> statement-breakpoint
CREATE INDEX "idx_content_reports_status_created" ON "content_reports" USING btree ("status", "created_at");--> statement-breakpoint
-- One open complaint per file and reporter is enough.
CREATE UNIQUE INDEX "content_reports_open_unique" ON "content_reports" USING btree ("resource_type", "resource_id", "reporter_member_id") WHERE "status" = 'open';
