CREATE TABLE "boq_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boq_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"is_category" boolean DEFAULT false NOT NULL,
	"is_bold" boolean DEFAULT false NOT NULL,
	"no" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3),
	"unit" text DEFAULT '' NOT NULL,
	"material_rate" numeric(14, 2),
	"labor_rate" numeric(14, 2),
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text DEFAULT 'MAIN' NOT NULL,
	"number" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"estimate_date" date,
	"project_title" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"work_detail" text DEFAULT '' NOT NULL,
	"estimator" text DEFAULT '' NOT NULL,
	"overhead_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"vat_percent" numeric(5, 2) DEFAULT '7.00' NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"material_total" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"labor_total" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"grand_total" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_boq_id_boqs_id_fk" FOREIGN KEY ("boq_id") REFERENCES "public"."boqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boq_lines_boq_sort_idx" ON "boq_lines" USING btree ("boq_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "boqs_number_idx" ON "boqs" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "boqs_project_main_idx" ON "boqs" USING btree ("project_id") WHERE "boqs"."kind" = 'MAIN';