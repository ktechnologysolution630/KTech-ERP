CREATE TABLE "sales_doc_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"is_section" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"doc_date" date NOT NULL,
	"due_date" date,
	"reference" text DEFAULT '' NOT NULL,
	"customer_id" uuid,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_tax_id" text DEFAULT '' NOT NULL,
	"customer_branch" text DEFAULT '' NOT NULL,
	"customer_address" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"milestone" text DEFAULT '' NOT NULL,
	"account_category" text DEFAULT '' NOT NULL,
	"vat_mode" text DEFAULT 'EXCLUSIVE' NOT NULL,
	"discount_type" text DEFAULT 'AMOUNT' NOT NULL,
	"discount_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"wht_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"pay_method" text,
	"bank" text DEFAULT '' NOT NULL,
	"bank_branch" text DEFAULT '' NOT NULL,
	"account_name" text DEFAULT '' NOT NULL,
	"account_no" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"before_vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"wht" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_docs_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "sales_doc_lines" ADD CONSTRAINT "sales_doc_lines_doc_id_sales_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."sales_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_docs_kind_idx" ON "sales_docs" USING btree ("kind","doc_date");