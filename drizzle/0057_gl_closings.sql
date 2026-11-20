CREATE TABLE "gl_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closed_through" date NOT NULL,
	"kind" text NOT NULL,
	"year_close_entry_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopen_reason" text
);
--> statement-breakpoint
ALTER TABLE "gl_closings" ADD CONSTRAINT "gl_closings_year_close_entry_id_journal_entries_id_fk" FOREIGN KEY ("year_close_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_closings" ADD CONSTRAINT "gl_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_closings" ADD CONSTRAINT "gl_closings_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gl_closings_through_idx" ON "gl_closings" USING btree ("closed_through");--> statement-breakpoint
-- The year-end closing posts profit to retained earnings: mark 3200 for it unless another account already is
UPDATE "gl_accounts" SET "system_key" = 'RETAINED_EARNINGS', "updated_at" = now()
WHERE "code" = '3200' AND "system_key" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "gl_accounts" WHERE "system_key" = 'RETAINED_EARNINGS');
