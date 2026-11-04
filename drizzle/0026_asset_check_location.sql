ALTER TABLE "asset_inspections" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "asset_inspections" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "asset_inspections" ADD COLUMN "location_accuracy_m" integer;