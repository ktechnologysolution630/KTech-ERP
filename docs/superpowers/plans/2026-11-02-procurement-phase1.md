# K Tec ERP Phase 1 (Procurement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Thai-language web app where PR → PO → goods receipt → invoice/payable → PV → payment lives in one place, with per-role inboxes, an owner dashboard, Thai PDFs, 50 ทวิ, and monthly Excel exports.

**Architecture:** Next.js App Router monolith. All business rules live in pure functions (`src/domain`) and DB-backed services (`src/server/services`) that take `(db, actor, input)`; Server Actions and pages are thin wrappers. Postgres via Drizzle; PGlite in-memory for tests and optional local dev, so tests need no external DB.

**Tech Stack:** Next.js 16 (App Router, TS, `src/`), Tailwind CSS v4 + shadcn/ui, Drizzle ORM + drizzle-kit, `pg` (prod, Neon) / `@electric-sql/pglite` (tests, local), zod, decimal.js, bcryptjs, jose, @react-pdf/renderer, exceljs, @vercel/blob, Vitest. npm as package manager.

**Spec:** `docs/superpowers/specs/2026-11-02-procurement-design.md`

## Global Constraints

- All UI copy in Thai. UI font IBM Plex Sans Thai (next/font); PDF font Sarabun (TTF bundled in `src/pdf/fonts/`).
- Money: `numeric(14,2)` in DB, `Decimal` (decimal.js) in code, never JS `number` for money. Quantities `numeric(14,3)`.
- Rounding: half-up to 2 dp; VAT and WHT rounded **per line**, then summed.
- VAT rate 7%. VAT modes per PO: `EXCLUSIVE` | `INCLUSIVE` | `NONE`.
- WHT rates allowed: 0, 1, 2, 3, 5 (%), computed on before-VAT amount.
- All money checks/status figures use **gross = including VAT, before WHT** (spec §4.8).
- Doc numbers: `PR-YYMM-####`, `PO-YYMM-####`, `PV-YYMM-####`, `WHT-YYMM-####`; YY = Buddhist year 2 digits, counter resets monthly, company-wide.
- Timezone Asia/Bangkok; dates shown as Buddhist era (e.g. `2 พ.ย. 2569`) on screens and PDFs.
- Never hard-delete business documents; use `CANCELLED`/void status. Every state change writes an activity log row.
- Rejections require a reason; rejected docs return to `DRAFT` and keep their number.
- PO approval: gross total `< settings.poApprovalLimit` → PURCHASING_HEAD or OWNER may approve; otherwise OWNER only. Creator may not approve own PO unless OWNER. PV and close-short approvals: OWNER only.
- Foreman/Engineer/PM see only projects they are members of; PURCHASING, PURCHASING_HEAD, FINANCE, OWNER, ADMIN see all.
- No offline support. Images are resized client-side to max 1600px long edge, JPEG q≈0.8, before upload.
- Login: email + password; accounts created by ADMIN only; no self-signup.

## Review Focus

1. **Double submit / concurrent action** (double-tap "ยืนยันรับ" or "อนุมัติ"): must not over-receive, double-pay, or skip numbers → services lock the PO row (`SELECT … FOR UPDATE`) and re-check inside the transaction; test in Task 9 and Task 11 (second call fails with `DomainError`).
2. **Thai-formatted numeric input** ("1,234.50", " 2.5 ", "๑๒") → `parseDecimalInput` accepts commas/whitespace and Thai digits, rejects garbage; test in Task 2.
3. **Foreman opens another project's PO by URL** → 403 in service, not just hidden in UI; test in Task 4 (policy) and Task 9 (receipt service).
4. **Reject → edit → resubmit** keeps doc number and full history; test in Task 6 (PR) and Task 7 (PO).
5. **WHT on a VAT-inclusive PO** computes on before-VAT, not gross; test in Task 2 and Task 11.

---

## File Structure

```
src/
  domain/                 pure, no DB
    money.ts              Decimal helpers, totals, allocation, WHT, installments
    thai.ts               BE dates, doc period, Thai digit parsing, baht text
    errors.ts             DomainError
    po-approval.ts        approver routing
    po-summary.ts         PO figures + status labels
    close-short.ts        installment rescale on close-short
  db/
    schema/               one file per area: core.ts, master.ts, pr.ts, po.ts, receipt.ts, finance.ts, activity.ts
    schema/index.ts
    client.ts             createDb(url) / getDb()
    migrate.ts
    seed.ts
  server/
    auth/                 password.ts, session.ts, current-user.ts
    policy.ts             can()/assertCan()
    services/             numbering.ts, activity.ts, notifications.ts, attachments.ts, settings.ts,
                          master.ts, import.ts, pr.ts, po.ts, receipt.ts, invoice.ts, payable.ts, pv.ts,
                          close-short.ts, inbox.ts, dashboard.ts, wht-cert.ts, exports.ts
  app/
    login/  (app)/layout.tsx  (app)/inbox  (app)/dashboard  (app)/pr  (app)/po  (app)/receive
    (app)/invoices  (app)/payables  (app)/pv  (app)/master/*  (app)/settings  (app)/exports
    api/pdf/[kind]/[id]/route.ts   api/export/[kind]/route.ts   api/upload/route.ts
  components/             ui/ (shadcn), app-shell, money-input, doc-status-badge, activity-feed, attachments, approval-bar
  pdf/                    fonts/, layout.tsx, pr.tsx, po.tsx, pv.tsx, wht50.tsx
tests/
  helpers/test-db.ts      fresh migrated PGlite per test file + fixtures
  domain/*.test.ts  services/*.test.ts  flows/*.test.ts
```

Service convention (all tasks): `export async function verbNoun(db: Db, actor: SessionUser, input: Input): Promise<Output>`. Inputs validated with zod at the top. Errors thrown as `DomainError`. Each mutating service runs in `db.transaction`, writes `logActivity`, and calls `notify` where a new person must act.

---

### Task 1: Scaffold, DB harness, git

**Files:**
- Create: Next app (via `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`), `drizzle.config.ts`, `vitest.config.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/schema/index.ts`, `src/db/schema/core.ts` (placeholder `app_meta` table only), `tests/helpers/test-db.ts`, `tests/smoke.test.ts`, `.env.example`, `.gitignore` additions (`.uploads/`, `.pglite/`)

**Interfaces:**
- Produces: `type Db` (Drizzle Postgres db with `schema`); `createDb(url: string): Promise<Db>` — `url` starting `pglite:` → PGlite (`pglite:memory` in-memory, `pglite:./.pglite` on disk), else `pg` Pool; `getDb(): Promise<Db>` (singleton from `process.env.DATABASE_URL`, default `pglite:./.pglite`); `runMigrations(db: Db): Promise<void>` (drizzle migrator, folder `drizzle/`); `createTestDb(): Promise<Db>` (memory PGlite + migrations).

- [ ] **Step 1:** `git init`, scaffold Next app in repo root (keep `docs/`), install deps listed in Tech Stack + dev deps `vitest drizzle-kit @types/bcryptjs`. Add scripts: `test` (`vitest run`), `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx src/db/migrate.ts`), `db:seed` (`tsx src/db/seed.ts`).
- [ ] **Step 2: Write failing test** `tests/smoke.test.ts`:
```ts
test('test db runs migrations and answers', async () => {
  const db = await createTestDb();
  const r = await db.execute(sql`select 1 as ok`);
  expect(r.rows[0].ok).toBe(1);
});
```
- [ ] **Step 3:** Run `npm test` → FAIL (module missing).
- [ ] **Step 4:** Implement client/migrate/test-db; `npm run db:generate`.
- [ ] **Step 5:** Run `npm test` → PASS; `npm run build` → succeeds.
- [ ] **Step 6:** Commit `chore: scaffold next app, drizzle, pglite test harness` (include spec + plan).

---

### Task 2: Money & Thai helpers (pure)

**Files:**
- Create: `src/domain/money.ts`, `src/domain/thai.ts`, `src/domain/errors.ts`
- Test: `tests/domain/money.test.ts`, `tests/domain/thai.test.ts`

**Interfaces:**
- Produces (`money.ts`):
  - `D(v: Decimal.Value): Decimal`; `round2(d: Decimal): Decimal` (ROUND_HALF_UP); `sum(ds: Decimal[]): Decimal`
  - `type VatMode = 'EXCLUSIVE'|'INCLUSIVE'|'NONE'`; `VAT_RATE = 7`; `WHT_RATES = [0,1,2,3,5] as const`
  - `allocate(amount: Decimal, weights: Decimal[]): Decimal[]` — 2 dp, largest-remainder, sums exactly to amount; zero weights → all to equal split
  - `computeDocTotals(i: { lines: {qty: Decimal; unitPrice: Decimal; discount: Decimal}[]; billDiscount: Decimal; shipping: Decimal; vatMode: VatMode }): DocTotals` where `DocTotals = { subtotal, billDiscount, shipping, beforeVat, vat, gross: Decimal; lines: { amount, allocatedBeforeVat, vat, gross, unitGross: Decimal }[] }`. Line amount = round2(qty×unitPrice − discount). Bill discount allocated negatively and shipping allocated positively across lines by amount (`allocate`). EXCLUSIVE: line vat = round2(allocBeforeVat×7%). INCLUSIVE: allocated amount is gross; beforeVat = round2(gross×100/107), vat = gross − beforeVat. NONE: vat 0. `unitGross = gross/qty` (unrounded Decimal, used for receipt valuation).
  - `computeWht(beforeVat: Decimal, ratePct: number): Decimal` (throws `DomainError('INVALID_WHT_RATE')` for rates not in WHT_RATES)
  - `splitInstallments(total: Decimal, parts: ({percent: Decimal}|{amount: Decimal})[]): Decimal[]` — each rounded, last part absorbs remainder; throws `DomainError('INSTALLMENT_SUM')` if percents ≠ 100 (percent mode) or amounts ≠ total (amount mode); mixing modes not allowed.
  - `parseDecimalInput(s: string): Decimal | null` — trims, strips commas, converts Thai digits ๐-๙, returns null on invalid.
  - `bahtText(d: Decimal): string` (Thai words, e.g. `1176.99` → `หนึ่งพันหนึ่งร้อยเจ็ดสิบหกบาทเก้าสิบเก้าสตางค์`; whole → `…บาทถ้วน`)
- Produces (`thai.ts`): `toBangkok(d: Date): Date`; `formatThaiDate(d: Date): string` (`2 พ.ย. 2569`); `docPeriod(d: Date): string` (Bangkok date → `YYMM` BE, e.g. 2026‑11‑02 → `6911`).
- Produces (`errors.ts`): `class DomainError extends Error { code: string; status: 400|403|404|409 }` constructor `(code, messageTh, status = 400)`.

- [ ] **Step 1: Write failing tests**
```ts
test('exclusive VAT per line', () => {
  const t = computeDocTotals({ vatMode:'EXCLUSIVE', billDiscount:D(0), shipping:D(0), lines:[
    {qty:D(10),unitPrice:D(100),discount:D(0)}, {qty:D(3),unitPrice:D('33.33'),discount:D(0)} ]});
  expect(t.beforeVat.toFixed(2)).toBe('1099.99');
  expect(t.vat.toFixed(2)).toBe('77.00');      // 70.00 + 7.00 (6.9993 → 7.00)
  expect(t.gross.toFixed(2)).toBe('1176.99');
});
test('inclusive VAT', () => {
  const t = computeDocTotals({ vatMode:'INCLUSIVE', billDiscount:D(0), shipping:D(0), lines:[{qty:D(1),unitPrice:D(107),discount:D(0)}]});
  expect([t.beforeVat.toFixed(2), t.vat.toFixed(2), t.gross.toFixed(2)]).toEqual(['100.00','7.00','107.00']);
});
test('bill discount and shipping allocated by amount', () => {
  const t = computeDocTotals({ vatMode:'NONE', billDiscount:D(10), shipping:D(4), lines:[
    {qty:D(1),unitPrice:D(300),discount:D(0)}, {qty:D(1),unitPrice:D(100),discount:D(0)} ]});
  expect(t.lines.map(l=>l.gross.toFixed(2))).toEqual(['295.50','98.50']);
  expect(t.gross.toFixed(2)).toBe('394.00');
});
test('allocate largest remainder', () => expect(allocate(D(100),[D(1),D(1),D(1)]).map(x=>x.toFixed(2))).toEqual(['33.34','33.33','33.33']));
test('wht on before-vat', () => { expect(computeWht(D(1000),3).toFixed(2)).toBe('30.00'); expect(computeWht(D('333.33'),3).toFixed(2)).toBe('10.00'); });
test('wht rejects 4%', () => expect(()=>computeWht(D(100),4)).toThrow(DomainError));
test('installments 20/30/40/10 last absorbs', () => expect(splitInstallments(D('1000.01'),[20,30,40,10].map(p=>({percent:D(p)}))).map(x=>x.toFixed(2))).toEqual(['200.00','300.00','400.00','100.01']));
test('installments must sum 100', () => expect(()=>splitInstallments(D(100),[{percent:D(50)}])).toThrow(DomainError));
test('parse thai input', () => { expect(parseDecimalInput(' 1,234.50 ')!.toFixed(2)).toBe('1234.50'); expect(parseDecimalInput('๑๒')!.toNumber()).toBe(12); expect(parseDecimalInput('abc')).toBeNull(); });
test('baht text', () => { expect(bahtText(D('1176.99'))).toBe('หนึ่งพันหนึ่งร้อยเจ็ดสิบหกบาทเก้าสิบเก้าสตางค์'); expect(bahtText(D(21))).toBe('ยี่สิบเอ็ดบาทถ้วน'); });
test('thai date + period', () => { const d = new Date('2026-11-01T18:30:00Z'); expect(formatThaiDate(d)).toBe('2 พ.ย. 2569'); expect(docPeriod(d)).toBe('6911'); });
```
- [ ] **Step 2:** `npm test -- tests/domain` → FAIL.
- [ ] **Step 3:** Implement. Configure `Decimal.set({ rounding: Decimal.ROUND_HALF_UP })` once in `money.ts`.
- [ ] **Step 4:** `npm test -- tests/domain` → PASS.
- [ ] **Step 5:** Commit `feat(domain): money, vat, wht, installments, thai helpers`.

---

### Task 3: Core schema, numbering, activity, notifications, settings

**Files:**
- Create: `src/db/schema/core.ts` (replace placeholder), `src/db/schema/master.ts`, `src/db/schema/activity.ts`, `src/server/services/numbering.ts`, `src/server/services/activity.ts`, `src/server/services/notifications.ts`, `src/server/services/settings.ts`, `tests/helpers/fixtures.ts`
- Test: `tests/services/numbering.test.ts`, `tests/services/settings.test.ts`

**Interfaces:**
- Schema (uuid PKs `defaultRandom()`, `createdAt/updatedAt` timestamptz on every table):
  - `users` {email unique, name, passwordHash, active bool}; `user_roles` {userId, role} with `Role = 'FOREMAN'|'ENGINEER'|'PM'|'PURCHASING'|'PURCHASING_HEAD'|'FINANCE'|'OWNER'|'ADMIN'`
  - `projects` {code unique, name, active}; `project_members` {projectId, userId} unique pair
  - `vendors` {code unique, name, type `'INDIVIDUAL'|'COMPANY'`, taxId (13 digits, nullable), branch (default `'00000'` = สำนักงานใหญ่), address, phone, bankName, bankAccountNo, bankAccountName, defaultCreditDays int default 30, defaultWhtRate int default 0, active}
  - `units` {name unique}; `items` {code unique, name, unitId, category nullable, active}
  - `settings` single row {companyName, companyAddress, companyTaxId, companyBranch, logoUrl nullable, poApprovalLimit numeric(14,2) default 50000}
  - `doc_counters` {prefix, period, last int} PK(prefix, period)
  - `activity_logs` {entityType, entityId, action, userId, note nullable, data jsonb nullable}
  - `comments` {entityType, entityId, userId, body}
  - `attachments` {entityType, entityId, url, name, size int, contentType, uploadedBy}
  - `notifications` {userId, title, href, readAt nullable}
- Produces:
  - `type EntityType = 'PR'|'PO'|'RECEIPT'|'INVOICE'|'PAYABLE'|'PV'|'CLOSE_SHORT'`
  - `nextDocNumber(tx: Db, prefix: 'PR'|'PO'|'PV'|'WHT', at: Date): Promise<string>` — `INSERT … ON CONFLICT DO UPDATE SET last = last+1 RETURNING last`
  - `logActivity(tx: Db, e: {entityType: EntityType; entityId: string; action: string; userId: string; note?: string; data?: unknown}): Promise<void>`
  - `listActivity(db: Db, entityType: EntityType, entityId: string)` → rows with user name, newest first
  - `notify(tx: Db, userIds: string[], n: {title: string; href: string}): Promise<void>` (dedupe ids); `usersWithRole(tx: Db, roles: Role[], projectId?: string): Promise<string[]>` (when projectId given, for FOREMAN/ENGINEER/PM only members)
  - `getSettings(db: Db): Promise<Settings>` (creates default row if missing); `updateSettings(db, actor, patch)` (ADMIN/OWNER)
  - fixtures: `seedBasics(db): Promise<{ users: Record<'foreman'|'pm'|'buyer'|'buyerHead'|'finance'|'owner'|'admin'|'otherForeman', SessionUser>; projectA: string; projectB: string; vendorCo: string; vendorPerson: string; itemCement: string }>` — foreman + pm in projectA, otherForeman in projectB, vendorCo COMPANY credit 30 WHT 0, vendorPerson INDIVIDUAL WHT 3. (`SessionUser` type is defined in Task 4; fixtures file is extended there.)

- [ ] **Step 1: Write failing tests**
```ts
test('numbers increment per prefix/month and use BE year', async () => {
  const db = await createTestDb(); const at = new Date('2026-11-02T03:00:00Z');
  expect(await nextDocNumber(db,'PO',at)).toBe('PO-6911-0001');
  expect(await nextDocNumber(db,'PO',at)).toBe('PO-6911-0002');
  expect(await nextDocNumber(db,'PR',at)).toBe('PR-6911-0001');
  expect(await nextDocNumber(db,'PO',new Date('2026-12-01T03:00:00Z'))).toBe('PO-6912-0001');
});
test('settings default limit 50000', async () => { const db = await createTestDb(); expect((await getSettings(db)).poApprovalLimit).toBe('50000.00'); });
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement schema + services; `npm run db:generate`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(db): core/master schema, numbering, activity, notifications, settings`.

---

### Task 4: Auth, session, policy

**Files:**
- Create: `src/server/auth/password.ts`, `src/server/auth/session.ts`, `src/server/auth/current-user.ts`, `src/server/policy.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/proxy.ts`, `src/db/seed.ts`
- Modify: `tests/helpers/fixtures.ts`
- Test: `tests/services/policy.test.ts`, `tests/services/auth.test.ts`

**Interfaces:**
- Produces:
  - `type SessionUser = { id: string; name: string; email: string; roles: Role[]; projectIds: string[] }`
  - `hashPassword(p: string): Promise<string>`, `verifyPassword(p, hash): Promise<boolean>` (bcryptjs, cost 10)
  - `authenticate(db: Db, email: string, password: string): Promise<SessionUser | null>` (inactive → null)
  - `createSessionCookie(userId: string): Promise<void>` / `destroySession()` — JWT (jose HS256, `AUTH_SECRET`, 30 days) in httpOnly cookie `ktec_session`
  - `getCurrentUser(): Promise<SessionUser | null>` (loads fresh roles/projects from DB each request); `requireUser(): Promise<SessionUser>` (redirect `/login`)
  - `type Action = 'pr.create'|'pr.approve'|'po.manage'|'po.approve'|'receipt.create'|'invoice.manage'|'payable.request'|'pv.manage'|'pv.approve'|'pv.pay'|'closeShort.approve'|'master.manage'|'users.manage'|'settings.manage'|'export.view'|'project.view'`
  - `can(u: SessionUser, a: Action, ctx?: { projectId?: string | null; createdBy?: string; gross?: Decimal; poApprovalLimit?: Decimal }): boolean`; `assertCan(...)` throws `DomainError('FORBIDDEN', 'ไม่มีสิทธิ์', 403)`
  - Rules: `project.view`/`pr.create`/`receipt.create` → FOREMAN/ENGINEER/PM need membership of `projectId`; office POs (`projectId null`) `receipt.create` → PURCHASING/PURCHASING_HEAD/ADMIN. `pr.approve` → PM member. `po.manage`/`payable.request` → PURCHASING/PURCHASING_HEAD. `po.approve` → per Global Constraints (uses `gross`, `poApprovalLimit`, `createdBy`). `invoice.manage`/`pv.manage` → FINANCE. `pv.approve`/`closeShort.approve` → OWNER. `pv.pay` → FINANCE or OWNER. `master.manage` → PURCHASING/PURCHASING_HEAD/ADMIN. `users.manage`/`settings.manage` → ADMIN (settings also OWNER). `export.view` → FINANCE/OWNER. OWNER and ADMIN pass `project.view` for all projects.
  - Seed: `npm run db:seed` creates default units (ถุง, คิว, เส้น, ชิ้น, ตร.ม., ม., กก., ตัน, ชุด, งาน) and the first ADMIN+OWNER user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, idempotent.
  - `src/proxy.ts`: redirect unauthenticated requests (no cookie) for all paths except `/login`, `/_next`, static assets, to `/login`. Real checks stay in `requireUser` + services.

- [ ] **Step 1: Write failing tests**
```ts
test('foreman can receive only in own project', () => {
  expect(can(f.foreman,'receipt.create',{projectId:f.projectA})).toBe(true);
  expect(can(f.foreman,'receipt.create',{projectId:f.projectB})).toBe(false);
  expect(can(f.foreman,'receipt.create',{projectId:null})).toBe(false);
});
test('po approval routes by limit', () => {
  const lim = D(50000);
  expect(can(f.buyerHead,'po.approve',{gross:D('49999.99'),poApprovalLimit:lim,createdBy:f.buyer.id})).toBe(true);
  expect(can(f.buyerHead,'po.approve',{gross:D(50000),poApprovalLimit:lim,createdBy:f.buyer.id})).toBe(false);
  expect(can(f.owner,'po.approve',{gross:D(900000),poApprovalLimit:lim,createdBy:f.owner.id})).toBe(true);
  expect(can(f.buyerHead,'po.approve',{gross:D(10),poApprovalLimit:lim,createdBy:f.buyerHead.id})).toBe(false);
});
test('only owner approves pv', () => { expect(can(f.owner,'pv.approve')).toBe(true); expect(can(f.finance,'pv.approve')).toBe(false); });
test('authenticate rejects wrong password and inactive', async () => { /* seed user, expect null for bad pw, SessionUser for good, null after active=false */ });
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; login page (email, password, error "อีเมลหรือรหัสผ่านไม่ถูกต้อง"). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(auth): session login, role/project policy, seed`.

---

### Task 5: App shell, shared UI, master data, import, settings, users

**Files:**
- Create: `src/app/(app)/layout.tsx` (sidebar on desktop, bottom nav on mobile, notification bell), `src/components/app-shell.tsx`, `src/components/money-input.tsx`, `src/components/doc-status-badge.tsx`, `src/components/activity-feed.tsx`, `src/components/attachments.tsx`, `src/components/comment-box.tsx`, `src/components/approval-bar.tsx` (approve / reject-with-reason dialog), `src/lib/image-resize.ts`, `src/app/api/upload/route.ts`, `src/server/services/attachments.ts`, `src/server/services/master.ts`, `src/server/services/import.ts`, pages under `src/app/(app)/master/{projects,vendors,items,users}/`, `src/app/(app)/settings/page.tsx`
- Test: `tests/services/master.test.ts`, `tests/services/import.test.ts`

**Interfaces:**
- Produces:
  - `storeFile(file: File, actor: SessionUser): Promise<{url: string; name: string; size: number; contentType: string}>` — `@vercel/blob` `put` when `BLOB_READ_WRITE_TOKEN` set; else writes to `.uploads/` served by `GET /api/upload?f=` (dev only). Max 10 MB.
  - `addAttachment(db, actor, {entityType, entityId, file})`, `listAttachments(db, entityType, entityId)`, `addComment(db, actor, {entityType, entityId, body})`
  - `resizeImage(file: File): Promise<File>` (browser, canvas; non-images returned unchanged)
  - `upsertProject / upsertVendor / upsertItem / upsertUser(db, actor, input)` with zod: vendor `taxId` exactly 13 digits when provided; `branch` 5 digits; user roles non-empty; `setProjectMembers(db, actor, projectId, userIds)`; `resetPassword(db, actor, userId, newPassword)`
  - `importVendors(db, actor, rows: Record<string,string>[]): Promise<{created: number; updated: number; errors: {row: number; message: string}[]}>` and `importItems(...)` same shape; upsert by `code`; Thai column headers accepted (`รหัส, ชื่อ, ประเภท, เลขผู้เสียภาษี, สาขา, ที่อยู่, โทร, ธนาคาร, เลขบัญชี, ชื่อบัญชี, เครดิต(วัน), หัก ณ ที่จ่าย(%)` / items: `รหัส, ชื่อ, หน่วย, หมวด` — unknown unit is created). Page parses CSV/XLSX with exceljs client-side → rows.
  - `MoneyInput` uses `parseDecimalInput`, displays `1,234.50` on blur.
  - `DocStatusBadge` maps every status in this plan to a Thai label + color (single map in `src/components/doc-status-badge.tsx`).
- [ ] **Step 1: Write failing tests**
```ts
test('vendor taxId must be 13 digits', async () => { await expect(upsertVendor(db,f.users.buyer,{...v, taxId:'123'})).rejects.toThrow(DomainError); });
test('foreman cannot manage vendors', async () => { await expect(upsertVendor(db,f.users.foreman,v)).rejects.toMatchObject({status:403}); });
test('import vendors upserts by code and reports bad rows', async () => {
  const r = await importVendors(db,f.users.buyer,[{รหัส:'V100',ชื่อ:'ร้าน ก',ประเภท:'นิติบุคคล'},{รหัส:'',ชื่อ:'x'}]);
  expect(r).toMatchObject({created:1,updated:0}); expect(r.errors[0].row).toBe(2);
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement services + pages. **Step 4:** Run → PASS; `npm run build` passes.
- [ ] **Step 5:** Manual check: `npm run dev`, log in as seeded admin, create project/vendor/item/user, view at 375px width. Commit `feat: app shell, master data, import, settings, users`.

---

### Task 6: PR

**Files:**
- Create: `src/db/schema/pr.ts`, `src/server/services/pr.ts`, `src/app/(app)/pr/page.tsx` (list + filters), `src/app/(app)/pr/new/page.tsx`, `src/app/(app)/pr/[id]/page.tsx`, `src/app/(app)/pr/actions.ts`
- Test: `tests/services/pr.test.ts`

**Interfaces:**
- Schema: `prs` {number unique (assigned at creation), projectId, requestedBy, status `PrStatus`, note, rejectReason nullable, approvedBy, approvedAt}; `pr_lines` {prId, itemId nullable, description, unitName, qty numeric(14,3), estUnitPrice numeric nullable, neededDate date nullable, note}
- `type PrStatus = 'DRAFT'|'SUBMITTED'|'APPROVED'|'REJECTED'|'CANCELLED'|'CLOSED'`; ordering progress (`ยังไม่สั่ง`/`สั่งบางส่วน`/`สั่งครบ`) is **computed**, not stored.
- Produces:
  - `createPr(db, actor, {projectId, note?, lines: PrLineInput[]}): Promise<{id: string; number: string}>` (status DRAFT; number from `nextDocNumber('PR')`)
  - `updatePr(db, actor, id, input)` (DRAFT/REJECTED only, by requester); `submitPr(db, actor, id)` (→ SUBMITTED, notify project PMs); `approvePr(db, actor, id)`; `rejectPr(db, actor, id, reason: string)` (→ REJECTED, reason required, notify requester); `cancelPr(db, actor, id)` (only if nothing ordered); `closePr(db, actor, id)` (APPROVED → CLOSED by PM or PURCHASING)
  - `getPr(db, actor, id)` → PR + lines each with `orderedQty: Decimal` and `remainingQty: Decimal` (orderedQty = Σ po_lines.qty for this prLine where PO status ≠ CANCELLED — po_lines introduced in Task 7; until then return 0 via a function `orderedQtyByPrLine(db, prLineIds)` that Task 7 fills in) and `orderProgress: 'NONE'|'PARTIAL'|'FULL'`
  - `listPrs(db, actor, filters: {projectId?, status?, q?, from?, to?})` — scoped by membership for site roles
  - `listOrderablePrLines(db, actor, {projectId?})` → approved PR lines with remainingQty > 0 (used by Task 7)
- [ ] **Step 1: Write failing tests**
```ts
test('foreman creates, PM approves', async () => { const pr = await createPr(db,f.users.foreman,{projectId:f.projectA,lines:[line]}); await submitPr(db,f.users.foreman,pr.id); await approvePr(db,f.users.pm,pr.id); expect((await getPr(db,f.users.pm,pr.id)).status).toBe('APPROVED'); });
test('foreman cannot create PR in other project', async () => { await expect(createPr(db,f.users.foreman,{projectId:f.projectB,lines:[line]})).rejects.toMatchObject({status:403}); });
test('reject requires reason, keeps number and history on resubmit', async () => {
  const pr = await createPr(...); await submitPr(...);
  await expect(rejectPr(db,f.users.pm,pr.id,' ')).rejects.toThrow(DomainError);
  await rejectPr(db,f.users.pm,pr.id,'จำนวนเกิน'); await updatePr(db,f.users.foreman,pr.id,{lines:[{...line,qty:D(5)}]}); await submitPr(db,f.users.foreman,pr.id);
  const got = await getPr(db,f.users.pm,pr.id); expect(got.number).toBe(pr.number); expect(got.status).toBe('SUBMITTED');
  expect((await listActivity(db,'PR',pr.id)).map(a=>a.action)).toEqual(['submit','update','reject','submit','create']);
});
test('submitting a PR with zero lines fails', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement service + pages (line editor: pick item or free text, qty, unit, needed date; photo attachments on detail page; `ApprovalBar` for PM). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(pr): purchase requisition workflow`.

---

### Task 7: PO core (create, revise, approve, order, cancel)

**Files:**
- Create: `src/db/schema/po.ts`, `src/domain/po-approval.ts`, `src/server/services/po.ts`
- Modify: `src/server/services/pr.ts` (`orderedQtyByPrLine` real implementation)
- Test: `tests/services/po.test.ts`, `tests/domain/po-approval.test.ts`

**Interfaces:**
- Schema:
  - `pos` {number, projectId nullable (null = สำนักงาน/ส่วนกลาง), vendorId, createdBy, status `PoStatus`, paymentType `'CREDIT'|'PREPAID'|'INSTALLMENT'`, creditDays int nullable, vatMode, billDiscount, shipping, beforeVat, vat, gross (stored, recomputed on apply), deliveryDate nullable, deliveryAddress, note, currentRevision int default 0, approvedRevision int nullable, pendingRevision jsonb nullable, approvedBy, approvedAt, orderedAt, rejectReason, closedShort bool default false}
  - `po_lines` {poId, prLineId nullable, itemId nullable, description, unitName, qty numeric(14,3), unitPrice, discount, sort int, allocatedBeforeVat, vat, gross, unitGross numeric(18,6)} — live (approved or draft) lines
  - `po_installments` {poId, seq, name, percent numeric(5,2) nullable, amount numeric(14,2), condition `'BEFORE_PRODUCTION'|'BEFORE_DELIVERY'|'AFTER_DELIVERY'|'OTHER'`, conditionNote, status `'PENDING'|'REQUESTED'|'PAID'|'CANCELLED'`}
  - `po_revisions` {poId, revision, payload jsonb, createdBy, approvedBy nullable, approvedAt nullable, reason}
- `type PoStatus = 'DRAFT'|'PENDING_APPROVAL'|'APPROVED'|'REJECTED'|'ORDERED'|'COMPLETED'|'CANCELLED'`
- `type PoInput = { projectId: string|null; vendorId: string; paymentType; creditDays?: number; vatMode; billDiscount: Decimal; shipping: Decimal; deliveryDate?; deliveryAddress?; note?; lines: { id?: string; prLineId?: string; itemId?: string; description: string; unitName: string; qty: Decimal; unitPrice: Decimal; discount: Decimal }[]; installments?: { name: string; percent?: Decimal; amount?: Decimal; condition; conditionNote?: string }[] }`
- Produces:
  - `requiredPoApprover(gross: Decimal, limit: Decimal): 'PURCHASING_HEAD'|'OWNER'` (pure)
  - `createPo(db, actor, input: PoInput)`: `{id, number}`; validates: INSTALLMENT requires installments (via `splitInstallments` on gross), CREDIT requires creditDays (default vendor's), PR lines must be APPROVED, same project as PO, and `qty ≤ remainingQty`.
  - `updatePo(db, actor, id, input)` — DRAFT/REJECTED: edits live rows directly. APPROVED/ORDERED: stores `pendingRevision` (= full PoInput + `reason`), `currentRevision+1`, status stays as is but `hasPendingRevision` shown; validation: for every existing line, new qty ≥ receivedQty; new gross ≥ Σ gross of PVs in PENDING_APPROVAL/APPROVED/PAID for this PO; lines with receipts cannot be removed. Receipts/PVs continue against live (approved) rows.
  - `submitPo(db, actor, id)` → PENDING_APPROVAL (initial) or marks revision pending approval; notifies approvers per `requiredPoApprover`.
  - `approvePo(db, actor, id)` — `assertCan('po.approve', {gross, poApprovalLimit, createdBy})` using **new** gross for revisions; initial → APPROVED; revision → applies payload to live rows (recompute totals with `computeDocTotals`, re-split PENDING installments only), writes `po_revisions` row, `approvedRevision = currentRevision`.
  - `rejectPo(db, actor, id, reason)` — initial → REJECTED; revision → discards `pendingRevision`.
  - `markOrdered(db, actor, id)` APPROVED → ORDERED; `cancelPo(db, actor, id, reason)` — throws `DomainError('PO_HAS_ACTIVITY', …, 409)` if any receipt or non-cancelled payable exists.
  - `getPo(db, actor, id)` (enforces `project.view` for site roles; site roles may only view POs of their projects) and `listPos(db, actor, filters)`.
  - `lockPo(tx, id)` — `SELECT … FOR UPDATE`, used by Tasks 9–12.
- [ ] **Step 1: Write failing tests**
```ts
test('routing', () => { expect(requiredPoApprover(D('49999.99'),D(50000))).toBe('PURCHASING_HEAD'); expect(requiredPoApprover(D(50000),D(50000))).toBe('OWNER'); });
test('po from PR splits PR across vendors and tracks ordered qty', async () => {
  // PR line qty 100; PO1 vendorCo 60, PO2 vendorPerson 40; third PO with qty 1 rejected
  expect((await getPr(db,f.users.pm,pr.id)).lines[0].orderProgress).toBe('FULL');
  await expect(createPo(db,f.users.buyer,{...poInput, lines:[{prLineId, qty:D(1), ...}]})).rejects.toThrow(DomainError);
});
test('office PO without PR', async () => { const po = await createPo(db,f.users.buyer,{...poInput, projectId:null}); expect(po.number).toMatch(/^PO-\d{4}-\d{4}$/); });
test('buyer head cannot approve PO at limit; owner can', ...);
test('creator (buyerHead) cannot approve own PO', ...);
test('installments must total 100%', ...);
test('revision after receipt cannot drop qty below received', async () => { /* uses receipt service stub: insert receipt row directly via fixtures helper `receiveDirect(db, poLineId, qty)` */ });
test('reject → edit → resubmit keeps PO number', ...);
test('cancel blocked after receipt', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(po): purchase order core with revisions and approval routing`.

---

### Task 8: PO UI

**Files:**
- Create: `src/app/(app)/po/page.tsx`, `src/app/(app)/po/new/page.tsx` (option "จาก PR" → pick orderable PR lines grouped by project; or blank), `src/app/(app)/po/[id]/page.tsx`, `src/app/(app)/po/[id]/edit/page.tsx`, `src/app/(app)/po/actions.ts`, `src/components/po-form.tsx`, `src/components/installment-editor.tsx`

**Interfaces:**
- Consumes: Task 7 services, Task 13 `summarizePo` (detail page shows a placeholder summary card until Task 13 lands; Task 13 wires it in).
- Form shows live totals using `computeDocTotals` client-side (same pure function). Installment editor: rows of name / % / condition, running total, must reach 100%.
- Detail page sections: header + status badge, lines with ordered/received qty, installments table, approval bar (only for allowed approver; shows "ต้องให้เจ้าของอนุมัติ" vs "หัวหน้าจัดซื้ออนุมัติได้"), pending revision diff (old vs new qty/price/gross per line), receipts list, payables/PVs list, attachments, comments, activity.
- [ ] **Step 1:** Implement pages.
- [ ] **Step 2:** `npm run build` passes; `npm test` still passes.
- [ ] **Step 3:** Manual check in dev: PR → PO (2 vendors), approve as buyerHead under limit, revise after approve and see diff. Commit `feat(po): PO screens`.

---

### Task 9: Goods receipt + mobile receive screen

**Files:**
- Create: `src/db/schema/receipt.ts`, `src/server/services/receipt.ts`, `src/app/(app)/receive/page.tsx` (POs awaiting receipt in my projects, big cards), `src/app/(app)/receive/[poId]/page.tsx` (qty steppers per line, delivery note no., photos, note, big "ยืนยันรับของ"), `src/app/(app)/receive/actions.ts`
- Test: `tests/services/receipt.test.ts`

**Interfaces:**
- Schema: `receipts` {poId, poRevision int, receivedAt date, deliveryNoteNo, note, receivedBy, status `'CONFIRMED'|'CANCELLED'`, cancelReason}; `receipt_lines` {receiptId, poLineId, qty numeric(14,3)}. (Phase 2 will post these to a stock ledger; keep `receipt_lines` immutable once confirmed.)
- Produces:
  - `createReceipt(db, actor, {poId, receivedAt, deliveryNoteNo?, note?, lines: {poLineId: string; qty: Decimal}[]}): Promise<{id: string}>` — `lockPo`; PO status must be APPROVED or ORDERED (APPROVED auto-advances to ORDERED); `assertCan('receipt.create', {projectId: po.projectId})`; each qty > 0 and `received + qty ≤ line.qty` else `DomainError('OVER_RECEIPT', 'รับเกินจำนวนที่สั่ง', 409)`; records `poRevision = approvedRevision`; notifies PO creator + FINANCE.
  - `cancelReceipt(db, actor, receiptId, reason)` — PURCHASING_HEAD or OWNER only; blocked if PO already COMPLETED.
  - `receivedQtyByPoLine(db, poId): Promise<Map<string, Decimal>>`
  - `listReceivablePos(db, actor)` — POs in APPROVED/ORDERED with any remaining qty, scoped to actor's projects (office POs for purchasing/admin).
- [ ] **Step 1: Write failing tests**
```ts
test('partial receipts accumulate', async () => { await createReceipt(db,f.users.foreman,{poId,lines:[{poLineId,qty:D(40)}],receivedAt}); await createReceipt(...qty:D(20)); expect((await receivedQtyByPoLine(db,poId)).get(poLineId)!.toString()).toBe('60'); });
test('over-receipt rejected', async () => { await expect(createReceipt(...qty:D('60.001'))).rejects.toMatchObject({code:'OVER_RECEIPT'}); });
test('second identical submit after full receipt fails (double tap)', async () => { await createReceipt(...qty:D(100)); await expect(createReceipt(...qty:D(100))).rejects.toMatchObject({code:'OVER_RECEIPT'}); });
test('foreman of other project forbidden', async () => { await expect(createReceipt(db,f.users.otherForeman,{...})).rejects.toMatchObject({status:403}); });
test('cannot receive PO pending first approval', ...);
test('decimal qty 2.5 accepted', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement service + mobile pages (use `resizeImage` before upload; buttons ≥ 48px; "รับครบทุกรายการ" shortcut fills remaining qty). **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual check at 375px width. Commit `feat(receipt): goods receipt with mobile screen`.

---

### Task 10: Invoices, payables, tax-invoice matching, disbursement requests

**Files:**
- Create: `src/db/schema/finance.ts` (invoices, payables, invoice_payable_matches; PV tables added in Task 11 in the same file), `src/server/services/invoice.ts`, `src/server/services/payable.ts`, `src/app/(app)/invoices/{page,new/page,[id]/page}.tsx`, `src/app/(app)/payables/page.tsx` (queue for FINANCE: open payables by due date), `src/app/(app)/invoices/actions.ts`
- Test: `tests/services/invoice-payable.test.ts`

**Interfaces:**
- Schema:
  - `invoices` {poId, vendorId, invoiceNo, invoiceDate, isTaxInvoice bool default true, beforeVat, vat, gross, dueDate nullable, status `'ACTIVE'|'CANCELLED'`, createdBy}; unique (vendorId, invoiceNo) among ACTIVE
  - `payables` {sourceType `'CREDIT_INVOICE'|'PREPAID_REQUEST'|'INSTALLMENT'` (future: `'CONTRACTOR_CLAIM'|'LABOR'|'EXPENSE'`), poId nullable, vendorId, invoiceId nullable, installmentId nullable, beforeVat, vat, gross, dueDate, status `'OPEN'|'IN_PV'|'PAID'|'CANCELLED'`, requestedBy, note}
  - `invoice_payable_matches` {invoiceId, payableId, gross}
- Produces:
  - `createInvoice(db, actor, {poId, invoiceNo, invoiceDate, beforeVat, vat, gross?, dueDate?})` — FINANCE; gross = beforeVat+vat if omitted (must equal if given). If PO paymentType CREDIT: dueDate defaults to invoiceDate + po.creditDays; auto-creates a `CREDIT_INVOICE` payable with same amounts and an exact match row. If PREPAID/INSTALLMENT: no payable; invoice is a tax invoice to be matched (`matchInvoice`). Returns `{id, warnings: string[]}`; warning `'INVOICE_EXCEEDS_PO'` (`ยอดใบแจ้งหนี้สะสมเกินยอด PO`) when Σ active invoice gross > po.gross.
  - `matchInvoice(db, actor, invoiceId, matches: {payableId: string; gross: Decimal}[])` — payables must belong to same PO; Σ matched per invoice ≤ invoice gross; Σ matched per payable ≤ payable gross.
  - `cancelInvoice(db, actor, id, reason)` — blocked if its CREDIT_INVOICE payable is IN_PV/PAID.
  - `requestPrepaid(db, actor, poId, note?)` — PURCHASING; PO paymentType PREPAID and status APPROVED/ORDERED; creates `PREPAID_REQUEST` payable for (po.gross − Σ non-cancelled payables gross); amounts split beforeVat/vat proportionally to PO totals (`allocate`); dueDate today; error `'NOTHING_TO_REQUEST'` if ≤ 0. Notifies FINANCE.
  - `requestInstallment(db, actor, installmentId, note?)` — PURCHASING; installment PENDING → REQUESTED; payable `INSTALLMENT` for installment.amount with beforeVat/vat split by PO ratio.
  - `listOpenPayables(db, actor, {vendorId?, dueBefore?})`
  - `poMoneyFacts(db, poId): Promise<PoMoneyFacts>` — raw sums consumed by `summarizePo` (Task 13): `{ poGross, payablesGross, taxInvoiceGross, matchedGross, pvPendingGross, pvApprovedGross, paidGross, receivedGross }` (pv/paid fields read Task 11 tables; return 0 until they exist).
- [ ] **Step 1: Write failing tests**
```ts
test('credit invoice creates payable with due date from credit days', async () => { const inv = await createInvoice(db,f.users.finance,{poId:creditPo, invoiceNo:'IV1', invoiceDate:'2026-11-02', beforeVat:D(1000), vat:D(70)}); const [p] = await listOpenPayables(db,f.users.finance,{}); expect(p).toMatchObject({sourceType:'CREDIT_INVOICE', gross:'1070.00', dueDate:'2026-12-02'}); });
test('prepaid: request creates payable, later tax invoice is matched not double-counted', async () => {
  await requestPrepaid(db,f.users.buyer,prepaidPo); const inv = await createInvoice(db,f.users.finance,{poId:prepaidPo,...});
  expect((await listOpenPayables(db,f.users.finance,{})).length).toBe(1);
  await matchInvoice(db,f.users.finance,inv.id,[{payableId, gross:D('1070.00')}]);
  expect((await poMoneyFacts(db,prepaidPo)).payablesGross.toFixed(2)).toBe('1070.00');
});
test('second prepaid request with nothing left fails', ...);
test('installment request marks REQUESTED and creates payable of its amount', ...);
test('invoice over PO total returns warning', ...);
test('foreman cannot create invoice', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement service + pages (PO detail gets "ขอเบิก" buttons for PREPAID and per installment). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(finance): invoices, payables, tax invoice matching, disbursement requests`.

---

### Task 11: PV (payment voucher) + payment

**Files:**
- Modify: `src/db/schema/finance.ts`
- Create: `src/server/services/pv.ts`, `src/app/(app)/pv/{page,new/page,[id]/page}.tsx`, `src/app/(app)/pv/actions.ts`
- Test: `tests/services/pv.test.ts`

**Interfaces:**
- Schema: `pvs` {number, vendorId, status `PvStatus`, note, createdBy, submittedAt, approvedBy, approvedAt, rejectReason, overrideReason nullable, paidAt date, payMethod `'TRANSFER'|'CHEQUE'|'CASH'` nullable, payFromAccount, payRef, paidBy, beforeVat, vat, gross, wht, net, whtCertId nullable}; `pv_lines` {pvId, payableId unique among non-cancelled PVs, beforeVat, vat, gross, whtRate int, wht, net}
- `type PvStatus = 'DRAFT'|'PENDING_APPROVAL'|'APPROVED'|'REJECTED'|'PAID'|'CANCELLED'`
- Produces:
  - `createPv(db, actor, {vendorId, payableIds: string[], whtRates?: Record<payableId, number>, note?})` — FINANCE; all payables OPEN and same vendor; line amounts copied from payable; whtRate default vendor.defaultWhtRate; `wht = computeWht(beforeVat, rate)`; `net = gross − wht`; payables → IN_PV.
  - `updatePv(db, actor, id, {payableIds, whtRates, note})` — DRAFT/REJECTED only; releases removed payables to OPEN.
  - `submitPv(db, actor, id)` → PENDING_APPROVAL; notify OWNER.
  - `approvePv(db, actor, id, overrideReason?: string)` — OWNER; for each PO touched, `lockPo` then check `Σ gross of PV lines (PENDING_APPROVAL+APPROVED+PAID, including this) ≤ po.gross`; else require non-empty `overrideReason`, otherwise `DomainError('OVERPAY', 'ยอดจ่ายเกินยอด PO', 409)`; notify FINANCE.
  - `rejectPv(db, actor, id, reason)` → REJECTED (payables stay IN_PV for editing); `cancelPv(db, actor, id, reason)` (not PAID) → payables OPEN.
  - `markPvPaid(db, actor, id, {paidAt, payMethod, payFromAccount?, payRef?})` — FINANCE or OWNER; APPROVED → PAID; payables → PAID; INSTALLMENT payable → installment PAID; if Σ wht > 0 calls `issueWhtCert` (Task 16) — until Task 16 exists, leave `whtCertId` null (Task 16 adds the call). Attach slip via attachments.
  - `listPvs(db, actor, filters)`, `getPv(db, actor, id)` (lines with PO number, invoice no., installment name)
- [ ] **Step 1: Write failing tests**
```ts
test('PV with WHT 3% on VAT-inclusive PO uses before-VAT', async () => { /* PO INCLUSIVE gross 1070 → payable beforeVat 1000 vat 70; PV whtRate 3 */ expect(pv).toMatchObject({gross:'1070.00', wht:'30.00', net:'1040.00'}); });
test('cannot put same payable in two PVs', ...);
test('owner approves, finance pays, payables PAID, installment PAID', ...);
test('overpay blocked without reason, allowed with reason (logged)', ...);
test('double approve call is idempotent-safe: second call fails with status error', ...);
test('finance cannot approve', ...);
test('cancel releases payables to OPEN', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement service + pages (new PV page: choose vendor → tick open payables → per-line WHT select → totals; detail: approval bar for OWNER, "บันทึกการจ่าย" form for FINANCE/OWNER, slip upload). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(pv): payment vouchers, approval, overpay guard, payment recording`.

---

### Task 12: Close-short (ปิดยอดค้างรับ)

**Files:**
- Create: `src/domain/close-short.ts`, `src/server/services/close-short.ts`; add `close_short_requests` table to `src/db/schema/po.ts`
- Modify: `src/app/(app)/po/[id]/page.tsx` (request button for purchasing, approval for owner)
- Test: `tests/domain/close-short.test.ts`, `tests/services/close-short.test.ts`

**Interfaces:**
- Schema: `close_short_requests` {poId, reason, requestedBy, status `'PENDING'|'APPROVED'|'REJECTED'`, decidedBy, decidedAt, rejectReason}
- Produces:
  - `rescaleInstallments(newGross: Decimal, installments: {id: string; amount: Decimal; status: 'PENDING'|'REQUESTED'|'PAID'|'CANCELLED'}[]): { updates: {id: string; amount: Decimal; status: 'PENDING'|'CANCELLED'}[]; refundDue: Decimal }` — kept = REQUESTED+PAID amounts; remaining = newGross − Σkept; remaining > 0 → PENDING ones scaled proportionally (`allocate`) to sum to remaining; remaining ≤ 0 → all PENDING cancelled, `refundDue = −remaining`; no PENDING and remaining > 0 → add nothing, remaining stays unpaid (reported via summary `remaining`).
  - `requestCloseShort(db, actor, poId, reason)` — PURCHASING; PO ORDERED with at least one receipt and some unreceived qty; one PENDING request per PO.
  - `approveCloseShort(db, actor, requestId)` — OWNER; `lockPo`; sets each po_line.qty = receivedQty (lines with 0 received get qty 0), recompute totals via `computeDocTotals`, apply `rescaleInstallments`, set `closedShort = true`, log activity with before/after gross; PR remaining qty reopens automatically because `orderedQtyByPrLine` sums po_lines.qty.
  - `rejectCloseShort(db, actor, requestId, reason)`
- [ ] **Step 1: Write failing tests**
```ts
test('rescale: deposit paid, rest scaled', () => {
  const r = rescaleInstallments(D(600),[{id:'a',amount:D(200),status:'PAID'},{id:'b',amount:D(300),status:'PENDING'},{id:'c',amount:D(500),status:'PENDING'}]);
  expect(r.updates.map(u=>u.amount.toFixed(2))).toEqual(['150.00','250.00']); expect(r.refundDue.toFixed(2)).toBe('0.00');
});
test('rescale: paid more than new total → refund due, pending cancelled', () => {
  const r = rescaleInstallments(D(150),[{id:'a',amount:D(200),status:'PAID'},{id:'b',amount:D(800),status:'PENDING'}]);
  expect(r.updates).toEqual([{id:'b',amount:D(0),status:'CANCELLED'}]); expect(r.refundDue.toFixed(2)).toBe('50.00');
});
test('approve close-short lowers PO gross to received value and reopens PR qty', ...);
test('cannot close-short PO with no receipts', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(po): close-short with installment rescale`.

---

### Task 13: PO summary & status labels

**Files:**
- Create: `src/domain/po-summary.ts`, `src/components/po-summary-card.tsx`
- Modify: `src/server/services/invoice.ts` (`poMoneyFacts` — fill pv/paid/received fields), `src/app/(app)/po/[id]/page.tsx`, `src/app/(app)/po/page.tsx` (badges in list), `src/server/services/po.ts` (auto COMPLETED: after receipt/payment/close-short, if receive FULL and pay FULL → status COMPLETED)
- Test: `tests/domain/po-summary.test.ts`

**Interfaces:**
- `receivedGross` = Σ over lines (receivedQty × unitGross), round2.
- Produces: `summarizePo(f: PoMoneyFacts & { orderedQtyTotal: Decimal; receivedQtyTotal: Decimal; paymentType; installments: {name: string; amount: Decimal; status: string}[]; refundDue: Decimal }): PoSummary` where `PoSummary = { poGross, receivedGross, payablesGross, pvApprovedGross, paidGross, remainingToPay: Decimal /* poGross − paidGross, min 0 */; receiveStatus: 'NONE'|'PARTIAL'|'FULL'; payStatus: 'UNPAID'|'PARTIAL'|'PAID'; paidNotReceived: boolean /* paidGross > receivedGross */; paidNotReceivedAmount: Decimal; missingTaxInvoice: boolean /* paidGross > taxInvoiceGross */; refundDue: Decimal; installments: (as given) }`
- Thai labels: `รอรับของ / รับบางส่วน / รับครบ`, `ยังไม่จ่าย / จ่ายบางส่วน / จ่ายครบ`, `จ่ายแล้ว ของยังไม่มา`, `ยังไม่ได้ใบกำกับภาษี`, `รอคืนเงินจากผู้ขาย`.
- [ ] **Step 1: Write failing tests**
```ts
test('prepaid paid, nothing received → paidNotReceived', () => { const s = summarizePo({...base, paidGross:D(1070), receivedGross:D(0), taxInvoiceGross:D(0)}); expect(s).toMatchObject({paidNotReceived:true, missingTaxInvoice:true, payStatus:'PAID', receiveStatus:'NONE'}); });
test('credit received partially, unpaid', () => expect(summarizePo({...base, receivedQtyTotal:D(40), orderedQtyTotal:D(100), receivedGross:D(428), paidGross:D(0)})).toMatchObject({receiveStatus:'PARTIAL', payStatus:'UNPAID', paidNotReceived:false}));
test('installment deposit 20% paid during production shows label', ...);
test('WHT does not make a fully paid PO look partial', () => { /* paidGross is gross incl. WHT */ });
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + wire card. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(po): money summary and status labels`.

---

### Task 14: Inbox, owner dashboard, notification bell

**Files:**
- Create: `src/server/services/inbox.ts`, `src/server/services/dashboard.ts`, `src/app/(app)/inbox/page.tsx` (default landing after login), `src/app/(app)/dashboard/page.tsx`, `src/components/notification-bell.tsx`
- Test: `tests/services/inbox.test.ts`, `tests/services/dashboard.test.ts`

**Interfaces:**
- Produces:
  - `getInbox(db, actor): Promise<{ key: InboxKey; label: string; count: number; items: {id: string; number: string; title: string; href: string; amount?: string; date: string}[] }[]>` with `InboxKey`: `PR_TO_APPROVE` (PM members), `PR_TO_ORDER` (approved PR lines with remaining qty; PURCHASING), `PO_TO_APPROVE` (respecting routing/limit/creator rule), `PO_TO_ORDER` (APPROVED; PURCHASING), `PO_TO_RECEIVE` (site roles in project / purchasing for office), `PAYABLES_OPEN` (FINANCE), `PV_TO_APPROVE` (OWNER), `PV_TO_PAY` (FINANCE/OWNER), `MY_REJECTED` (docs I created now REJECTED), `CLOSE_SHORT_TO_APPROVE` (OWNER). Empty groups omitted.
  - `getOwnerDashboard(db, actor, {today: Date})` (OWNER/FINANCE): `{ outstandingByVendor: {vendorId, name, gross}[] /* open+in-PV payables */, dueSoon: payables due within 7 days, overdue: payables past due, paidNotReceived: {poId, number, vendor, amount}[], pendingApprovals: {po: number; pv: number; closeShort: number}, purchasesByProject: {projectId|null, name, gross}[] /* approved POs this month and YTD */ }`
  - `listNotifications(db, actor)`, `markAllRead(db, actor)`; bell polls every 60 s via a server action.
- [ ] **Step 1: Write failing tests**
```ts
test('buyer head sees only under-limit POs to approve, owner sees all', ...);
test('foreman inbox shows POs to receive only for own project', ...);
test('dashboard dueSoon/overdue split by today', async () => { /* payables due 2026-11-05 and 2026-10-30, today 2026-11-02 */ });
test('paidNotReceived lists prepaid PO after payment', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement services + pages (dashboard as cards + tables; amounts formatted `฿1,234.50`). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: inbox, owner dashboard, notifications`.

---

### Task 15: PDFs (PR, PO, PV)

**Files:**
- Create: `src/pdf/fonts/Sarabun-Regular.ttf`, `Sarabun-Bold.ttf` (download from Google Fonts, OFL; commit with `OFL.txt`), `src/pdf/layout.tsx`, `src/pdf/pr.tsx`, `src/pdf/po.tsx`, `src/pdf/pv.tsx`, `src/app/api/pdf/[kind]/[id]/route.ts`
- Test: `tests/services/pdf.test.ts`

**Interfaces:**
- Produces: `renderDocPdf(db, actor, kind: 'pr'|'po'|'pv', id: string): Promise<Buffer>` — permission checked via the matching `get*` service; route returns `application/pdf` inline with filename `<number>.pdf`.
- Layout: A4, company logo/name/address/tax ID from settings; doc title Thai + English (`ใบขอซื้อ / Purchase Requisition`, `ใบสั่งซื้อ / Purchase Order`, `ใบสำคัญจ่าย / Payment Voucher`); BE dates; line table; totals with `bahtText(gross)` (PV uses `bahtText(net)`); PO prints payment terms and installment table; PV prints lines with PO/invoice refs and WHT; signature boxes: PR `ผู้ขอซื้อ / ผู้ตรวจสอบ (PM)`, PO `ผู้จัดทำ / ผู้อนุมัติ`, PV `ผู้จัดทำ / ผู้อนุมัติ / ผู้รับเงิน`. Draft/unapproved docs get a diagonal `ร่าง` watermark.
- [ ] **Step 1: Write failing test**
```ts
test('po pdf renders thai text', async () => { const buf = await renderDocPdf(db,f.users.buyer,'po',poId); expect(buf.subarray(0,4).toString()).toBe('%PDF'); expect(buf.length).toBeGreaterThan(5000); });
test('foreman of other project cannot fetch PO pdf', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; register fonts with `Font.register`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual: open each PDF in browser, check Thai vowels/tone marks render correctly. Commit `feat(pdf): PR, PO, PV documents`.

---

### Task 16: 50 ทวิ certificates + monthly Excel exports

**Files:**
- Create: `wht_certs` table in `src/db/schema/finance.ts`, `src/server/services/wht-cert.ts`, `src/pdf/wht50.tsx`, `src/server/services/exports.ts`, `src/app/api/export/[kind]/route.ts`, `src/app/(app)/exports/page.tsx`
- Modify: `src/server/services/pv.ts` (`markPvPaid` calls `issueWhtCert`), `src/app/api/pdf/[kind]/[id]/route.ts` (kind `wht`)
- Test: `tests/services/wht-export.test.ts`

**Interfaces:**
- Schema: `wht_certs` {number (`WHT-YYMM-####` by paidAt), pvId unique, vendorId, formType `'PND3'|'PND53'` (INDIVIDUAL → PND3, COMPANY → PND53), paidAt, incomeType default `'ค่าจ้างทำของ/ค่าบริการ'` (editable text), basis numeric (Σ beforeVat of lines with wht > 0), wht, status `'ACTIVE'|'VOID'`}
- Produces:
  - `issueWhtCert(tx, pvId): Promise<string | null>` (null when Σ wht = 0); `voidWhtCert(db, actor, certId, reason)` (FINANCE/OWNER)
  - `renderDocPdf` kind `'wht'` → 50 ทวิ layout: payer (company) name/tax ID/address, payee name/tax ID/branch/address, form checkbox ภ.ง.ด.3 or ภ.ง.ด.53, date paid (BE), income type, amount paid (basis), tax withheld, `bahtText(wht)`, "หัก ณ ที่จ่าย" checked, signature line.
  - `exportMonthly(db, actor, kind: 'pv-paid'|'purchase-vat'|'wht', period: {year: number /* CE */; month: number}): Promise<Buffer>` (xlsx via exceljs; `export.view`):
    - `pv-paid`: PV no., paid date, vendor, tax ID, PO no(s)., beforeVat, VAT, gross, WHT, net, method, ref
    - `purchase-vat` (by invoiceDate, isTaxInvoice, ACTIVE): date, invoice no., vendor, tax ID, branch, beforeVat, VAT, gross, PO no.
    - `wht`: two sheets `ภ.ง.ด.3` and `ภ.ง.ด.53`: cert no., paid date, payee, tax ID, branch, address, income type, rate, basis, wht
    - Month boundaries computed in Asia/Bangkok.
- [ ] **Step 1: Write failing tests**
```ts
test('paying PV with WHT issues PND3 cert for individual vendor', async () => { /* vendorPerson, wht 3% */ expect(cert).toMatchObject({formType:'PND3', wht:'30.00'}); expect(cert.number).toMatch(/^WHT-\d{4}-0001$/); });
test('no cert when wht is 0', ...);
test('wht export splits sheets by form type', async () => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await exportMonthly(db,f.users.finance,'wht',{year:2026,month:11})); expect(wb.worksheets.map(s=>s.name)).toEqual(['ภ.ง.ด.3','ภ.ง.ด.53']); expect(wb.getWorksheet('ภ.ง.ด.3')!.rowCount).toBe(2); });
test('payment on 2026-11-30 23:30 Bangkok counts in November', ...);
test('buyer cannot export', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: 50 ทวิ certificates and monthly accountant exports`.

---

### Task 17: End-to-end flow tests, deploy setup

**Files:**
- Create: `tests/flows/credit.test.ts`, `tests/flows/prepaid.test.ts`, `tests/flows/installment.test.ts`, `README.md` (Thai + English: setup, env vars, seed, deploy), `vercel.json` only if needed (none expected)
- Modify: `.env.example` (`DATABASE_URL`, `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`)

**Interfaces:**
- Consumes: all services. No new production interfaces.

- [ ] **Step 1: Write flow tests** (each runs entirely through services with fixture users):
  - credit: PR(foreman) → approve(pm) → PO credit 30 days (buyer) → approve(buyerHead, under limit) → ordered → receive 60% then 40% (foreman) → invoice (finance) → PV with WHT 0 → approve(owner) → paid → `summarizePo` = `{receiveStatus:'FULL', payStatus:'PAID'}` and PO status `COMPLETED`.
  - prepaid: PO without PR (office, projectId null) prepaid, gross ≥ limit → owner approves → requestPrepaid → PV → approve → paid → summary `paidNotReceived: true` → buyer receives all → `paidNotReceived: false` → tax invoice recorded and matched → `missingTaxInvoice: false`, `COMPLETED`.
  - installment: 20/30/40/10 on gross 100,000.00 → request + pay #1 and #2 → receive 50% → close-short approved → PO gross 50,000.00; paid 50,000.00 = new gross → remaining 0 → installments #3 and #4 `CANCELLED`, `refundDue` 0 → PO `COMPLETED`.
- [ ] **Step 2:** Run `npm test` → all PASS (fix any service bugs found, in the owning service with a focused test).
- [ ] **Step 3:** `npm run lint` and `npm run build` pass.
- [ ] **Step 4:** Deploy prep (needs user's Vercel account; run only with user present): `vercel link`, add Neon Postgres via Vercel Marketplace and Vercel Blob store, set `AUTH_SECRET`, `SEED_ADMIN_*`; run `npm run db:migrate && npm run db:seed` against prod `DATABASE_URL`; `vercel deploy`. Document every command in README.
- [ ] **Step 5:** Commit `test: end-to-end procurement flows; docs: setup and deploy`.

---

## Self-Review Notes

- Spec coverage: §4.1 → T6; §4.2 → T7/T8; §4.3 → T9; §4.4 → T10; §4.5 → T11; §4.6 → T13; §4.7 → T10/T13; §4.8 → T2/T11/T13; §4.9 → T12; §4.10 → T7/T9; §5 screens → T5/T6/T8/T9/T10/T11/T14; §6 rules → Global Constraints + T3/T4/T7/T11; §7 notifications → T3/T14; §8 PDF → T15; §8.1 → T16; §9 import → T5; §10 tech → T1/T4/T5/T17.
- Phase-2 hooks: `payables.sourceType` extensible and `poId` nullable; `receipt_lines` immutable for future stock ledger.
