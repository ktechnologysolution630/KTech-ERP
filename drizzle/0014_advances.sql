CREATE TABLE "advance_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advance_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"evidence" text DEFAULT 'RECEIPT' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"substitute_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"payee_id" uuid NOT NULL,
	"project_id" uuid,
	"request_date" date NOT NULL,
	"purpose" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"paid_at" date,
	"paid_by" uuid,
	"returned_amount" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_substitute_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"substitute_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"spent_on" date NOT NULL,
	"description" text NOT NULL,
	"paid_to" text DEFAULT '' NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_substitutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"payer_id" uuid NOT NULL,
	"project_id" uuid,
	"advance_id" uuid,
	"doc_date" date NOT NULL,
	"total" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"decided_by" uuid,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advance_expenses" ADD CONSTRAINT "advance_expenses_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_expenses" ADD CONSTRAINT "advance_expenses_substitute_id_receipt_substitutes_id_fk" FOREIGN KEY ("substitute_id") REFERENCES "public"."receipt_substitutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_expenses" ADD CONSTRAINT "advance_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_substitute_lines" ADD CONSTRAINT "receipt_substitute_lines_substitute_id_receipt_substitutes_id_fk" FOREIGN KEY ("substitute_id") REFERENCES "public"."receipt_substitutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_substitutes" ADD CONSTRAINT "receipt_substitutes_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_substitutes" ADD CONSTRAINT "receipt_substitutes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_substitutes" ADD CONSTRAINT "receipt_substitutes_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_substitutes" ADD CONSTRAINT "receipt_substitutes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advance_expenses_advance_idx" ON "advance_expenses" USING btree ("advance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advances_number_idx" ON "advances" USING btree ("number");--> statement-breakpoint
CREATE INDEX "advances_payee_idx" ON "advances" USING btree ("payee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_substitutes_number_idx" ON "receipt_substitutes" USING btree ("number");