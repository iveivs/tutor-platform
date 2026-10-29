-- A student's account can be run by a parent or a trusted adult: their name and relation to the child.
ALTER TABLE "members" ADD COLUMN "guardian_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "guardian_relation" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "guardian_relation_other" text;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_guardian_check" CHECK (
	("guardian_name" is null and "guardian_relation" is null and "guardian_relation_other" is null)
	or (char_length("guardian_name") between 1 and 80
		and "guardian_relation" in ('father', 'mother', 'grandfather', 'grandmother', 'uncle', 'aunt', 'brother', 'sister', 'guardian', 'nanny', 'other')
		and (("guardian_relation" = 'other') = ("guardian_relation_other" is not null))
		and ("guardian_relation_other" is null or char_length("guardian_relation_other") between 1 and 30)));
