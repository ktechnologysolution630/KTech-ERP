ALTER TABLE "variation_orders" ADD COLUMN "vo_type" text DEFAULT 'ADD' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "requester_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "responsible_user_id" uuid;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "work_area" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "priority" text DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "change_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "original_amount" numeric(16, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "vat_percent" numeric(5, 2) DEFAULT '7.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "cost_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "cost_category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "cost_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "schedule_impact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "days_added" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "days_reduced" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "impact_start_date" date;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "impact_end_date" date;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "critical_path" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "affected_task_id" uuid;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD COLUMN "time_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_affected_task_id_project_tasks_id_fk" FOREIGN KEY ("affected_task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- add_amount used to hold the VO BOQ grand total incl. VAT; it is now the before-VAT amount
UPDATE "variation_orders" vo SET "add_amount" = b."grand_total" - round(b."grand_total" * b."vat_percent" / (100 + b."vat_percent"), 2), "vat_percent" = b."vat_percent" FROM "boqs" b WHERE b."vo_id" = vo."id";--> statement-breakpoint
UPDATE "variation_orders" SET "vo_type" = CASE WHEN "add_amount" > 0 AND "deduct_amount" > 0 THEN 'ADD_DEDUCT' WHEN "deduct_amount" > 0 THEN 'DEDUCT' ELSE 'ADD' END;--> statement-breakpoint
UPDATE "variation_orders" SET "schedule_impact" = true, "days_added" = greatest("days_impact", 0), "days_reduced" = greatest(-"days_impact", 0) WHERE "days_impact" <> 0;
