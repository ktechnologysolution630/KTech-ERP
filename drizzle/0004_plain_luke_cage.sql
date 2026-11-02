CREATE TABLE "invoice_payable_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payable_id" uuid NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date NOT NULL,
	"is_tax_invoice" boolean DEFAULT true NOT NULL,
	"before_vat" numeric(14, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"po_id" uuid,
	"vendor_id" uuid NOT NULL,
	"invoice_id" uuid,
	"installment_id" uuid,
	"before_vat" numeric(14, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"requested_by" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pv_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pv_id" uuid NOT NULL,
	"payable_id" uuid NOT NULL,
	"before_vat" numeric(14, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"wht_rate" integer DEFAULT 0 NOT NULL,
	"wht" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pvs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"reject_reason" text,
	"override_reason" text,
	"paid_at" date,
	"pay_method" text,
	"pay_from_account" text,
	"pay_ref" text,
	"paid_by" uuid,
	"before_vat" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"vat" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"gross" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"wht" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"net" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"wht_cert_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wht_certs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"pv_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"form_type" text NOT NULL,
	"paid_at" date NOT NULL,
	"income_type" text DEFAULT 'ค่าจ้างทำของ/ค่าบริการ' NOT NULL,
	"basis" numeric(14, 2) NOT NULL,
	"wht" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_payable_matches" ADD CONSTRAINT "invoice_payable_matches_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payable_matches" ADD CONSTRAINT "invoice_payable_matches_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_po_id_pos_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."pos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_po_id_pos_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."pos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_installment_id_po_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."po_installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_lines" ADD CONSTRAINT "pv_lines_pv_id_pvs_id_fk" FOREIGN KEY ("pv_id") REFERENCES "public"."pvs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_lines" ADD CONSTRAINT "pv_lines_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvs" ADD CONSTRAINT "pvs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvs" ADD CONSTRAINT "pvs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvs" ADD CONSTRAINT "pvs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvs" ADD CONSTRAINT "pvs_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wht_certs" ADD CONSTRAINT "wht_certs_pv_id_pvs_id_fk" FOREIGN KEY ("pv_id") REFERENCES "public"."pvs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wht_certs" ADD CONSTRAINT "wht_certs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pvs_number_idx" ON "pvs" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "wht_certs_number_idx" ON "wht_certs" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "wht_certs_pv_idx" ON "wht_certs" USING btree ("pv_id");