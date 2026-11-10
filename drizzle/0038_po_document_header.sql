ALTER TABLE "po_lines" ADD COLUMN "detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "doc_date" date;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "department" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "requester_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "payment_terms" text DEFAULT '' NOT NULL;