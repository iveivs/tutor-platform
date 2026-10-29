-- Group chat (variant B): teacher announcements and a discussion of the members.
CREATE TABLE "group_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"group_id" text NOT NULL,
	"author_member_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"deleted_by_member_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_chat_messages_kind_check" CHECK ("group_chat_messages"."kind" in ('announcement', 'discussion')),
	CONSTRAINT "group_chat_messages_body_check" CHECK (char_length("group_chat_messages"."body") between 1 and 1000),
	CONSTRAINT "group_chat_messages_pinned_check" CHECK (not "group_chat_messages"."pinned" or "group_chat_messages"."kind" = 'announcement')
);
--> statement-breakpoint
CREATE TABLE "group_chat_reads" (
	"group_id" text NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"last_read_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_chat_reads_pk" PRIMARY KEY ("group_id", "member_id", "kind"),
	CONSTRAINT "group_chat_reads_kind_check" CHECK ("group_chat_reads"."kind" in ('announcement', 'discussion'))
);
--> statement-breakpoint
ALTER TABLE "student_group_members" ADD COLUMN "chat_muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_group_id_student_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."student_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_messages" ADD CONSTRAINT "group_chat_messages_deleted_by_member_id_members_id_fk" FOREIGN KEY ("deleted_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_reads" ADD CONSTRAINT "group_chat_reads_group_id_student_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."student_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_chat_reads" ADD CONSTRAINT "group_chat_reads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_group_chat_messages_group_kind_created" ON "group_chat_messages" USING btree ("group_id", "kind", "created_at");--> statement-breakpoint
CREATE INDEX "idx_group_chat_messages_author_created" ON "group_chat_messages" USING btree ("author_member_id", "created_at");--> statement-breakpoint

-- A teacher announcement reaches Telegram and push like a direct message (the "messages" category).
CREATE OR REPLACE FUNCTION enqueue_telegram_notification() RETURNS trigger AS $$
DECLARE
	delivery_kind text;
	delivery_message text;
	preference_column text;
BEGIN
	IF NEW.type = 'new_request' THEN
		delivery_kind := 'new_request';
		preference_column := 'schedule';
		SELECT NEW.title || E'\n' || COALESCE(student.display_name || ': ', '') || NEW.body
		INTO delivery_message
		FROM members student
		WHERE student.id = NEW.student_id;
		IF delivery_message IS NULL THEN
			delivery_message := NEW.title || E'\n' || NEW.body;
		END IF;
	ELSIF NEW.type IN ('lesson_created', 'lesson_rescheduled', 'lesson_cancelled', 'series_stopped', 'request_resolved') THEN
		delivery_kind := 'schedule_changed';
		preference_column := 'schedule';
		delivery_message := NEW.title || E'\n' || NEW.body;
	ELSIF NEW.type = 'direct_message' THEN
		delivery_kind := 'new_message';
		preference_column := 'messages';
		delivery_message := NEW.title || E'\nОткройте Тьюттори, чтобы прочитать сообщение.';
	ELSIF NEW.type = 'group_announcement' THEN
		delivery_kind := 'new_message';
		preference_column := 'messages';
		delivery_message := NEW.title || E'\n' || NEW.body;
	ELSIF NEW.type IN ('lesson_material_added', 'homework_updated', 'homework_response_updated') THEN
		delivery_kind := 'new_material';
		preference_column := 'materials';
		delivery_message := NEW.title || E'\n' || NEW.body;
	ELSE
		RETURN NEW;
	END IF;

	INSERT INTO telegram_deliveries (member_id, notification_id, lesson_id, kind, dedupe_key, message)
	SELECT NEW.member_id, NEW.id, NEW.lesson_id, delivery_kind, 'notification:' || NEW.id, delivery_message
	FROM telegram_connections connection
	LEFT JOIN notification_preferences preference ON preference.member_id = connection.member_id
	WHERE connection.member_id = NEW.member_id
		AND connection.disabled_at IS NULL
		AND CASE preference_column
			WHEN 'schedule' THEN COALESCE(preference.telegram_schedule, true)
			WHEN 'messages' THEN COALESCE(preference.telegram_messages, false)
			WHEN 'materials' THEN COALESCE(preference.telegram_materials, false)
			ELSE false
		END
	ON CONFLICT (dedupe_key) DO NOTHING;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_push_notification() RETURNS trigger AS $$
DECLARE
	delivery_kind text;
	delivery_body text;
	preference_column text;
BEGIN
	IF NEW.type = 'new_request' THEN
		delivery_kind := 'new_request';
		preference_column := 'schedule';
		SELECT COALESCE(student.display_name || ': ', '') || NEW.body
		INTO delivery_body
		FROM members student
		WHERE student.id = NEW.student_id;
		IF delivery_body IS NULL THEN
			delivery_body := NEW.body;
		END IF;
	ELSIF NEW.type IN ('lesson_created', 'lesson_rescheduled', 'lesson_cancelled', 'series_stopped', 'request_resolved') THEN
		delivery_kind := 'schedule_changed';
		preference_column := 'schedule';
		delivery_body := NEW.body;
	ELSIF NEW.type = 'direct_message' THEN
		delivery_kind := 'new_message';
		preference_column := 'messages';
		delivery_body := 'Откройте Тьюттори, чтобы прочитать сообщение.';
	ELSIF NEW.type = 'group_announcement' THEN
		delivery_kind := 'new_message';
		preference_column := 'messages';
		delivery_body := NEW.body;
	ELSIF NEW.type IN ('lesson_material_added', 'homework_updated', 'homework_response_updated') THEN
		delivery_kind := 'new_material';
		preference_column := 'materials';
		delivery_body := NEW.body;
	ELSE
		RETURN NEW;
	END IF;

	INSERT INTO push_deliveries (member_id, notification_id, lesson_id, kind, dedupe_key, title, body)
	SELECT NEW.member_id, NEW.id, NEW.lesson_id, delivery_kind, 'notification:' || NEW.id, NEW.title, delivery_body
	FROM members recipient
	LEFT JOIN notification_preferences preference ON preference.member_id = recipient.id
	WHERE recipient.id = NEW.member_id
		AND EXISTS (SELECT 1 FROM push_subscriptions subscription WHERE subscription.member_id = recipient.id)
		AND CASE preference_column
			WHEN 'schedule' THEN COALESCE(preference.push_schedule, true)
			WHEN 'messages' THEN COALESCE(preference.push_messages, true)
			WHEN 'materials' THEN COALESCE(preference.push_materials, true)
			ELSE false
		END
	ON CONFLICT (dedupe_key) DO NOTHING;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
