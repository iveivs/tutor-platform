-- Optional lesson prices per student, in minor units (kopecks, cents). NULL means "not set";
-- for trial lessons NULL means free. The currency is a free label shown next to amounts.
ALTER TABLE "members" ADD COLUMN "lesson_price_cents" integer;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "double_lesson_price_cents" integer;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "trial_lesson_price_cents" integer;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "price_currency" text;
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_lesson_prices_check" CHECK (
  ("lesson_price_cents" IS NULL OR "lesson_price_cents" BETWEEN 0 AND 100000000)
  AND ("double_lesson_price_cents" IS NULL OR "double_lesson_price_cents" BETWEEN 0 AND 100000000)
  AND ("trial_lesson_price_cents" IS NULL OR "trial_lesson_price_cents" BETWEEN 0 AND 100000000)
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_price_currency_check" CHECK ("price_currency" IS NULL OR char_length("price_currency") BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_amount_check" CHECK ("amount_cents" IS NULL OR "amount_cents" BETWEEN 0 AND 1000000000);
