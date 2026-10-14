CREATE TABLE "direct_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sender_member_id" text NOT NULL,
	"recipient_member_id" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_messages_body_length_check" CHECK (char_length("direct_messages"."body") between 1 and 1000),
	CONSTRAINT "direct_messages_participants_check" CHECK ("direct_messages"."sender_member_id" <> "direct_messages"."recipient_member_id")
);
--> statement-breakpoint
CREATE TABLE "member_display_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"viewer_member_id" text NOT NULL,
	"student_member_id" text NOT NULL,
	"avatar_color" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_display_preferences_avatar_color_check" CHECK ("member_display_preferences"."avatar_color" in ('indigo', 'violet', 'rose', 'amber', 'emerald', 'cyan', 'slate'))
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_color" text DEFAULT 'indigo' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_object_key" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_updated_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_member_id_members_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_member_id_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_display_preferences" ADD CONSTRAINT "member_display_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_display_preferences" ADD CONSTRAINT "member_display_preferences_viewer_member_id_members_id_fk" FOREIGN KEY ("viewer_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_display_preferences" ADD CONSTRAINT "member_display_preferences_student_member_id_members_id_fk" FOREIGN KEY ("student_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_direct_messages_sender_created" ON "direct_messages" USING btree ("sender_member_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_direct_messages_recipient_read_created" ON "direct_messages" USING btree ("recipient_member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_direct_messages_workspace_created" ON "direct_messages" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_display_preferences_viewer_student_unique" ON "member_display_preferences" USING btree ("viewer_member_id","student_member_id");--> statement-breakpoint
CREATE INDEX "idx_member_display_preferences_workspace" ON "member_display_preferences" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_avatar_color_check" CHECK ("members"."avatar_color" in ('indigo', 'violet', 'rose', 'amber', 'emerald', 'cyan', 'slate'));--> statement-breakpoint
CREATE TRIGGER member_display_preferences_set_updated_at BEFORE UPDATE ON member_display_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
