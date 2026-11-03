CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"seq" integer NOT NULL,
	"title" text NOT NULL,
	"completion_criteria" text DEFAULT '' NOT NULL,
	"vendor_id" uuid,
	"planned_date" date,
	"amount" numeric(16, 2) NOT NULL,
	"retention_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"retention_amount" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"claimed_at" date,
	"approved_at" date,
	"paid_at" date,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_project_kind_seq_idx" ON "milestones" USING btree ("project_id","kind","seq");