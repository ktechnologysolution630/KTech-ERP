ALTER TABLE "variation_orders" ADD COLUMN "affected_activity" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "variation_orders" v SET "affected_activity" = t."title" FROM "project_tasks" t WHERE v."affected_task_id" = t."id";
