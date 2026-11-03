# Construction ERP Workflow Spec (from Cloudject survey)

Surveyed 2026-11-03, read-only, from the user's own Cloudject account. Nothing was created, saved or deleted there (the PR form was opened and left without saving).
This file records **what the system does** — modules, document flows, statuses, list columns and form fields — so K Tec can implement the same business capability with its own code and its own visual design. It deliberately does not copy source code, CSS, images, wording or branding.
Companion: `docs/cloudject-gap-analysis.md` (menu-by-menu gap table).

---

## 1. Core document flows

```
SALES / INCOME
  Customer ─► QT ใบเสนอราคา ─► (project opened) ─► BOQ หลัก ─► แผนงวดงานรับ (from BOQ)
          ─► INV ใบแจ้งหนี้/วางบิล (per milestone, less retention) ─► RC ใบเสร็จ / TI ใบกำกับภาษี
          ─► ลูกหนี้ (aging) ─► CN / DN adjustments ─► ภาษีขาย report

PURCHASING / COST
  PR ใบขอซื้อ ─► approval ─► PO ใบสั่งซื้อ ─► รอรับสินค้า (Waiting / Partial / Received)
          ─► stock receive ─► รายจ่าย (expense doc w/ evidence) ─► เจ้าหนี้ (aging) ─► payment
          ─► WHT certificate ─► ภาษีซื้อ report
  Over-budget guard: buying beyond BOQ quantity/value needs an **AP (ขออนุมัติซื้อเกิน BOQ)**,
  showing project, requester, amount over BOQ and reason, approved before the PO proceeds.

LABOUR / SUBCONTRACT
  Contractor master ─► แผนงวดงานจ่าย (from BOQ) ─► ใบเบิกงวด ─► retention deducted ─► payment

CASH ADVANCE
  ใบขอเงินทดรอง ─► approve ─► pay ─► เคลียร์ (actual spend, partial/full) ─► remaining balance
  Receipt substitute: ใบรับรองแทนใบเสร็จรับเงิน for expenses without a receipt.

CHANGE CONTROL
  VO (add / deduct, days impact) ─► approve ─► contract value updated ─► VO BOQ created
```

## 2. Shared status model

Accounting documents (receipt substitute, advances, income/expense) use one lifecycle:
`ร่าง → ส่งอนุมัติแล้ว/รออนุมัติ → อนุมัติแล้ว | ไม่อนุมัติ → ยกเลิก`.
Advances extend it: `→ จ่ายเงินแล้ว → รอเคลียร์ → เคลียร์บางส่วน → เคลียร์ครบ`.
Receivables: `ยังไม่ถึงกำหนด | เกินกำหนด | รับชำระบางส่วน | ชำระครบ`, aging buckets `ยังไม่ถึงกำหนด, 1–30, 31–60, 61–90, >90 วัน`.
Payables: same aging buckets.
Tasks: `รอดำเนินการ → กำลังดำเนินการ → รอตรวจสอบ → รออนุมัติ → เสร็จสิ้น | ไม่อนุมัติ`.
Projects: `วางแผน | กำลังดำเนินการ | พักงาน | เสร็จสิ้น | ยกเลิก` — handover and warranty documents only for `เสร็จสิ้น`.
Receiving: `Waiting Receive | Partially Received | Received`.

## 3. Module reference

### 3.1 Workspace
| Page | Purpose / content |
|---|---|
| My Portal | "อัปเดตล่าสุด" feed + "โครงการของฉัน" cards (location, budget, progress %, tasks done/total, team) |
| Dashboard | Monthly income vs project cost chart, project progress, project status breakdown |
| Approvals (global) | One inbox for every approval type incl. leave requests and stock edit/cancel requests; filter by submitted date range |

### 3.2 Projects
List: card/table toggle, search, filter, "completed projects" toggle, page size 10/25/50/all.
Card fields: status, code, name, client, PM, location, start, end, budget, progress %, tasks x/y, team.
Workspace tabs and their content: see `cloudject-gap-analysis.md` §2 (BOQ sheet, VO, tasks kanban, Gantt/S-curve, EVM cost performance, income/expense, calendar, photos, daily/weekly/monthly reports, documents, chat, team, settings).
Project settings form: name, code, group, location, budget, status, cover image, LINE OA link, delete.

### 3.3 Stock
| Tab | Columns / controls |
|---|---|
| ภาพรวม | 6-month in/out chart, stock by material category, stock by project; search material/SKU/source/destination; movement type filter `รับเข้า / จ่ายออก / โอนย้าย / ยืม` |
| เคลื่อนไหวล่าสุด | วันที่, ประเภท, วัสดุ, ต้นทาง, ปลายทาง, จำนวน, ผู้ทำรายการ |
| ใกล้หมด | วัสดุ, คงเหลือ, จุดสั่งซื้อ (reorder point, editable), ที่มา/คลัง |
| สต็อกทั้งหมด | per warehouse: จำนวนรายการ, จำนวนรวม, มูลค่า, วันที่/ผู้รับเข้าล่าสุด; saved-document history |
| บันทึกการใช้วัสดุ | material usage log + usage report, monthly vs cumulative, per-project chart |

### 3.4 Purchasing
| Page | Columns / behaviour |
|---|---|
| ภาพรวม | KPIs: PR awaiting approval, POs issued, awaiting receipt, PO value this month; combined PR/PO list: เลขที่, ประเภท, ลูกค้า, โครงการ, ซัพพลายเออร์, วันที่, มูลค่า, สถานะ, ผู้รับผิดชอบ |
| PR / PO lists | grouped by project: PR count, PO count, total docs, value |
| อนุมัติจัดซื้อ | pending PR/AP counts; over-BOQ requests: เลขที่/วันที่, โครงการ, ผู้ขอ, มูลค่าเกิน BOQ, เหตุผล |
| ใบ AP | per project: ร่าง, รออนุมัติ, อนุมัติแล้ว, total, value over BOQ |
| ซัพพลายเออร์ | ผู้ติดต่อ, เงื่อนไขการชำระเงิน, ระยะเวลาจัดส่ง, ยอดซื้อรวม, เอกสาร, เปิดค้าง |
| รอรับสินค้า | per project: Waiting / Partially / Received counts, value → drill into POs |
| รายงานรายโครงการ | project + date range + search → report, print, PDF |

**PR/PO form** (one form, type toggle PR/PO): company header; เลขที่, วันที่, กำหนดใช้/รับของ; supplier/contractor (address, tax id, contact, phone, email); โครงการ, แผนก/ฝ่าย, ผู้ขอซื้อ, สถานที่จัดส่ง; lines: ลำดับ, รายการ (name + detail), จำนวน, หน่วย, ราคาต่อหน่วย, ส่วนลด, จำนวนเงิน; amount in Thai words; หมายเหตุ; เงื่อนไขการชำระเงิน; VAT mode (exclusive/inclusive) and VAT %; totals: before discount, discount, before VAT, VAT 7 %, grand total; signature blocks ผู้ขอซื้อ / ผู้จัดทำ / ผู้อนุมัติ.

### 3.5 Labour & progress payments
Project list (project, client, status) → per-project milestone sheet, two variants: **pay** (to contractors, has ผู้รับผิดชอบ) and **receive** (from client).
Header KPIs: project budget, amount planned in milestones, unplanned remainder, approved/paid, overall %.
Sheet columns: งวดงาน, รายการ, ผู้รับผิดชอบ, งานแล้วเสร็จ, วันที่, จำนวน, หน่วย, ค่าวัสดุ (rate, amount), ค่าแรง (rate, amount), แผนการเบิกจ่าย (%, amount), หักประกันผลงาน (%, amount), คงเหลือจ่ายงวด, วันที่เบิกจ่าย, หมายเหตุ.
Actions: add milestone, **create from BOQ**, manage milestones, claim document (ใบเบิกงวด), print, export.
Contractors: ผู้รับเหมา, ผู้ติดต่อ, ประเภทงาน, เงื่อนไขจ่ายเงิน, บัญชีธนาคาร, ประกัน (retention), หัก ณ ที่จ่าย.

### 3.6 Accounting & finance
| Page | Columns / behaviour |
|---|---|
| ภาพรวม | income/expense this month, AR & AP outstanding, 12-month charts, cumulative net cash, expense by GL category, recent documents |
| รายรับ / รายจ่าย | เลขที่, วันที่, party, โครงการ, ยอดรวม, สุทธิ, (หลักฐาน), สถานะ; cancelled-docs toggle |
| QT / INV / RC / TI / CN / DN / STI | เลขที่, วันที่, (ครบกำหนด), ลูกค้า/ผู้ขาย, โครงการ, ยอดรวม, สุทธิ, สถานะ |
| ภาษีซื้อ / ภาษีขาย | count, tax base, VAT; วันที่, เลขที่, party, tax id, โครงการ, ฐานภาษี, VAT, ยอดรวม; Excel + A4 print |
| WHT | certificates: เลขที่, วันที่, ผู้ถูกหักภาษี, โครงการ, ยอดรวม, สุทธิ |
| เจ้าหนี้ | aging buckets; ผู้ขาย, เลขที่บิล, วันที่บิล, ครบกำหนด, โครงการ, ยอดรวม, WHT, ยอดต้องจ่าย, Aging |
| ลูกหนี้ | filters (project, status, aging); ลูกค้า, ใบแจ้งหนี้, โครงการ, วันที่, ครบกำหนด, ยอดตั้งหนี้, รับชำระแล้ว, WHT, คงเหลือ, อายุ |
| ลูกค้า | รหัส, ชื่อ, เลขผู้เสียภาษี, สาขา, ผู้ติดต่อ, โทร, เครดิต (days, limit), สถานะ |
| เงินสด/ธนาคาร | bank and cash accounts with opening balances |
| เงินทดรองจ่าย | request / clear / outstanding tabs; filters payee, project, date, status; totals paid, used, remaining |
| รายงาน | sales / expense reports by project, doc type, customer, month, year; A4 / PDF |
| รายงานงบประมาณโครงการ | per project budget vs actual |
| ตั้งค่าบัญชีและภาษี | document running numbers per type; chart of accounts: รหัส, ชื่อหมวด, ประเภท (รายรับ/ค่าใช้จ่าย/สินทรัพย์/หนี้สิน/ทุน/อื่นๆ), GL group, VAT/WHT default |

### 3.7 After-sales, admin
Handover documents and warranty certificates (A4 preview, edit, delete) for completed projects.
Users: ผู้ใช้, อีเมล, ตำแหน่ง, organization, สถานะ. Settings: organisation logo and company stamp (used on printed documents).

---

## 4. K Tec build order (updated)

| # | Phase | Notes |
|---|---|---|
| 1 | BOQ persistence | **Done** (`boqs`, `boq_lines`, service, editor wired) |
| 2 | Project master fields + status lifecycle | client, location, budget, dates, status; remove hard-coded sample project |
| 3 | Tasks / WBS → Gantt, S-curve | |
| 4 | Milestones (pay & receive) generated from BOQ, retention | links BOQ → labour payments → billing |
| 5 | Over-BOQ purchase approval (AP) | PO lines checked against BOQ quantities/value |
| 6 | VO with approval, contract value roll-up, VO BOQ | |
| 7 | AR side: customers, QT, INV (per milestone), RC/TI, CN/DN, receivables aging, output VAT | |
| 8 | Cash advances request → pay → clear; receipt substitutes | |
| 9 | Stock: reorder points & low-stock alert, usage log | |
| 10 | Chart of accounts, cash/bank, accounting reports, project budget report | |
| 11 | Portal, global approvals inbox, calendar/photos/docs/chat, handover/warranty docs | |
