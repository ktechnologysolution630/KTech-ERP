CREATE TABLE "company_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank" text NOT NULL,
	"account_name" text NOT NULL,
	"account_no" text NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'SAVINGS' NOT NULL,
	"currency" text DEFAULT 'THB' NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"opening_date" date,
	"owner_name" text DEFAULT '' NOT NULL,
	"is_default_receive" boolean DEFAULT false NOT NULL,
	"is_default_pay" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_docs" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD COLUMN "retention_rate" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD COLUMN "retention" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_account_id_company_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."company_accounts"("id") ON DELETE set null ON UPDATE no action;