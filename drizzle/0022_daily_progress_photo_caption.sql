ALTER TABLE "attachments" ADD COLUMN "caption" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "progress" jsonb DEFAULT '[]'::jsonb NOT NULL;