ALTER TABLE "pr_lines" ADD COLUMN "line_kind" text DEFAULT 'GOODS' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "pr_type" text DEFAULT 'GOODS' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "work_end" date;