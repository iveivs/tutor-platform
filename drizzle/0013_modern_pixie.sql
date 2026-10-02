ALTER TABLE `lessons` ADD COLUMN `lesson_type` text DEFAULT 'regular' NOT NULL CHECK (`lesson_type` in ('regular', 'trial'));
