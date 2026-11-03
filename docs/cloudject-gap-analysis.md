# Cloudject vs K Tec — Gap Analysis

Surveyed 2026-11-03 from the user's own Cloudject account (read-only; nothing was created or edited there).
Goal: reproduce the *features and flows* in K Tec with our own code and design — not Cloudject's code, text, or branding.

## 1. Global navigation

| Cloudject menu | Cloudject route | K Tec today | Gap |
|---|---|---|---|
| My Portal | `/portal` | — | Missing (per-user landing: my tasks, my approvals) |
| Dashboard | `/dashboard` | `/dashboard` | Exists |
| อนุมัติงาน (global approvals) | `/approvals` | `/inbox`, `/purchasing/approve` | Partial: purchasing only, no task/VO approvals |
| โครงการ | `/projects` | `/projects` | Exists |
| Timeline โครงการ | `/projects/timeline` | `/timeline` | Exists (route name differs) |
| สต็อก: ภาพรวม / เคลื่อนไหว / ใกล้หมด / รายงาน / บันทึกการใช้ / ทั้งหมด | `/stock?tab=…`, `/stock/usage` | `/stock` | Partial: no low-stock alert tab, no usage log page |
| จัดซื้อ: รายงานรายโครงการ / ภาพรวม / PR / PO / อนุมัติ / AP / ซัพพลายเออร์ / รอรับสินค้า | `/purchasing/*` | `/purchasing`, `/pr`, `/po`, `/purchasing/approve`, `/purchasing/ap`, `/purchasing/vendors`, `/receive` | Mostly exists; missing per-project purchasing report |
| ค่าแรง/งวดงาน: แผนงวดจ่าย / แผนงวดรับ / รายงาน / ผู้รับเหมา | `/labor-payments?tab=…` | `/labor-payments`, `/labor-payments/contractors` | Partial: no receivable milestones, no reports |
| บัญชี/การเงิน (25 pages: รายรับ, รายจ่าย, QT, INV, RC, TI, CN, DN, STI, ภาษีซื้อ/ขาย, WHT, เจ้าหนี้, ลูกหนี้, ลูกค้า, เงินสด/ธนาคาร, เงินทดรอง, รายงาน, ตั้งค่า) | `/accounting/*` | `/pv`, `/payables`, `/invoices` (AP side), `/exports`, WHT certs | Large gap: whole AR side (QT → INV → RC/TI, CN/DN, customers, receivables), cash/bank, advances, accounting reports |
| บริการหลังก่อสร้าง: ส่งมอบ / รับประกัน | `/after-sales/*` | `/handover`, `/warranty` | Exists (UI) |
| ผู้ใช้งาน | `/users` | `/master/users` | Exists |
| Billing / Settings | `/billing`, `/settings` | `/billing`, `/settings` | Exists |

## 2. Project workspace tabs

K Tec's `projects/[id]` already shows the **same 14 tabs** as Cloudject (ภาพรวม, รายรับรายจ่าย, BOQ, Cost Performance, VO, งาน, แกนต์/S-Curve, ปฏิทิน, รูปภาพ, รายงาน, เอกสาร, แชท, ทีมงาน, ตั้งค่า).

**The critical gap is persistence, not UI.** In `project-workspace-client.tsx` and `boq-sheet-editor.tsx`, BOQ rows, tasks, VOs, calendar events, chat, documents, daily reports and team members are hard-coded `useState([...])` arrays. Nothing is saved; a page refresh loses every edit. The database has no tables for any of them.

| Tab | Cloudject behaviour observed | K Tec data source | Needed |
|---|---|---|---|
| BOQ | List of BOQ sets (main + one per VO), doc no. `<project>-BOQ-<n>`, sheet with header (โครงการ, สถานที่, เจ้าของ, รายละเอียด, เลขที่, แก้ไขครั้งที่, วันที่ประมาณการ, ผู้ประมาณการ), rows = หมวด / รายการ / รายการย่อย with qty, unit, material unit price + amount, labour unit price + amount, total, note; footer: overhead & profit, subtotal, discount, after-discount, VAT 7 %, grand total; revision (Rev.0); ribbon: add category/item/sub-item, bold, template, import, export, print, delete all; autosave timestamp | in-memory | `boqs`, `boq_lines` tables, service, autosave action |
| VO | KPIs (original contract, approved add/deduct, current contract, pending VOs, extension days); list with filters (status, type); columns: VO no./date, type/detail, requester, add, deduct, net, days impact, status | in-memory | `variation_orders` table + approval flow; approved VO adjusts contract value and creates a VO BOQ |
| งาน (Tasks) | Kanban: รอดำเนินการ → กำลังดำเนินการ → รอตรวจสอบ → รออนุมัติ → เสร็จสิ้น / ไม่อนุมัติ; card: priority, due date, value (฿), progress % | in-memory | `project_tasks` table with WBS parent, dates, value, progress, status |
| แกนต์ / S-Curve | WBS (1, 1.1 …), plan start/end, progress; plan vs actual cumulative S-curve weighted by budget; day/week/3-week/month zoom; Excel template/upload/download; print | derived from in-memory tasks | Derive from `project_tasks` |
| Cost Performance | EVM: BAC, AC, EV, PV, CPI, SPI, CV, SV, EAC; per-category table; trend charts | in-memory | Compute from tasks (EV/PV), PV/PO spend (AC) |
| รายรับรายจ่าย | Totals: received, billed, expenses, net; 12-month income vs expense, cumulative cash, recent docs | `project-cashflow-view.tsx` | Wire to PV (expense) + future AR documents |
| ปฏิทิน / รูปภาพ / รายงาน (Daily/Weekly/Monthly) / เอกสาร / แชท | Standard CRUD + uploads | in-memory | Tables + `attachments` reuse |
| ทีมงาน | Add users from company to project team | in-memory | Already have `project_members` — just wire it |
| ตั้งค่า | name, code, group, location, budget, status (วางแผน/กำลังดำเนินการ/พักงาน/เสร็จสิ้น/ยกเลิก), cover image, LINE OA, delete | partial | Add `budget`, `status`, `location`, `client`, dates to `projects` |

## 3. Other issues found

- `projects/[id]/page.tsx` falls back to a hard-coded sample project when the id is not found; that sample was copied from a live Cloudject project. Should return 404 instead.

## 4. Proposed phases

1. **BOQ persistence** — schema + migration, service, autosave server action, wire `boq-sheet-editor` to load/save; tests.
2. **Project master fields** — client, location, budget, dates, status on `projects`; settings tab saves them; remove the hard-coded fallback.
3. **Tasks / WBS** — `project_tasks`, kanban, gantt & S-curve derived from it.
4. **VO** — table, approval flow, contract value roll-up, VO BOQ.
5. **Cost Performance** — EVM computed from 3–4 + PV/PO actuals.
6. **AR / accounting side** — customers, QT → INV → RC/TI, CN/DN, receivables, output VAT.
7. Calendar, photos, documents, daily reports, chat; My Portal; global approvals.
