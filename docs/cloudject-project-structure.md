# Cloudject project workspace — full structure map

Surveyed 2026-11-03 on one project in the user's own Cloudject account. Read-only: forms were opened to read their fields and then cancelled; nothing was created, edited or deleted.
This is a functional map (routes, sections, fields, rules) for building the same features in K Tec with our own code and design. It does not copy Cloudject code, text or branding.

Legend for the **K Tec** column: ✅ built and persisted · 🟡 UI exists but demo/in-memory · ❌ missing.

## 1. Routing and layout

Every tab is its own route under `/projects/:id` (deep-linkable), not a client-side tab state.

| Tab | Route | K Tec |
|---|---|---|
| ภาพรวม | `/projects/:id` | 🟡 (header/info real, widgets partly demo) |
| รายรับรายจ่ายโครงการ | `/income-expense`, `/income-expense/income/new`, `/income-expense/expense/new` | 🟡 |
| BOQ | `/boq` | ✅ |
| Cost Performance | `/cost-performance` | 🟡 |
| งานเพิ่ม-ลด (VO) | `/variation-orders` | ✅ |
| งาน | `/tasks` | ✅ |
| แกนต์ / S-Curve | `/gantt` | ✅ (no Excel import/export) |
| ปฏิทิน | `/calendar` | 🟡 |
| รูปภาพ | `/photos` | 🟡 |
| รายงาน | `/reports` | 🟡 |
| เอกสารโครงการ | `/documents` | 🟡 |
| แชท | `/chat` | 🟡 |
| ทีมงาน | `/team` | 🟡 (`project_members` table exists) |
| ตั้งค่า | `/settings` | 🟡 (fields exist via project details form) |

**Shared header (all tabs):** breadcrumb "โครงการทั้งหมด" · code · status badge · overdue-task count · name · client · location · start–end dates · overall progress %.

## 2. Tab by tab

### 2.1 ภาพรวม (Overview)
- KPI cards: tasks done (x/y), in progress, overdue (needs follow-up), team size.
- "สถานะการทำงาน": lists in-progress and overdue tasks with due dates, plus a "เปิดดูงาน" link to the tasks tab.
- **ข้อมูลโครงการ** card with an "แก้ไข" button. The edit form has these fields:
  - ชื่อโครงการ, รหัสโครงการ
  - ลูกค้า, กลุ่มโปรเจค
  - ผู้ติดต่อ, โทรศัพท์
  - ผู้จัดการโครงการ (select from users)
  - สถานที่, งบประมาณ (บาท)
  - สถานะ (วางแผน / กำลังดำเนินการ / พักงาน / เสร็จสิ้น / ยกเลิก)
  - วันที่เริ่ม, วันที่สิ้นสุด
- Side widgets:
  - location, code and created date;
  - project age, team count, photo count;
  - **weather forecast for the project's province** (high/low, condition, rain %, wind);
  - project photos ("เพิ่มรูปโครงการ");
  - progress donut;
  - team list with roles.

### 2.2 รายรับรายจ่ายโครงการ (Income / Expense)
- Totals: รับเงินแล้ว, วางบิล/แจ้งหนี้, รายจ่าย, คงเหลือสุทธิ.
- Charts:
  - income vs expense over 12 months, with YTD totals;
  - net profit YTD and margin %;
  - cumulative cash balance;
  - income/expense split.
- "รายการล่าสุด" table: วันที่ · เลขที่ · ประเภท · คู่ค้า · ยอดเงิน · สถานะ · เปิด. Links to the accounting module.
- **เพิ่มรายรับ** (`income/new`) is a receipt document, no. `REC-yymm-0001`.
  - Header fields: date, reference.
  - Customer: select or "+ เพิ่มข้อมูลลูกค้าใหม่". Address, tax ID, branch, contact, phone and email fill automatically.
  - Project, งวดงาน.
  - หมวดบัญชี: income accounts 41xx/49xx, plus deposits and advances received (21xx).
  - Lines: name and detail, then amounts; "เพิ่มรายการที่ N" adds more lines.
  - Payment: method (โอน / เงินสด / เช็ค), bank and reference.
  - VAT mode: แยก VAT 7% / รวม VAT 7% / รวม VAT แต่ไม่แสดงยอด / ไม่มี VAT / ยกเว้น VAT.
  - Toggles for **WHT deducted by customer** and VAT. Amount in words is shown.
- **เพิ่มรายจ่าย** (`expense/new`) is a payment voucher, no. `EXP-yymm-0001`.
  - Payee/vendor, delivery location, account category.
  - Lines: item, qty, unit, unit price, amount.
  - Payment method (adds พร้อมเพย์ and บัตรเครดิต), bank, VAT mode.
  - Extra buttons:
    - **สแกนบิลด้วย AI** (OCR a bill into the form);
    - **ตัดงบ BOQ** (charge the expense to a BOQ line);
    - **แนบรูป**.

### 2.3 BOQ
List of BOQ sets (main and one per VO) → sheet editor. Already documented in `cloudject-gap-analysis.md` §2 and built in K Tec (phases 1, 6).

### 2.4 Cost Performance (EVM report)
- Report header: project, location, prepared by, as-of date, period, report no. `<code>-CPR`.
- Filters: project, period/category, date range. Actions: พิมพ์รายงาน, ส่งออก Excel, **เพิ่มหมวดต้นทุน**.
- KPI cards:
  - BAC, AC, EV;
  - CPI = EV ÷ AC, with a "ต้องเฝ้าระวัง" flag;
  - CV = EV − AC;
  - SV = EV − PV;
  - EAC = BAC ÷ CPI, plus remaining cost and variance at completion.
- Charts: cumulative PV / EV / actual progress lines; CPI and SPI trend.
- Table: หมวดงาน · BAC · PV · EV · AC · CV · CPI · SPI.
- **เพิ่มหมวดต้นทุน form:** หมวดงาน*, BAC, PV, EV, AC. The four values are entered by hand per category; EV/PV are not derived from tasks.

### 2.5 งานเพิ่ม-ลด (VO)
Built in K Tec, including the full VO form (sections A, B, C and D-F).

### 2.6 งาน (Task board)
- Kanban columns: รอดำเนินการ → กำลังดำเนินการ → รอตรวจสอบ → รออนุมัติ → เสร็จสิ้น / ไม่อนุมัติ.
- Each column has its own "เพิ่ม Task ใน …" button, and **column titles are renamable** ("แก้ไขชื่อแถบงาน").
- Card: title, priority, due date, budget, % progress.
- **Task form** (same drawer for add and detail):
  - กลุ่มงานหลัก ("เป็นกลุ่มงานหลัก", or pick a parent to make a sub-task);
  - ชื่องาน, รายละเอียด;
  - สถานะ, ความสำคัญ, ผู้รับผิดชอบ;
  - งบประมาณ (บาท), ความคืบหน้า (%);
  - วันเริ่ม, กำหนดส่ง.
  - The detail view adds "ลบ Task".

### 2.7 แกนต์ / S-Curve
- Toolbar:
  - พิมพ์;
  - **Template, ดาวน์โหลดข้อมูล Excel, Upload** (Excel round-trip of the plan);
  - Planning mode;
  - zoom (รายวัน / รายสัปดาห์ / 3 สัปดาห์ / รายเดือน);
  - "% แผนงาน: ตามงบประมาณ" (progress weighting basis);
  - จัดการ (opens the task form);
  - เต็มจอ, คอลัมน์, ย่อตาราง;
  - Planning S-Curve and Actual S-Curve toggles.
- Grid: No. (WBS) · รายการงาน · เริ่มต้น · สิ้นสุด · ความคืบหน้า (%). Columns can be collapsed and resized, and groups expanded or collapsed.
- Footer rows: รวมทั้งโครงการ — Plan สะสม %, Actual สะสม %, Variance %.

### 2.8 ปฏิทิน
- Mini month calendar plus a main view (วัน / สัปดาห์ / เดือน, default week).
- An all-day row and hourly rows from 07:00 to 19:00, plus a "วันนี้" button.
- No visible "add" button; events presumably come from tasks or a slot click (not verified).

### 2.9 รูปภาพ
Albums: "สร้างอัลบั้ม" and image upload (`image/*`, multiple).

### 2.10 รายงาน (Daily / Weekly / Monthly)
- **Daily Construction Report** is the only report created by hand. Actions: ยกเลิก / บันทึก Draft / ส่งรายงาน. Report no. is `DR-yyyymmdd-NNN`.
  - Project detail: date, project, prepared by, location, job type, start/end time.
  - Weather:
    - condition (แดด / เมฆครึ้ม / ฝนตก / ฝนตกหนัก / อื่นๆ), with the weather forecast pre-filled;
    - schedule impact (กระทบ / ไม่กระทบ) and a note.
  - Work summary: 5 rows of task detail, Completed/Delayed checkboxes, and a problem note.
  - Labour summary: company/worker type, work hours, headcount (5 rows).
  - Equipment summary: machine type, hours used (5 rows).
  - Safety: no accident / accident, with a note. Visitors: none / has visitor, with detail.
  - Project duration, auto-filled: total work hours today, elapsed days, remaining days.
  - Today's progress: area/unit, **task picked from the Gantt WBS**, today's %, note (5 rows).
  - Photos: 6 slots, each with a caption.
- **Weekly report** (`WR-yyyymmdd`) is generated automatically from daily reports, tasks, the BOQ and finance. Week picker, Preview A4, Export PDF. It contains:
  - progress comparison with the previous week (planned/actual, increments, variance in pp);
  - schedule and budget/disbursement table;
  - executive summary and progress by work category;
  - trend chart, about 4 pages.
- **Monthly report** (`MR-yyyy`), also automatic. It contains:
  - executive summary;
  - plan / actual / variance, number of daily reports, average manpower, safety;
  - progress by category and S-curve;
  - major works and milestones;
  - critical/delayed activities (from overdue tasks);
  - material/equipment summary;
  - financial summary (contract value, approved VO, cost to date, billing/payment);
  - issues/RFI and next-month plan;
  - "Auto Source" counts.

### 2.11 เอกสารโครงการ
- Search, plus a category filter:
  - เอกสารก่อนเริ่มโครงการ, ระหว่างดำเนินงาน;
  - ตรวจงาน, อนุมัติ, การเงิน;
  - ส่งมอบและปิดโครงการ.
- Upload. The "PDF 0/5 ไฟล์" counter suggests a plan quota.
- Table: ชื่อเอกสาร · **Version** · ขนาด · ผู้อัปโหลด · อัปเดต · การกระทำ.

### 2.12 แชท
Realtime project chat with a message count, image and file attachments, and Enter to send.

### 2.13 ทีมงาน
- Member cards: name, title, email, role (e.g. project_manager), number of assigned tasks, and ถอดออก.
- "เพิ่มคนเข้าทีม": search company users by name or email, then add.

### 2.14 ตั้งค่า
- Project settings: name, code, group, location, budget, status. Save / cancel / **ลบโครงการ**.
- Notifications: **LINE Official Account** connection (LINE group receives automatic project reports) with a test-message button.
- Header background: 10 preset images, or upload JPG/PNG/WEBP/GIF up to 8 MB, plus Sync.

## 3. Cross-links observed
- Task WBS feeds Gantt, S-curve, daily report rows, monthly critical activities and overview overdue counts.
- Daily reports feed the weekly/monthly reports (progress, manpower, safety, photos, issues).
- Income/expense documents feed the overview of this tab, the weekly/monthly financial summary and Cost Performance AC.
- Expense documents can be charged to a BOQ line ("ตัดงบ BOQ"), which links accounting to BOQ budget control.
- Approved VOs feed the contract value in the monthly report.

## 4. Gaps for K Tec, in suggested order
1. **Daily report (persisted) + auto weekly/monthly reports.** This is the largest functional gap and feeds several other areas.
2. **Project documents** with categories and versions, and **photo albums** (reuse `attachments`).
3. **Team tab wired to `project_members`**: search, add, remove, role.
4. **Project-level receipt/expense documents** with account category, payment method/bank, VAT modes, WHT and "charge to BOQ line". These overlap the phase 10 accounting work.
5. **Cost Performance from real data**: EV from task progress × value, PV from the planned curve, AC from PV/expense docs. Keep a manual category override like Cloudject's.
6. Gantt Excel template/import/export; renamable kanban columns.
7. Calendar events, realtime chat, LINE OA notifications, weather widget (nice-to-have; needs external services).
