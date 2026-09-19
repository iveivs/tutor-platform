CREATE UNIQUE INDEX `lessons_series_start_unique` ON `lessons` (`series_id`,`starts_at`) WHERE `status` <> 'cancelled';
