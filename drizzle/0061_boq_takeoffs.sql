CREATE TABLE "boq_takeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"project_id" uuid,
	"file_name" text DEFAULT '' NOT NULL,
	"file_fingerprint" text DEFAULT '' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_boq_number" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boq_takeoffs" ADD CONSTRAINT "boq_takeoffs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_takeoffs" ADD CONSTRAINT "boq_takeoffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_takeoffs" ADD CONSTRAINT "boq_takeoffs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boq_takeoffs_project_idx" ON "boq_takeoffs" USING btree ("project_id");