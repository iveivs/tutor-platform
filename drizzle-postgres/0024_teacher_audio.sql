-- MP3 audio (for example backing tracks) in the teacher's library.
ALTER TABLE "teacher_resources" DROP CONSTRAINT "teacher_resources_content_type_check";--> statement-breakpoint
ALTER TABLE "teacher_resources" ADD CONSTRAINT "teacher_resources_content_type_check" CHECK ("teacher_resources"."content_type" in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/webp', 'audio/mpeg'));
