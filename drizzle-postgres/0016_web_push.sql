ALTER TABLE "notification_preferences" ADD COLUMN "push_schedule" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "push_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "push_materials" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"language" text DEFAULT 'ru' NOT NULL,
	"last_success_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_language_check" CHECK ("push_subscriptions"."language" in ('ru', 'en'))
);
--> statement-breakpoint
CREATE TABLE "push_deliveries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"member_id" text NOT NULL,
	"notification_id" text,
	"lesson_id" text,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp (3) with time zone,
	"last_error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_kind_check" CHECK ("push_deliveries"."kind" in ('lesson_reminder', 'schedule_changed', 'new_request', 'new_message', 'new_material', 'test')),
	CONSTRAINT "push_deliveries_status_check" CHECK ("push_deliveries"."status" in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "push_deliveries_attempts_check" CHECK ("push_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_unique" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "idx_push_subscriptions_member" ON "push_subscriptions" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_deliveries_dedupe_key_unique" ON "push_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_push_deliveries_due" ON "push_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_push_deliveries_member_created" ON "push_deliveries" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE TRIGGER push_subscriptions_set_updated_at BEFORE UPDATE ON push_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER push_deliveries_set_updated_at BEFORE UPDATE ON push_deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- Same event types and categories as enqueue_telegram_notification (0011), but for members
-- with at least one push subscription and the push_* preference columns.
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
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER notifications_enqueue_push
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_push_notification();--> statement-breakpoint

-- Wakes the worker's push loop right after commit instead of waiting for the 15-minute cycle.
CREATE OR REPLACE FUNCTION notify_push_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_notify('tutor_push_deliveries', NEW.id::text);
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER push_deliveries_notify AFTER INSERT ON push_deliveries FOR EACH ROW EXECUTE FUNCTION notify_push_delivery();
