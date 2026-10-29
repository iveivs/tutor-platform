-- Anonymized platform statistics for the admin: numbers only, no names, texts or file names.
-- One row per Moscow day (kept forever) and one per hour of host load (kept 90 days).
CREATE TABLE "platform_daily_stats" (
	"day" date PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_hourly_load" (
	"hour" timestamp (3) with time zone PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
-- Admin-entered cost rates for the «Экономика» block (server price, storage and traffic rates, plan prices).
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
