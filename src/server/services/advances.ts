import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  advanceExpenses,
  advances,
  projects,
  receiptSubstituteLines,
  receiptSubstitutes,
  users,
  type SessionUser,
} from '@/db/schema';
import {
  EXPENSE_EVIDENCE,
  advanceBalance,
  clearingStatus,
  type AdvanceStatus,
  type ExpenseEvidence,
  type ReceiptSubstituteStatus,
} from '@/domain/advance';
import { DomainError } from '@/domain/errors';
import { D, Decimal, round2, sum } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const money = (msg: string) => z.number().finite().min(0, msg).max(10_000_000_000_000);

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, code = 'INVALID_ADVANCE'): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError(code, r.error.issues[0].message);
  return r.data;
}

function uuidOr404(id: string, what: string) {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', `ไม่พบ${what}`, 404);
}

async function assertProject(tx: Db, actor: SessionUser, projectId: string | null) {
  if (!projectId) return;
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('INVALID_ADVANCE', 'ไม่พบโครงการ');
  assertCan(actor, 'project.view', { projectId });
}

// ───────────────────────────── Advances ─────────────────────────────

const advanceSchema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  requestDate: isoDate.optional(),
  purpose: z.string().trim().min(1, 'กรุณาระบุวัตถุประสงค์').max(1000),
  amount: z.number().finite().positive('จำนวนเงินต้องมากกว่า 0').max(10_000_000_000_000),
});
export type AdvanceInput = z.input<typeof advanceSchema>;

export async function requestAdvance(db: Db, actor: SessionUser, input: AdvanceInput): Promise<{ id: string; number: string }> {
  assertCan(actor, 'advance.request');
  const d = parse(advanceSchema, input);
  return db.transaction(async (tx) => {
    await assertProject(tx, actor, d.projectId);
    const number = await nextDocNumber(tx, 'ADV');
    const [row] = await tx
      .insert(advances)
      .values({
        number,
        payeeId: actor.id,
        projectId: d.projectId,
        requestDate: d.requestDate ?? bangkokDateString(),
        purpose: d.purpose,
        amount: D(d.amount).toFixed(2),
        createdBy: actor.id,
      })
      .returning();
    await logActivity(tx, { entityType: 'ADVANCE', entityId: row.id, action: 'REQUEST', userId: actor.id });
    const approvers = await usersWithRole(tx, ['GENERAL_MANAGER', 'OWNER', 'ADMIN']);
    await notify(tx, approvers, { title: `${number} ขอเงินทดรองจ่าย ${D(d.amount).toFixed(2)} บาท`, href: '/advances', category: 'FINANCE' });
    return { id: row.id, number };
  });
}

async function lockAdvance(tx: Db, id: string) {
  uuidOr404(id, 'ใบขอเงินทดรอง');
  const [a] = await tx.select().from(advances).where(eq(advances.id, id)).for('update');
  if (!a) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอเงินทดรอง', 404);
  return a;
}

export async function decideAdvance(db: Db, actor: SessionUser, id: string, approve: boolean, noteInput: string): Promise<void> {
  assertCan(actor, 'advance.approve');
  const note = noteInput.trim().slice(0, 1000);
  if (!approve && !note) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  await db.transaction(async (tx) => {
    const a = await lockAdvance(tx, id);
    if (a.status !== 'PENDING') throw new DomainError('INVALID_STATE', 'ใบขอเงินทดรองนี้ไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    if (a.payeeId === actor.id) throw new DomainError('SELF_APPROVAL', 'อนุมัติเงินทดรองของตนเองไม่ได้', 403);
    await tx
      .update(advances)
      .set({ status: approve ? 'APPROVED' : 'REJECTED', decidedBy: actor.id, decidedAt: new Date(), decisionNote: note, updatedAt: new Date() })
      .where(eq(advances.id, id));
    await logActivity(tx, { entityType: 'ADVANCE', entityId: id, action: approve ? 'APPROVE' : 'REJECT', userId: actor.id, note: note || undefined });
    await notify(tx, [a.payeeId], { title: `${a.number} ${approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`, href: '/advances', category: 'FINANCE' });
  });
}

export async function payAdvance(db: Db, actor: SessionUser, id: string, paidOn?: string): Promise<void> {
  assertCan(actor, 'advance.pay');
  const date = paidOn ? parse(isoDate, paidOn) : bangkokDateString();
  await db.transaction(async (tx) => {
    const a = await lockAdvance(tx, id);
    if (a.status !== 'APPROVED') throw new DomainError('INVALID_STATE', 'จ่ายได้เฉพาะใบที่อนุมัติแล้ว', 409);
    await tx.update(advances).set({ status: 'PAID', paidAt: date, paidBy: actor.id, updatedAt: new Date() }).where(eq(advances.id, id));
    await logActivity(tx, { entityType: 'ADVANCE', entityId: id, action: 'PAY', userId: actor.id });
    await notify(tx, [a.payeeId], { title: `${a.number} จ่ายเงินแล้ว กรุณาเคลียร์เมื่อใช้จ่ายเสร็จ`, href: '/advances', category: 'FINANCE' });
  });
}

export async function cancelAdvance(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const a = await lockAdvance(tx, id);
    if (a.payeeId !== actor.id && !can(actor, 'advance.approve')) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', 403);
    if (a.status !== 'PENDING' && a.status !== 'APPROVED') {
      throw new DomainError('INVALID_STATE', 'ยกเลิกได้เฉพาะใบที่ยังไม่จ่ายเงิน', 409);
    }
    await tx.update(advances).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(advances.id, id));
    await logActivity(tx, { entityType: 'ADVANCE', entityId: id, action: 'CANCEL', userId: actor.id });
  });
}

const expenseSchema = z.object({
  spentOn: isoDate.optional(),
  description: z.string().trim().min(1, 'กรุณาระบุรายการค่าใช้จ่าย').max(500),
  amount: z.number().finite().positive('จำนวนเงินต้องมากกว่า 0').max(10_000_000_000_000),
  evidence: z.enum(EXPENSE_EVIDENCE).default('RECEIPT'),
  reference: z.string().trim().max(200).default(''),
  substituteId: z.string().uuid().nullable().default(null),
});
export type AdvanceExpenseInput = z.input<typeof expenseSchema>;

const CLEARABLE: AdvanceStatus[] = ['PAID', 'PARTIALLY_CLEARED'];

async function refreshAdvanceStatus(tx: Db, a: typeof advances.$inferSelect) {
  const rows = await tx.select({ amount: advanceExpenses.amount }).from(advanceExpenses).where(eq(advanceExpenses.advanceId, a.id));
  const balance = advanceBalance(a.amount, rows.map((r) => r.amount), a.returnedAmount);
  const status = clearingStatus(balance);
  if (status !== a.status) await tx.update(advances).set({ status, updatedAt: new Date() }).where(eq(advances.id, a.id));
  return { balance, status };
}

function assertClearer(actor: SessionUser, a: typeof advances.$inferSelect) {
  if (a.payeeId !== actor.id && !can(actor, 'advance.pay')) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', 403);
  if (!CLEARABLE.includes(a.status)) throw new DomainError('INVALID_STATE', 'เคลียร์ได้เฉพาะเงินทดรองที่จ่ายแล้ว', 409);
}

/** เคลียร์เงินทดรอง: record an actual expense against a paid advance. */
export async function addAdvanceExpense(db: Db, actor: SessionUser, advanceId: string, input: AdvanceExpenseInput): Promise<void> {
  const d = parse(expenseSchema, input);
  await db.transaction(async (tx) => {
    const a = await lockAdvance(tx, advanceId);
    assertClearer(actor, a);
    if (d.evidence === 'SUBSTITUTE') {
      if (!d.substituteId) throw new DomainError('INVALID_ADVANCE', 'กรุณาเลือกใบรับรองแทนใบเสร็จ');
      const [rs] = await tx.select().from(receiptSubstitutes).where(eq(receiptSubstitutes.id, d.substituteId)).limit(1);
      if (!rs || rs.status !== 'APPROVED') throw new DomainError('INVALID_ADVANCE', 'ใบรับรองแทนใบเสร็จต้องอนุมัติแล้ว');
    }
    await tx.insert(advanceExpenses).values({
      advanceId,
      spentOn: d.spentOn ?? bangkokDateString(),
      description: d.description,
      amount: D(d.amount).toFixed(2),
      evidence: d.evidence as ExpenseEvidence,
      reference: d.reference,
      substituteId: d.evidence === 'SUBSTITUTE' ? d.substituteId : null,
      createdBy: actor.id,
    });
    await refreshAdvanceStatus(tx, a);
  });
}

export async function removeAdvanceExpense(db: Db, actor: SessionUser, expenseId: string): Promise<void> {
  uuidOr404(expenseId, 'รายการค่าใช้จ่าย');
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(advanceExpenses).where(eq(advanceExpenses.id, expenseId)).limit(1);
    if (!e) throw new DomainError('NOT_FOUND', 'ไม่พบรายการค่าใช้จ่าย', 404);
    const a = await lockAdvance(tx, e.advanceId);
    if (a.status === 'CLEARED') throw new DomainError('INVALID_STATE', 'เงินทดรองนี้เคลียร์ครบแล้ว', 409);
    assertClearer(actor, a);
    await tx.delete(advanceExpenses).where(eq(advanceExpenses.id, expenseId));
    await refreshAdvanceStatus(tx, a);
  });
}

/** คืนเงินสด: finance records cash returned; the advance clears when expenses + returned ≥ amount. */
export async function recordAdvanceReturn(db: Db, actor: SessionUser, advanceId: string, returnedInput: number): Promise<void> {
  assertCan(actor, 'advance.pay');
  const returned = parse(money('ยอดคืนต้องไม่ติดลบ'), returnedInput);
  await db.transaction(async (tx) => {
    const a = await lockAdvance(tx, advanceId);
    if (!CLEARABLE.includes(a.status) && a.status !== 'CLEARED') {
      throw new DomainError('INVALID_STATE', 'บันทึกเงินคืนได้เฉพาะเงินทดรองที่จ่ายแล้ว', 409);
    }
    const rows = await tx.select({ amount: advanceExpenses.amount }).from(advanceExpenses).where(eq(advanceExpenses.advanceId, advanceId));
    const spent = sum(rows.map((r) => D(r.amount)));
    const unspent = Decimal.max(D(0), D(a.amount).minus(spent));
    if (round2(D(returned)).gt(unspent)) {
      throw new DomainError('OVER_RETURN', 'ยอดคืนเกินยอดคงเหลือของเงินทดรอง', 409);
    }
    const [updated] = await tx
      .update(advances)
      .set({ returnedAmount: D(returned).toFixed(2), updatedAt: new Date() })
      .where(eq(advances.id, advanceId))
      .returning();
    await refreshAdvanceStatus(tx, updated);
  });
}

export interface AdvanceRow {
  id: string;
  number: string;
  payeeId: string;
  payeeName: string;
  projectId: string | null;
  projectName: string | null;
  requestDate: string;
  purpose: string;
  amount: number;
  status: AdvanceStatus;
  decisionNote: string;
  paidAt: string | null;
  spent: number;
  returned: number;
  outstanding: number;
  reimbursable: number;
}

export interface AdvanceList {
  rows: AdvanceRow[];
  totals: { paid: number; spent: number; outstanding: number };
  permissions: { approve: boolean; pay: boolean };
}

export async function listAdvances(db: Db, actor: SessionUser): Promise<AdvanceList> {
  const all = await db
    .select({ a: advances, payeeName: users.name, projectName: projects.name })
    .from(advances)
    .innerJoin(users, eq(users.id, advances.payeeId))
    .leftJoin(projects, eq(projects.id, advances.projectId))
    .orderBy(desc(advances.requestDate), desc(advances.createdAt));
  // Approvers and finance see everything; everyone else only their own requests
  const visible = can(actor, 'advance.approve') || can(actor, 'advance.pay') ? all : all.filter((r) => r.a.payeeId === actor.id);
  const ids = visible.map((r) => r.a.id);
  const exp = ids.length
    ? await db.select({ advanceId: advanceExpenses.advanceId, amount: advanceExpenses.amount }).from(advanceExpenses).where(inArray(advanceExpenses.advanceId, ids))
    : [];
  const byAdvance = new Map<string, string[]>();
  for (const e of exp) byAdvance.set(e.advanceId, [...(byAdvance.get(e.advanceId) ?? []), e.amount]);

  const rows = visible.map(({ a, payeeName, projectName }) => {
    const b = advanceBalance(a.amount, byAdvance.get(a.id) ?? [], a.returnedAmount);
    const live = a.status !== 'REJECTED' && a.status !== 'CANCELLED' && a.status !== 'PENDING' && a.status !== 'APPROVED';
    return {
      id: a.id,
      number: a.number,
      payeeId: a.payeeId,
      payeeName,
      projectId: a.projectId,
      projectName,
      requestDate: a.requestDate,
      purpose: a.purpose,
      amount: Number(a.amount),
      status: a.status,
      decisionNote: a.decisionNote,
      paidAt: a.paidAt,
      spent: b.spent.toNumber(),
      returned: b.returned.toNumber(),
      outstanding: live ? b.outstanding.toNumber() : 0,
      reimbursable: live ? b.reimbursable.toNumber() : 0,
    };
  });
  const paidRows = rows.filter((r) => r.paidAt);
  return {
    rows,
    totals: {
      paid: sum(paidRows.map((r) => D(r.amount))).toNumber(),
      spent: sum(paidRows.map((r) => D(r.spent))).toNumber(),
      outstanding: sum(rows.map((r) => D(r.outstanding))).toNumber(),
    },
    permissions: { approve: can(actor, 'advance.approve'), pay: can(actor, 'advance.pay') },
  };
}

export async function getAdvance(db: Db, actor: SessionUser, id: string) {
  const list = await listAdvances(db, actor);
  const row = list.rows.find((r) => r.id === id);
  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอเงินทดรอง', 404);
  const expenses = await db
    .select({ e: advanceExpenses, substituteNumber: receiptSubstitutes.number })
    .from(advanceExpenses)
    .leftJoin(receiptSubstitutes, eq(receiptSubstitutes.id, advanceExpenses.substituteId))
    .where(eq(advanceExpenses.advanceId, id))
    .orderBy(asc(advanceExpenses.spentOn), asc(advanceExpenses.createdAt));
  return {
    ...row,
    canClear: (row.payeeId === actor.id || list.permissions.pay) && CLEARABLE.includes(row.status),
    permissions: list.permissions,
    expenses: expenses.map(({ e, substituteNumber }) => ({
      id: e.id,
      spentOn: e.spentOn,
      description: e.description,
      amount: Number(e.amount),
      evidence: e.evidence,
      reference: e.reference,
      substituteId: e.substituteId,
      substituteNumber,
    })),
  };
}

// ───────────────────────────── Receipt substitutes ─────────────────────────────

const substituteLineSchema = z.object({
  spentOn: isoDate,
  description: z.string().trim().min(1, 'กรุณาระบุรายการ').max(500),
  paidTo: z.string().trim().max(300).default(''),
  amount: z.number().finite().positive('จำนวนเงินต้องมากกว่า 0').max(10_000_000_000_000),
});

const substituteSchema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  advanceId: z.string().uuid().nullable().default(null),
  docDate: isoDate.optional(),
  lines: z.array(substituteLineSchema).min(1, 'ต้องมีรายการอย่างน้อย 1 รายการ').max(100),
});
export type ReceiptSubstituteInput = z.input<typeof substituteSchema>;

async function lockSubstitute(tx: Db, id: string) {
  uuidOr404(id, 'ใบรับรองแทนใบเสร็จ');
  const [rs] = await tx.select().from(receiptSubstitutes).where(eq(receiptSubstitutes.id, id)).for('update');
  if (!rs) throw new DomainError('NOT_FOUND', 'ไม่พบใบรับรองแทนใบเสร็จ', 404);
  return rs;
}

async function writeSubstitute(tx: Db, actor: SessionUser, existing: typeof receiptSubstitutes.$inferSelect | null, d: z.output<typeof substituteSchema>) {
  await assertProject(tx, actor, d.projectId);
  if (d.advanceId) {
    const [a] = await tx.select().from(advances).where(eq(advances.id, d.advanceId)).limit(1);
    if (!a || a.payeeId !== actor.id) throw new DomainError('INVALID_SUBSTITUTE', 'อ้างอิงได้เฉพาะเงินทดรองของตนเอง');
  }
  const total = sum(d.lines.map((l) => D(l.amount)));
  const header = { projectId: d.projectId, advanceId: d.advanceId, docDate: d.docDate ?? bangkokDateString(), total: total.toFixed(2), updatedAt: new Date() };
  let id = existing?.id;
  if (id) {
    await tx.update(receiptSubstitutes).set(header).where(eq(receiptSubstitutes.id, id));
    await tx.delete(receiptSubstituteLines).where(eq(receiptSubstituteLines.substituteId, id));
  } else {
    const [row] = await tx.insert(receiptSubstitutes).values({ ...header, payerId: actor.id }).returning();
    id = row.id;
  }
  await tx.insert(receiptSubstituteLines).values(
    d.lines.map((l, i) => ({ substituteId: id!, sort: i, spentOn: l.spentOn, description: l.description, paidTo: l.paidTo, amount: D(l.amount).toFixed(2) })),
  );
  return id;
}

export async function createReceiptSubstitute(db: Db, actor: SessionUser, input: ReceiptSubstituteInput): Promise<{ id: string }> {
  const d = parse(substituteSchema, input, 'INVALID_SUBSTITUTE');
  return db.transaction(async (tx) => ({ id: await writeSubstitute(tx, actor, null, d) }));
}

export async function updateReceiptSubstitute(db: Db, actor: SessionUser, id: string, input: ReceiptSubstituteInput): Promise<void> {
  const d = parse(substituteSchema, input, 'INVALID_SUBSTITUTE');
  await db.transaction(async (tx) => {
    const rs = await lockSubstitute(tx, id);
    if (rs.payerId !== actor.id) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', 403);
    if (rs.status !== 'DRAFT' && rs.status !== 'REJECTED') throw new DomainError('INVALID_STATE', 'แก้ไขได้เฉพาะฉบับร่างหรือที่ถูกตีกลับ', 409);
    await writeSubstitute(tx, actor, rs, d);
  });
}

export async function submitReceiptSubstitute(db: Db, actor: SessionUser, id: string): Promise<string> {
  return db.transaction(async (tx) => {
    const rs = await lockSubstitute(tx, id);
    if (rs.payerId !== actor.id) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', 403);
    if (rs.status !== 'DRAFT' && rs.status !== 'REJECTED') throw new DomainError('INVALID_STATE', 'ส่งอนุมัติได้เฉพาะฉบับร่างหรือที่ถูกตีกลับ', 409);
    const number = rs.number ?? (await nextDocNumber(tx, 'RS'));
    await tx.update(receiptSubstitutes).set({ number, status: 'PENDING', decisionNote: '', updatedAt: new Date() }).where(eq(receiptSubstitutes.id, id));
    await logActivity(tx, { entityType: 'RECEIPT_SUBSTITUTE', entityId: id, action: 'SUBMIT', userId: actor.id });
    const approvers = await usersWithRole(tx, ['FINANCE', 'OWNER']);
    await notify(tx, approvers, { title: `${number} ใบรับรองแทนใบเสร็จรออนุมัติ`, href: '/receipt-substitutes', category: 'FINANCE' });
    return number;
  });
}

/** Finance or owner accepts the certification; approved substitutes can then clear advances. */
export async function decideReceiptSubstitute(db: Db, actor: SessionUser, id: string, approve: boolean, noteInput: string): Promise<void> {
  assertCan(actor, 'advance.pay');
  const note = noteInput.trim().slice(0, 1000);
  if (!approve && !note) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  await db.transaction(async (tx) => {
    const rs = await lockSubstitute(tx, id);
    if (rs.status !== 'PENDING') throw new DomainError('INVALID_STATE', 'เอกสารนี้ไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    if (rs.payerId === actor.id) throw new DomainError('SELF_APPROVAL', 'อนุมัติเอกสารของตนเองไม่ได้', 403);
    await tx
      .update(receiptSubstitutes)
      .set({ status: approve ? 'APPROVED' : 'REJECTED', decidedBy: actor.id, decisionNote: note, updatedAt: new Date() })
      .where(eq(receiptSubstitutes.id, id));
    await logActivity(tx, { entityType: 'RECEIPT_SUBSTITUTE', entityId: id, action: approve ? 'APPROVE' : 'REJECT', userId: actor.id, note: note || undefined });
    await notify(tx, [rs.payerId], { title: `${rs.number} ${approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`, href: '/receipt-substitutes', category: 'FINANCE' });
  });
}

export async function cancelReceiptSubstitute(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rs = await lockSubstitute(tx, id);
    if (rs.payerId !== actor.id && !can(actor, 'advance.pay')) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', 403);
    if (rs.status === 'APPROVED') {
      const [used] = await tx.select({ id: advanceExpenses.id }).from(advanceExpenses).where(eq(advanceExpenses.substituteId, id)).limit(1);
      if (used) throw new DomainError('IN_USE', 'เอกสารนี้ถูกใช้เคลียร์เงินทดรองแล้ว', 409);
    }
    if (rs.status === 'CANCELLED') throw new DomainError('INVALID_STATE', 'เอกสารนี้ยกเลิกแล้ว', 409);
    await tx.update(receiptSubstitutes).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(receiptSubstitutes.id, id));
  });
}

export interface ReceiptSubstituteRow {
  id: string;
  number: string | null;
  payerId: string;
  payerName: string;
  projectName: string | null;
  advanceNumber: string | null;
  docDate: string;
  total: number;
  status: ReceiptSubstituteStatus;
  decisionNote: string;
}

/** Finance/owner see every certificate; others only the ones they paid themselves. */
function selectVisibleSubstitutes(db: Db, actor: SessionUser, id?: string) {
  const filters = [
    can(actor, 'advance.pay') ? undefined : eq(receiptSubstitutes.payerId, actor.id),
    id ? eq(receiptSubstitutes.id, id) : undefined,
  ];
  return db
    .select({ rs: receiptSubstitutes, payerName: users.name, projectName: projects.name, advanceNumber: advances.number })
    .from(receiptSubstitutes)
    .innerJoin(users, eq(users.id, receiptSubstitutes.payerId))
    .leftJoin(projects, eq(projects.id, receiptSubstitutes.projectId))
    .leftJoin(advances, eq(advances.id, receiptSubstitutes.advanceId))
    .where(and(...filters))
    .orderBy(desc(receiptSubstitutes.docDate), desc(receiptSubstitutes.createdAt));
}

type VisibleSubstitute = Awaited<ReturnType<typeof selectVisibleSubstitutes>>[number];

function toSubstituteRow({ rs, payerName, projectName, advanceNumber }: VisibleSubstitute): ReceiptSubstituteRow {
  return {
    id: rs.id,
    number: rs.number,
    payerId: rs.payerId,
    payerName,
    projectName,
    advanceNumber,
    docDate: rs.docDate,
    total: Number(rs.total),
    status: rs.status,
    decisionNote: rs.decisionNote,
  };
}

export async function listReceiptSubstitutes(db: Db, actor: SessionUser): Promise<{ rows: ReceiptSubstituteRow[]; canDecide: boolean }> {
  const rows = await selectVisibleSubstitutes(db, actor);
  return { rows: rows.map(toSubstituteRow), canDecide: can(actor, 'advance.pay') };
}

export async function getReceiptSubstitute(db: Db, actor: SessionUser, id: string) {
  uuidOr404(id, 'ใบรับรองแทนใบเสร็จ');
  const [found] = await selectVisibleSubstitutes(db, actor, id);
  if (!found) throw new DomainError('NOT_FOUND', 'ไม่พบใบรับรองแทนใบเสร็จ', 404);
  const row = toSubstituteRow(found);
  const lines = await db
    .select()
    .from(receiptSubstituteLines)
    .where(eq(receiptSubstituteLines.substituteId, id))
    .orderBy(asc(receiptSubstituteLines.sort));
  return {
    ...row,
    projectId: found.rs.projectId,
    advanceId: found.rs.advanceId,
    // Mirrors decideReceiptSubstitute: approvers cannot decide their own certificate
    canDecide: can(actor, 'advance.pay') && row.payerId !== actor.id,
    canEdit: row.payerId === actor.id && (row.status === 'DRAFT' || row.status === 'REJECTED'),
    // Mirrors cancelReceiptSubstitute's permission check
    canCancel: row.status !== 'CANCELLED' && (row.payerId === actor.id || can(actor, 'advance.pay')),
    lines: lines.map((l) => ({ spentOn: l.spentOn, description: l.description, paidTo: l.paidTo, amount: Number(l.amount) })),
  };
}

/** Approved, unused substitutes of the actor, for the "clear advance" form. */
export async function listUsableSubstitutes(db: Db, actor: SessionUser) {
  const rows = await db
    .select({ id: receiptSubstitutes.id, number: receiptSubstitutes.number, total: receiptSubstitutes.total })
    .from(receiptSubstitutes)
    .where(and(eq(receiptSubstitutes.payerId, actor.id), eq(receiptSubstitutes.status, 'APPROVED')));
  return rows.map((r) => ({ id: r.id, number: r.number ?? '', total: Number(r.total) }));
}
