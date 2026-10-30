-- Direct messages: a library material sent into the chat (no file copy) and one pinned message per conversation.
ALTER TABLE "direct_messages" ADD COLUMN "resource_id" text;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "pinned_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_resource_id_teacher_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."teacher_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A message with a material may have an empty caption.
ALTER TABLE "direct_messages" DROP CONSTRAINT "direct_messages_body_length_check";--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_body_length_check" CHECK (char_length("direct_messages"."body") <= 500);--> statement-breakpoint
CREATE INDEX "idx_direct_messages_pinned" ON "direct_messages" USING btree ("workspace_id") WHERE "pinned_at" IS NOT NULL;
