ALTER TABLE "vendors" ADD COLUMN "billing_schedule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "credit_basis" text DEFAULT 'BILLING' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "cheque_schedule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "default_pay_method" text DEFAULT 'TRANSFER' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "billing_schedule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "credit_basis" text DEFAULT 'INVOICE' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "cheque_schedule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos" ADD COLUMN "pay_method" text DEFAULT 'TRANSFER' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billing_date" date;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_no" text;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_bank" text;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_date" date;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_status" text;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_collected_by" text;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_collected_at" date;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_cleared_at" date;--> statement-breakpoint
ALTER TABLE "pvs" ADD COLUMN "cheque_void_reason" text;