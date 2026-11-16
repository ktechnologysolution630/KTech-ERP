ALTER TABLE "projects" ADD COLUMN "boq_usage_alert_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_lines" ADD COLUMN "boq_line_id" uuid;--> statement-breakpoint
ALTER TABLE "pr_lines" ADD COLUMN "outside_boq" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "pm_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "pm_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_lines" ADD CONSTRAINT "pr_lines_boq_line_id_boq_lines_id_fk" FOREIGN KEY ("boq_line_id") REFERENCES "public"."boq_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prs" ADD CONSTRAINT "prs_pm_approved_by_users_id_fk" FOREIGN KEY ("pm_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The per-line level used to track money sent to the owner and PM; it now tracks the quantity asked for on PRs
UPDATE "boq_lines" SET "usage_alert_level" = 0;