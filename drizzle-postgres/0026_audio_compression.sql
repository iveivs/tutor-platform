-- When the worker checked an MP3 for re-encoding (a too-high bitrate is reduced to save space).
ALTER TABLE "teacher_resources" ADD COLUMN "audio_checked_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "lesson_files" ADD COLUMN "audio_checked_at" timestamp (3) with time zone;
