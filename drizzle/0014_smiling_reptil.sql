ALTER TABLE `members` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `members` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `members` ADD `is_trial_contact` integer DEFAULT false NOT NULL;