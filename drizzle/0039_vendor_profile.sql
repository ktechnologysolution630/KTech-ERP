ALTER TABLE "vendors" ADD COLUMN "trade_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "website" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "line_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "remark" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "building" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "moo" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "soi" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "road" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "subdistrict" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "district" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "province" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "postcode" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "country" text DEFAULT 'ไทย' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "contacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "branch_type" text DEFAULT 'HQ' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "vat_registered" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "default_vat_rate" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "wht_income_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "tax_invoice_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "product_category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "brand" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "min_order_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "min_order_value" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "default_discount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "currency" text DEFAULT 'THB' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "vat_mode" text DEFAULT 'EXCLUSIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "delivery_terms" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "service_area" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "recommended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "payment_terms" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "credit_limit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "deposit_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "deposit_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "bank_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "vendors" SET "status" = 'INACTIVE' WHERE "active" = false;--> statement-breakpoint
UPDATE "vendors" SET "bank_accounts" = jsonb_build_array(jsonb_build_object('bank', "bank_name", 'branch', '', 'accountName', "bank_account_name", 'accountNo', "bank_account_no", 'accountType', '', 'promptPay', '', 'primary', true)) WHERE "bank_account_no" <> '';--> statement-breakpoint
UPDATE "vendors" SET "contacts" = jsonb_build_array(jsonb_build_object('kind', '', 'name', "contact_person", 'position', '', 'department', '', 'phone', "phone", 'mobile', '', 'email', "email", 'lineId', '', 'primary', true, 'receivesPo', true, 'receivesAccounting', false)) WHERE "contact_person" <> '' OR "phone" <> '' OR "email" <> '';
