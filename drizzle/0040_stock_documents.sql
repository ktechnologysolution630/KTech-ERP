CREATE TABLE "stock_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"doc_date" date NOT NULL,
	"doc_time" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"target_project_id" uuid,
	"warehouse_name" text DEFAULT '' NOT NULL,
	"vendor_id" uuid,
	"supplier_name" text DEFAULT '' NOT NULL,
	"po_number" text DEFAULT '' NOT NULL,
	"delivery_note_no" text DEFAULT '' NOT NULL,
	"tax_invoice_no" text DEFAULT '' NOT NULL,
	"tax_invoice_date" date,
	"receiver_name" text DEFAULT '' NOT NULL,
	"inspector_name" text DEFAULT '' NOT NULL,
	"tax_type" text DEFAULT 'VAT7' NOT NULL,
	"accounting_method" text DEFAULT 'STOCK' NOT NULL,
	"accounting_status" text DEFAULT 'PENDING' NOT NULL,
	"debit_account" text DEFAULT 'Inventory' NOT NULL,
	"credit_account" text DEFAULT 'Trade Payables' NOT NULL,
	"pay_method" text DEFAULT 'CREDIT' NOT NULL,
	"credit_days" integer,
	"issue_kind" text,
	"use_project_id" uuid,
	"boq_category_id" uuid,
	"boq_line_id" uuid,
	"zone" text DEFAULT '' NOT NULL,
	"usage_note" text DEFAULT '' NOT NULL,
	"before_vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"performed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_docs_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "doc_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "list_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "discount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "vat" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "extra_cost" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_target_project_id_projects_id_fk" FOREIGN KEY ("target_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_use_project_id_projects_id_fk" FOREIGN KEY ("use_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_boq_category_id_boq_lines_id_fk" FOREIGN KEY ("boq_category_id") REFERENCES "public"."boq_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_boq_line_id_boq_lines_id_fk" FOREIGN KEY ("boq_line_id") REFERENCES "public"."boq_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_docs_project_idx" ON "stock_docs" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_doc_id_stock_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."stock_docs"("id") ON DELETE set null ON UPDATE no action;