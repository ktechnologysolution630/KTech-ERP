ALTER TABLE "pos" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos" ADD CONSTRAINT "pos_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;