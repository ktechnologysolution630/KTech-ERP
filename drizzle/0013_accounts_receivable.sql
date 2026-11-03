CREATE TABLE "ar_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"doc_date" date NOT NULL,
	"reason" text NOT NULL,
	"before_vat" numeric(16, 2) NOT NULL,
	"vat" numeric(16, 2) NOT NULL,
	"gross" numeric(16, 2) NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ar_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_price" numeric(16, 2) NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ar_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"customer_id" uuid NOT NULL,
	"project_id" uuid,
	"milestone_id" uuid,
	"doc_date" date NOT NULL,
	"due_date" date NOT NULL,
	"vat_mode" text DEFAULT 'INCLUSIVE' NOT NULL,
	"before_vat" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"vat" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"gross" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"retention_amount" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ar_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"receipt_date" date NOT NULL,
	"method" text DEFAULT 'TRANSFER' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"amount_received" numeric(16, 2) NOT NULL,
	"wht_amount" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"before_vat" numeric(16, 2) NOT NULL,
	"vat" numeric(16, 2) NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"branch" text DEFAULT '00000' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"credit_days" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_invoice_id_ar_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."ar_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_invoice_id_ar_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."ar_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_receipts" ADD CONSTRAINT "ar_receipts_invoice_id_ar_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."ar_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_receipts" ADD CONSTRAINT "ar_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ar_credit_notes_number_idx" ON "ar_credit_notes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "ar_credit_notes_invoice_idx" ON "ar_credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ar_invoices_number_idx" ON "ar_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "ar_invoices_customer_idx" ON "ar_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ar_invoices_milestone_idx" ON "ar_invoices" USING btree ("milestone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ar_receipts_number_idx" ON "ar_receipts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "ar_receipts_invoice_idx" ON "ar_receipts" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_idx" ON "customers" USING btree ("code");