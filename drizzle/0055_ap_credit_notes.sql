CREATE TABLE "ap_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"doc_date" date NOT NULL,
	"vendor_doc_no" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"before_vat" numeric(14, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"payable_id" uuid,
	"voided" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ap_credit_notes" ADD CONSTRAINT "ap_credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_credit_notes" ADD CONSTRAINT "ap_credit_notes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_credit_notes" ADD CONSTRAINT "ap_credit_notes_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_credit_notes" ADD CONSTRAINT "ap_credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ap_credit_notes_number_idx" ON "ap_credit_notes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "ap_credit_notes_invoice_idx" ON "ap_credit_notes" USING btree ("invoice_id");