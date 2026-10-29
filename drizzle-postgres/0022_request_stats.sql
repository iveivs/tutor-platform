-- Hourly request counters written by the app (no URLs with ids, no users): requests, errors,
-- response-time buckets, bytes sent and the peak of open live connections. Kept 90 days.
CREATE TABLE "platform_request_stats" (
	"hour" timestamp (3) with time zone NOT NULL,
	"kind" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"total_ms" bigint DEFAULT 0 NOT NULL,
	"buckets" integer[] DEFAULT '{0,0,0,0,0}' NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"peak_open" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "platform_request_stats_pk" PRIMARY KEY ("hour", "kind"),
	CONSTRAINT "platform_request_stats_kind_check" CHECK ("platform_request_stats"."kind" in ('page', 'api', 'file', 'realtime'))
);
--> statement-breakpoint
-- When each kind of admin alert was last sent, so a problem is reported at most every few hours.
CREATE TABLE "platform_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp (3) with time zone NOT NULL
);
