CREATE TABLE "variation_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"request_date" date NOT NULL,
	"add_amount" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"deduct_amount" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"deduct_note" text DEFAULT '' NOT NULL,
	"days_impact" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"requested_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boqs" ADD COLUMN "vo_id" uuid;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "variation_orders_number_idx" ON "variation_orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "variation_orders_project_idx" ON "variation_orders" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_vo_id_variation_orders_id_fk" FOREIGN KEY ("vo_id") REFERENCES "public"."variation_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boqs_vo_idx" ON "boqs" USING btree ("vo_id") WHERE "boqs"."vo_id" IS NOT NULL;