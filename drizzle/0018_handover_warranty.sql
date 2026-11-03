CREATE TABLE "project_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"handover_date" date NOT NULL,
	"received_by" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"warranty_number" text,
	"warranty_months" integer DEFAULT 12 NOT NULL,
	"structural_warranty_months" integer DEFAULT 60 NOT NULL,
	"accepted_at" timestamp with time zone,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warranty_defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"reported_date" date NOT NULL,
	"reported_by" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"fixed_date" date,
	"resolution" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_handovers" ADD CONSTRAINT "project_handovers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handovers" ADD CONSTRAINT "project_handovers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_defects" ADD CONSTRAINT "warranty_defects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_defects" ADD CONSTRAINT "warranty_defects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_handovers_project_idx" ON "project_handovers" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_handovers_warranty_number_idx" ON "project_handovers" USING btree ("warranty_number");--> statement-breakpoint
CREATE UNIQUE INDEX "warranty_defects_number_idx" ON "warranty_defects" USING btree ("number");--> statement-breakpoint
CREATE INDEX "warranty_defects_project_idx" ON "warranty_defects" USING btree ("project_id","status");