# K Tec ERP — ระบบจัดซื้อและการเงินก่อสร้าง (Phase 1: Procurement)

ระบบเว็บแอปพลิเคชันสำหรับบริหารงานจัดซื้อ รับของหน้างาน ตั้งหนี้ และทำใบสำคัญจ่าย (PR → PO → Goods Receipt → Invoice/Payable → PV → Payment + 50 ทวิ & Export บัญชี) สำหรับบริษัทรับเหมาก่อสร้าง

## ฟีเจอร์หลัก (Phase 1)
- **ใบขอซื้อ (PR)**: หน้างาน/วิศวกรเปิดใบขอซื้อ → PM โครงการตรวจสอบและอนุมัติ → ติดตามยอดสั่งซื้อสะสมแยกตามบรรทัด
- **ใบสั่งซื้อ (PO)**: รองรับ 3 เงื่อนไขการชำระเงิน (`CREDIT`, `PREPAID`, `INSTALLMENT`), คำนวณ VAT (`EXCLUSIVE`, `INCLUSIVE`, `NONE`), ระบบแก้ไข PO (Revision) และการขอปิดยอดค้างรับ (Close-short)
- **สายอนุมัติ PO อัตโนมัติ**: ยอดต่ำกว่าวงเงิน (`poApprovalLimit`, เริ่มต้น 50,000 บาท) อนุมัติโดยหัวหน้าจัดซื้อหรือเจ้าของ (ห้ามอนุมัติใบที่ตนเองเปิด ยกเว้นเจ้าของ); ยอดตั้งแต่วงเงินขึ้นไปอนุมัติโดยเจ้าของเท่านั้น
- **รับของหน้างาน (Mobile Goods Receipt)**: หน้าจอมือถือสำหรับ Foreman กดรับของตาม PO (รับบางส่วนได้, รองรับทศนิยม 3 ตำแหน่ง, ย่อรูปใบส่งของ/รูปหน้างานอัตโนมัติ)
- **ใบแจ้งหนี้ / ตั้งหนี้ / ใบกำกับภาษี**: บันทึกใบวางบิลเครดิต (คำนวณวันครบกำหนดอัตโนมัติ), ขอเบิกเงินล่วงหน้า/ขอเบิกตามงวด, จับคู่ใบกำกับภาษีตามหลังโดยไม่นับยอดหนี้ซ้ำ
- **ใบสำคัญจ่าย (PV) & การจ่ายเงิน**: คำนวณภาษีหัก ณ ที่จ่าย (1%, 2%, 3%, 5%) จากฐานก่อน VAT, ระบบป้องกันจ่ายเกินยอด PO (Overpay Guard พร้อมบันทึกเหตุผลเมื่อเจ้าของอนุมัติเกินวงเงิน)
- **สำนักงานบัญชี Outsource**: พิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ — ภ.ง.ด.3 / ภ.ง.ด.53) และส่งออกไฟล์ Excel รายเดือน (`pv-paid`, `purchase-vat`, `wht`)
- **PDF ภาษาไทย**: พิมพ์ใบขอซื้อ (PR), ใบสั่งซื้อ (PO), ใบสำคัญจ่าย (PV), และ 50 ทวิ ด้วยฟอนต์ตระกูลสารบรรณ (Sarabun) พร้อมจำนวนเงินตัวอักษรไทย (`bahtText`) และลายน้ำ `ร่าง`

---

## การติดตั้งและรันในเครื่อง (Local Development)

1. **ติดตั้ง Dependencies**
   ```bash
   npm install
   ```

2. **ตั้งค่า Environment Variables**
   คัดลอกไฟล์ `.env.example` เป็น `.env`:
   ```bash
   cp .env.example .env
   ```
   *(ในโหมดพัฒนา หากเว้น `DATABASE_URL` ว่าง ระบบจะใช้ฐานข้อมูล PGlite ในโฟลเดอร์ `.data/pglite` และเก็บไฟล์แนบใน `.data/uploads` อัตโนมัติ)*

3. **รัน Migration และ Seed ข้อมูลเริ่มต้น**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

4. **เปิดเซิร์ฟเวอร์พัฒนา**
   ```bash
   npm run dev
   ```
   เปิดเบราว์เซอร์ที่ `http://localhost:3000` และเข้าสู่ระบบด้วยอีเมล/รหัสผ่านที่กำหนดใน `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`

---

## การทดสอบ (Automated Tests)

รันชุดทดสอบทั้งหมด (Domain + Services + PDF + Excel Exports + End-to-End Flows):
```bash
npm test
```

ตรวจสอบการ Build สำหรับ Production:
```bash
npm run build
```

---

## การนำขึ้นระบบจริง (Deployment บน Vercel)

1. เชื่อมต่อโปรเจกต์กับ Vercel:
   ```bash
   vercel link
   ```
2. ติดตั้งฐานข้อมูล **Neon Postgres** และ **Vercel Blob** ผ่าน Vercel Marketplace
3. กำหนดค่า Environment Variables บน Vercel:
   - `DATABASE_URL` (จาก Neon Postgres)
   - `BLOB_READ_WRITE_TOKEN` (จาก Vercel Blob)
   - `AUTH_SECRET` (รหัสลับความยาวอย่างน้อย 32 ตัวอักษร)
   - `SEED_ADMIN_EMAIL` และ `SEED_ADMIN_PASSWORD`
4. รัน Migration และสร้างผู้ดูแลระบบเริ่มต้นบนฐานข้อมูลจริง:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Deploy ขึ้น Production:
   ```bash
   vercel deploy --prod
   ```
