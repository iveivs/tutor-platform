-- Paid teacher subscriptions, step 1: manual payments recorded by the platform admin,
-- access end dates and the 7/3/1-day reminders. No payment provider yet.
CREATE TABLE "subscription_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"months" integer NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"receipt_ref" text,
	"access_from" timestamp (3) with time zone NOT NULL,
	"access_until" timestamp (3) with time zone NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"refunded_at" timestamp (3) with time zone,
	"created_by_user_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payments_amount_check" CHECK ("subscription_payments"."amount_cents" between 0 and 100000000),
	CONSTRAINT "subscription_payments_months_check" CHECK ("subscription_payments"."months" between 1 and 24),
	CONSTRAINT "subscription_payments_method_check" CHECK ("subscription_payments"."method" in ('transfer', 'cash', 'other')),
	CONSTRAINT "subscription_payments_status_check" CHECK ("subscription_payments"."status" in ('paid', 'refunded')),
	CONSTRAINT "subscription_payments_receipt_check" CHECK ("subscription_payments"."receipt_ref" is null or length("subscription_payments"."receipt_ref") <= 100)
);
--> statement-breakpoint
CREATE TABLE "workspace_access_reminders" (
	"workspace_id" text NOT NULL,
	"access_expires_at" timestamp (3) with time zone NOT NULL,
	"stage" smallint NOT NULL,
	"sent_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_access_reminders_pk" PRIMARY KEY ("workspace_id", "access_expires_at", "stage"),
	CONSTRAINT "workspace_access_reminders_stage_check" CHECK ("workspace_access_reminders"."stage" in (0, 1, 3, 7))
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_access_reminders" ADD CONSTRAINT "workspace_access_reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_subscription_payments_workspace_paid" ON "subscription_payments" USING btree ("workspace_id", "paid_on");--> statement-breakpoint
CREATE TRIGGER subscription_payments_set_updated_at BEFORE UPDATE ON subscription_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "admin_note" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_admin_note_check" CHECK ("workspaces"."admin_note" is null or length("workspaces"."admin_note") <= 2000);--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_action_check";--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_action_check" CHECK ("platform_audit_events"."action" in ('workspace_blocked', 'workspace_unblocked', 'access_terms_changed', 'subscription_payment_added', 'subscription_payment_refunded'));--> statement-breakpoint
ALTER TABLE "telegram_deliveries" DROP CONSTRAINT "telegram_deliveries_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_kind_check" CHECK ("telegram_deliveries"."kind" in ('lesson_reminder', 'schedule_changed', 'new_request', 'new_message', 'new_material', 'account'));--> statement-breakpoint
ALTER TABLE "push_deliveries" DROP CONSTRAINT "push_deliveries_kind_check";--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_kind_check" CHECK ("push_deliveries"."kind" in ('lesson_reminder', 'schedule_changed', 'new_request', 'new_message', 'new_material', 'test', 'account'));
