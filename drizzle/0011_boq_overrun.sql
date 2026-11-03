CREATE TABLE "boq_overrun_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"po_revision" integer NOT NULL,
	"over_amount" numeric(16, 2) NOT NULL,
	"lines" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "boq_line_id" uuid;--> statement-breakpoint
ALTER TABLE "boq_overrun_requests" ADD CONSTRAINT "boq_overrun_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_overrun_requests" ADD CONSTRAINT "boq_overrun_requests_po_id_pos_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."pos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_overrun_requests" ADD CONSTRAINT "boq_overrun_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_overrun_requests" ADD CONSTRAINT "boq_overrun_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boq_overrun_number_idx" ON "boq_overrun_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "boq_overrun_po_idx" ON "boq_overrun_requests" USING btree ("po_id");--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_boq_line_id_boq_lines_id_fk" FOREIGN KEY ("boq_line_id") REFERENCES "public"."boq_lines"("id") ON DELETE no action ON UPDATE no action;