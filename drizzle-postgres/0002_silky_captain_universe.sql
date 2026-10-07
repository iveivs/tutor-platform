CREATE TABLE "legal_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"member_id" text,
	"document_type" text NOT NULL,
	"document_version" text NOT NULL,
	"source" text NOT NULL,
	"subject_context" text,
	"user_agent" text,
	"accepted_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptances_document_type_check" CHECK ("legal_acceptances"."document_type" in ('terms', 'personal_data_consent', 'content_rules', 'parental_consent')),
	CONSTRAINT "legal_acceptances_source_check" CHECK ("legal_acceptances"."source" in ('teacher_invite', 'student_invite')),
	CONSTRAINT "legal_acceptances_subject_context_check" CHECK ("legal_acceptances"."subject_context" is null or "legal_acceptances"."subject_context" in ('adult', 'legal_representative'))
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_legal_acceptances_user_accepted" ON "legal_acceptances" USING btree ("user_id","accepted_at");--> statement-breakpoint
CREATE INDEX "idx_legal_acceptances_member_accepted" ON "legal_acceptances" USING btree ("member_id","accepted_at");