ALTER TABLE "assets" ADD COLUMN "salvage_value" numeric(16, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "useful_life_years" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "retired_on" date;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "due_notified_for" text;--> statement-breakpoint
UPDATE "assets" SET "retired_on" = ("updated_at" AT TIME ZONE 'Asia/Bangkok')::date WHERE "status" = 'RETIRED';
