ALTER TABLE "payables" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payables_project_idx" ON "payables" USING btree ("project_id");--> statement-breakpoint
UPDATE "payables" p SET "project_id" = po."project_id" FROM "pos" po WHERE p."po_id" = po."id" AND p."project_id" IS NULL;--> statement-breakpoint
UPDATE "payables" p SET "project_id" = r."project_id" FROM "prvs" r WHERE p."po_id" IS NULL AND p."project_id" IS NULL AND (p."note" = r."prv_number" OR p."note" LIKE r."prv_number" || ' %');
