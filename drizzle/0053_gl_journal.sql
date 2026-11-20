CREATE TABLE "gl_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"entry_date" date NOT NULL,
	"book" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"source_number" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"party_name" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(16, 2) DEFAULT '0' NOT NULL,
	"memo" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_code_idx" ON "gl_accounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_system_key_idx" ON "gl_accounts" USING btree ("system_key");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_number_idx" ON "journal_entries" USING btree ("number");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");
--> statement-breakpoint
INSERT INTO "gl_accounts" ("code", "name", "type", "system_key", "sort") VALUES
('1110', 'เงินสด', 'ASSET', 'CASH', 0),
('1120', 'เงินฝากธนาคาร', 'ASSET', 'BANK', 10),
('1130', 'ลูกหนี้การค้า', 'ASSET', 'AR', 20),
('1135', 'ลูกหนี้เงินประกันผลงาน', 'ASSET', 'RETENTION_AR', 30),
('1140', 'ภาษีซื้อ', 'ASSET', 'VAT_INPUT', 40),
('1141', 'ภาษีซื้อยังไม่ถึงกำหนด', 'ASSET', 'VAT_INPUT_UNDUE', 50),
('1145', 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย', 'ASSET', 'WHT_RECEIVABLE', 60),
('1150', 'สินค้าคงเหลือ', 'ASSET', 'INVENTORY', 70),
('1160', 'เงินจ่ายล่วงหน้า', 'ASSET', NULL, 80),
('1210', 'อุปกรณ์และเครื่องมือ', 'ASSET', NULL, 90),
('2110', 'เจ้าหนี้การค้า', 'LIABILITY', 'AP', 100),
('2120', 'ภาษีขาย', 'LIABILITY', 'VAT_OUTPUT', 110),
('2121', 'ภาษีขายยังไม่ถึงกำหนด', 'LIABILITY', 'VAT_OUTPUT_UNDUE', 120),
('2130', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', 'LIABILITY', 'WHT_PAYABLE', 130),
('2140', 'ค่าใช้จ่ายค้างจ่าย', 'LIABILITY', NULL, 140),
('3100', 'ทุนจดทะเบียน', 'EQUITY', NULL, 150),
('3200', 'กำไร(ขาดทุน)สะสม', 'EQUITY', NULL, 160),
('4100', 'รายได้จากการขาย/บริการ', 'INCOME', 'SALES', 170),
('4110', 'รับคืนสินค้า/ส่วนลดจ่าย', 'INCOME', 'SALES_RETURN', 180),
('4900', 'รายได้อื่น', 'INCOME', 'OTHER_INCOME', 190),
('5100', 'ซื้อสินค้า/ต้นทุนวัสดุ', 'EXPENSE', 'PURCHASE', 200),
('5110', 'ต้นทุนขาย', 'EXPENSE', 'COGS', 210),
('5200', 'ค่าแรงและผู้รับเหมาช่วง', 'EXPENSE', 'LABOR_COST', 220),
('5300', 'ค่าใช้จ่ายทั่วไป', 'EXPENSE', 'EXPENSE', 230),
('5310', 'กำไร(ขาดทุน)จากการปรับปรุงสต็อก', 'EXPENSE', 'STOCK_ADJUST', 240)
ON CONFLICT DO NOTHING;
