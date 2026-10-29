-- «Бессрочный» access: assigned only by the platform admin (owner and invited testers), never sold
-- and never ends, so such a workspace cannot have an end date.
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_access_grant_check";--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_access_grant_check" CHECK ("workspaces"."access_grant" in ('legacy', 'complimentary', 'trial', 'paid', 'unlimited'));--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_unlimited_no_end_check" CHECK ("workspaces"."access_grant" <> 'unlimited' or "workspaces"."access_expires_at" is null);--> statement-breakpoint
ALTER TABLE "teacher_invitations" DROP CONSTRAINT "teacher_invitations_access_grant_check";--> statement-breakpoint
ALTER TABLE "teacher_invitations" ADD CONSTRAINT "teacher_invitations_access_grant_check" CHECK ("teacher_invitations"."access_grant" in ('complimentary', 'trial', 'paid', 'unlimited'));
