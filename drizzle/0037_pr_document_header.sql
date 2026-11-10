ALTER TABLE "pr_lines" ADD COLUMN "discount" numeric(14, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_lines" ADD COLUMN "detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "doc_date" date;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "need_by" date;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "department" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "requester_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "delivery_place" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "payment_terms" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "vat_mode" text DEFAULT 'EXCLUSIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD COLUMN "bill_discount" numeric(14, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "prs" ADD CONSTRAINT "prs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;