CREATE TABLE "telegram_connections" (
	"member_id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"username" text,
	"connected_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_deliveries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telegram_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"member_id" text NOT NULL,
	"notification_id" text,
	"lesson_id" text,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"last_error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_deliveries_kind_check" CHECK ("telegram_deliveries"."kind" in ('lesson_reminder', 'schedule_changed', 'new_request')),
	CONSTRAINT "telegram_deliveries_status_check" CHECK ("telegram_deliveries"."status" in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "telegram_deliveries_attempts_check" CHECK ("telegram_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"consumed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_connections_chat_id_unique" ON "telegram_connections" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "idx_telegram_connections_active" ON "telegram_connections" USING btree ("disabled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_deliveries_dedupe_key_unique" ON "telegram_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_telegram_deliveries_due" ON "telegram_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_telegram_deliveries_member_created" ON "telegram_deliveries" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_tokens_hash_unique" ON "telegram_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_telegram_link_tokens_member_expires" ON "telegram_link_tokens" USING btree ("member_id","expires_at");--> statement-breakpoint
CREATE FUNCTION enqueue_telegram_notification() RETURNS trigger AS $$
DECLARE
	delivery_kind text;
	delivery_message text;
BEGIN
	IF NEW.type = 'new_request' THEN
		delivery_kind := 'new_request';
		SELECT NEW.title || E'\n' || COALESCE(student.display_name || ': ', '') || NEW.body
		INTO delivery_message
		FROM members student
		WHERE student.id = NEW.student_id;
		IF delivery_message IS NULL THEN
			delivery_message := NEW.title || E'\n' || NEW.body;
		END IF;
	ELSIF NEW.type IN ('lesson_created', 'lesson_rescheduled', 'lesson_cancelled', 'series_stopped', 'request_resolved') THEN
		delivery_kind := 'schedule_changed';
		delivery_message := NEW.title || E'\n' || NEW.body;
	ELSE
		RETURN NEW;
	END IF;

	INSERT INTO telegram_deliveries (member_id, notification_id, lesson_id, kind, dedupe_key, message)
	SELECT NEW.member_id, NEW.id, NEW.lesson_id, delivery_kind, 'notification:' || NEW.id, delivery_message
	FROM telegram_connections connection
	WHERE connection.member_id = NEW.member_id AND connection.disabled_at IS NULL
	ON CONFLICT (dedupe_key) DO NOTHING;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER notifications_enqueue_telegram
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_telegram_notification();
