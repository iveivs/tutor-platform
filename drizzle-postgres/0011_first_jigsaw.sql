CREATE TABLE "notification_preferences" (
	"member_id" text PRIMARY KEY NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"telegram_schedule" boolean DEFAULT true NOT NULL,
	"telegram_messages" boolean DEFAULT false NOT NULL,
	"telegram_materials" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_deliveries" DROP CONSTRAINT "telegram_deliveries_kind_check";--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_kind_check" CHECK ("telegram_deliveries"."kind" in ('lesson_reminder', 'schedule_changed', 'new_request', 'new_message', 'new_material'));--> statement-breakpoint
CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

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

CREATE OR REPLACE FUNCTION notify_realtime_data_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_notify('tutor_data_changes', json_build_object(
		'memberId', NEW.audience_member_id,
		'cursor', NEW.id,
		'sections', NEW.sections
	)::text);
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER data_changes_notify_realtime AFTER INSERT ON data_changes FOR EACH ROW EXECUTE FUNCTION notify_realtime_data_change();
