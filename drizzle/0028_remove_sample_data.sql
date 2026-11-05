-- Removes the sample records the seed used to create on every new database.
-- Each row must match what the seed wrote and have nothing added to it; anything people have used stays,
-- and can be removed from the project's settings if it is not wanted.
DELETE FROM "prvs" AS r
WHERE r."prv_number" = 'PRV-2611-0001'
  AND r."status" = 'PM_VERIFIED'
  AND r."pv_id" IS NULL
  AND r."notes" = 'ขอเบิกงวดที่ 1 ผลงานเทเสาเข็มและคานคอดินอาคารสำนักงานแล้วเสร็จ 100%'
  AND NOT EXISTS (SELECT 1 FROM "attachments" a WHERE a."entity_id" = r."id")
  AND NOT EXISTS (SELECT 1 FROM "comments" c WHERE c."entity_id" = r."id");
--> statement-breakpoint
DELETE FROM "stock_balances" AS b
USING "stock_items" i, "projects" p
WHERE b."stock_item_id" = i."id"
  AND b."project_id" = p."id"
  AND p."code" = 'K69-001'
  AND p."name" = 'โครงการก่อสร้างอาคารสำนักงานใหญ่ K-Tec (พระราม 9)'
  AND (i."sku", i."name") IN (
    ('MAT-6901', 'ปูนซีเมนต์ปอร์ตแลนด์ ตราช้าง (ถุง 50 กก.)'),
    ('MAT-6902', 'เหล็กข้ออ้อย DB16 SD40 (ยาว 10 ม.)'),
    ('MAT-6903', 'อิฐมวลเบา Q-CON ขนาด 7.5 ซม.'),
    ('MAT-6904', 'แผ่นตัดเหล็ก 14 นิ้ว (ดูโฮม Code: 10389197)'),
    ('MAT-6905', 'ถุงขยะดำ ขนาด 30x40 นิ้ว (ดูโฮม Code: 10418187)')
  )
  AND b."warehouse_name" = 'คลังหน้างาน พระราม 9'
  AND b."location" = 'โซนจัดเก็บ A1'
  AND b."allocated_qty" = 0
  AND b."quantity" = CASE WHEN i."sku" = 'MAT-6902' THEN 25 ELSE 150 END
  AND NOT EXISTS (
    SELECT 1 FROM "stock_movements" m
    WHERE m."stock_item_id" = i."id" AND m."movement_number" <> 'SM-2611-' || right(i."sku", 4)
  )
  AND NOT EXISTS (SELECT 1 FROM "stock_adjust_requests" q WHERE q."stock_item_id" = i."id");
--> statement-breakpoint
DELETE FROM "stock_movements" AS m
USING "stock_items" i, "projects" p
WHERE m."stock_item_id" = i."id"
  AND m."project_id" = p."id"
  AND p."code" = 'K69-001'
  AND p."name" = 'โครงการก่อสร้างอาคารสำนักงานใหญ่ K-Tec (พระราม 9)'
  AND (i."sku", i."name") IN (
    ('MAT-6901', 'ปูนซีเมนต์ปอร์ตแลนด์ ตราช้าง (ถุง 50 กก.)'),
    ('MAT-6902', 'เหล็กข้ออ้อย DB16 SD40 (ยาว 10 ม.)'),
    ('MAT-6903', 'อิฐมวลเบา Q-CON ขนาด 7.5 ซม.'),
    ('MAT-6904', 'แผ่นตัดเหล็ก 14 นิ้ว (ดูโฮม Code: 10389197)'),
    ('MAT-6905', 'ถุงขยะดำ ขนาด 30x40 นิ้ว (ดูโฮม Code: 10418187)')
  )
  AND m."movement_number" = 'SM-2611-' || right(i."sku", 4)
  AND m."type" = 'RECEIVE'
  AND m."reference_type" = 'MANUAL'
  AND m."notes" = 'ยอดยกมาเริ่มต้นคลังสินค้า'
  AND NOT EXISTS (SELECT 1 FROM "stock_balances" b WHERE b."stock_item_id" = i."id");
--> statement-breakpoint
DELETE FROM "stock_items" AS i
WHERE (i."sku", i."name") IN (
    ('MAT-6901', 'ปูนซีเมนต์ปอร์ตแลนด์ ตราช้าง (ถุง 50 กก.)'),
    ('MAT-6902', 'เหล็กข้ออ้อย DB16 SD40 (ยาว 10 ม.)'),
    ('MAT-6903', 'อิฐมวลเบา Q-CON ขนาด 7.5 ซม.'),
    ('MAT-6904', 'แผ่นตัดเหล็ก 14 นิ้ว (ดูโฮม Code: 10389197)'),
    ('MAT-6905', 'ถุงขยะดำ ขนาด 30x40 นิ้ว (ดูโฮม Code: 10418187)')
  )
  AND NOT EXISTS (SELECT 1 FROM "stock_balances" b WHERE b."stock_item_id" = i."id")
  AND NOT EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."stock_item_id" = i."id")
  AND NOT EXISTS (SELECT 1 FROM "stock_adjust_requests" q WHERE q."stock_item_id" = i."id");
--> statement-breakpoint
DELETE FROM "vendors" AS v
WHERE v."code" = 'CONT-0001'
  AND v."name" = 'หจก. ช่างวิเชียร งานก่อสร้าง (ผู้รับเหมาฐานราก)'
  AND coalesce(v."tax_id", '') = ''
  AND v."bank_account_no" = ''
  AND NOT EXISTS (SELECT 1 FROM "prvs" x WHERE x."vendor_id" = v."id")
  AND NOT EXISTS (SELECT 1 FROM "pos" x WHERE x."vendor_id" = v."id")
  AND NOT EXISTS (SELECT 1 FROM "invoices" x WHERE x."vendor_id" = v."id")
  AND NOT EXISTS (SELECT 1 FROM "payables" x WHERE x."vendor_id" = v."id")
  AND NOT EXISTS (SELECT 1 FROM "pvs" x WHERE x."vendor_id" = v."id")
  AND NOT EXISTS (SELECT 1 FROM "wht_certs" x WHERE x."vendor_id" = v."id")
  AND NOT EXISTS (SELECT 1 FROM "milestones" x WHERE x."vendor_id" = v."id");
--> statement-breakpoint
DELETE FROM "projects" AS p
WHERE p."code" = 'K69-001'
  AND p."name" = 'โครงการก่อสร้างอาคารสำนักงานใหญ่ K-Tec (พระราม 9)'
  AND NOT EXISTS (SELECT 1 FROM "boqs" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "variation_orders" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "project_tasks" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "milestones" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "daily_reports" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "project_events" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "project_handovers" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "warranty_defects" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "stock_balances" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "stock_movements" x WHERE x."project_id" = p."id" OR x."target_project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "stock_adjust_requests" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "prs" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "pos" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "payables" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "prvs" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "boq_overrun_requests" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "ar_invoices" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "advances" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "receipt_substitutes" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "assets" x WHERE x."project_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "attachments" x WHERE x."entity_id" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "comments" x WHERE x."entity_id" = p."id");
