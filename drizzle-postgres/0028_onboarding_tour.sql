-- When the member finished or skipped the first-sign-in tour; null shows the tour once.
ALTER TABLE "members" ADD COLUMN "onboarding_seen_at" timestamp (3) with time zone;--> statement-breakpoint
-- People who already use the app are not interrupted; they can replay the tour from Settings.
UPDATE "members" SET "onboarding_seen_at" = now();
