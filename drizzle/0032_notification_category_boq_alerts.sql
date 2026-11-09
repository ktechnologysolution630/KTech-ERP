ALTER TABLE "notifications" ADD COLUMN "category" text DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "level" text DEFAULT 'INFO' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD COLUMN "usage_alert_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;