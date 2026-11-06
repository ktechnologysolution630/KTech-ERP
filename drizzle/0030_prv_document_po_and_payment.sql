ALTER TABLE "prv_items" ADD COLUMN "document_no" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prv_items" ADD COLUMN "po_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prvs" ADD COLUMN "pay_method" text;--> statement-breakpoint
ALTER TABLE "prvs" ADD COLUMN "pay_bank" text;