CREATE TABLE "asset_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"inspected_on" date NOT NULL,
	"result" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"inspected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"serial_no" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"custodian" text DEFAULT '' NOT NULL,
	"purchase_date" date,
	"purchase_value" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"inspect_every_days" integer DEFAULT 90 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_inspections" ADD CONSTRAINT "asset_inspections_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_inspections" ADD CONSTRAINT "asset_inspections_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_inspections_asset_idx" ON "asset_inspections" USING btree ("asset_id","inspected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_code_idx" ON "assets" USING btree ("code");--> statement-breakpoint
CREATE INDEX "assets_project_idx" ON "assets" USING btree ("project_id");