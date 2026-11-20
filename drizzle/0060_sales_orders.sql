ALTER TABLE "sales_doc_lines" ADD COLUMN "discount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_doc_lines" ADD COLUMN "stock_item_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_doc_lines" ADD CONSTRAINT "sales_doc_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_source_id_sales_docs_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sales_docs"("id") ON DELETE set null ON UPDATE no action;