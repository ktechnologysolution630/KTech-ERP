ALTER TABLE "customers" ADD COLUMN "credit_limit" numeric(16, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "salesperson_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;