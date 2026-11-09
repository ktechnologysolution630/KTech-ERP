import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  boqLines,
  boqs,
  boqOverrunRequests,
  poLines,
  pos,
  projects,
  users,
  variationOrders,
  type BoqOverrunStatus,
  type PoStatus,
  type SessionUser,
} from '@/db/schema';
import { boqMaterialBudget, computeBoqOverrun, type BoqOverrunLine } from '@/domain/boq-overrun';
import { DomainError } from '@/domain/errors';
import { computeDocTotals, D, Decimal } from '@/domain/money';
import type { SerializedPoRevisionPayload } from './po';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';

/** POs whose lines already commit BOQ budget. Drafts, rejected and cancelled POs do not. */
const COMMITTING_STATUSES: PoStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'COMPLETED'];

/** Amount before VAT that live POs commit to each of the given BOQ lines. */
export async function committedByBoqLine(tx: Db, boqLineIds: string[]): Promise<Map<string, Decimal>> {
  const committed = new Map<string, Decimal>();
  if (boqLineIds.length === 0) return committed;
  const rows = await tx
    .select({ boqLineId: poLines.boqLineId, netBeforeVat: poLines.allocatedBeforeVat })
    .from(poLines)
    .innerJoin(pos, eq(pos.id, poLines.poId))
    .where(and(inArray(poLines.boqLineId, boqLineIds), inArray(pos.status, COMMITTING_STATUSES)));
  for (const r of rows) {
    if (r.boqLineId) committed.set(r.boqLineId, (committed.get(r.boqLineId) ?? D(0)).plus(r.netBeforeVat));
  }
  return committed;
}

export interface PoLineForBoq {
  boqLineId?: string | null;
  /** Line amount before VAT after bill discount and shipping allocation (po_lines.allocated_before_vat) */
  netBeforeVat: Decimal.Value;
}

export interface PoOverrun {
  lines: BoqOverrunLine[];
  overAmount: Decimal;
}

/** Over-BOQ amounts for a PO's lines; lines without a BOQ reference are not checked. */
export async function computePoOverrun(tx: Db, poId: string, lines: PoLineForBoq[]): Promise<PoOverrun> {
  const thisPo = new Map<string, Decimal>();
  for (const l of lines) {
    if (!l.boqLineId) continue;
    thisPo.set(l.boqLineId, (thisPo.get(l.boqLineId) ?? D(0)).plus(l.netBeforeVat));
  }
  if (thisPo.size === 0) return { lines: [], overAmount: D(0) };
  const ids = [...thisPo.keys()];

  const [boqRows, others] = await Promise.all([
    tx.select().from(boqLines).where(inArray(boqLines.id, ids)),
    tx
      .select({ boqLineId: poLines.boqLineId, netBeforeVat: poLines.allocatedBeforeVat })
      .from(poLines)
      .innerJoin(pos, eq(pos.id, poLines.poId))
      .where(and(inArray(poLines.boqLineId, ids), ne(pos.id, poId), inArray(pos.status, COMMITTING_STATUSES))),
  ]);

  const elsewhere = new Map<string, Decimal>();
  for (const o of others) {
    if (!o.boqLineId) continue;
    elsewhere.set(o.boqLineId, (elsewhere.get(o.boqLineId) ?? D(0)).plus(o.netBeforeVat));
  }
  return computeBoqOverrun({
    boqLines: boqRows.map((b) => ({
      id: b.id,
      no: b.no,
      description: b.description,
      qty: b.qty,
      materialRate: b.materialRate,
    })),
    thisPoByBoqLine: thisPo,
    committedElsewhereByBoqLine: elsewhere,
  });
}

/**
 * Approval gate used by `approvePo`: a PO that buys beyond the BOQ needs an approved AP for the
 * same revision covering at least the current overrun.
 */
export async function assertOverrunApproved(
  tx: Db,
  po: { id: string; number: string; currentRevision: number },
  lines: PoLineForBoq[],
): Promise<void> {
  const overrun = await computePoOverrun(tx, po.id, lines);
  if (overrun.overAmount.lte(0)) return;
  const approved = await tx
    .select({ overAmount: boqOverrunRequests.overAmount })
    .from(boqOverrunRequests)
    .where(
      and(
        eq(boqOverrunRequests.poId, po.id),
        eq(boqOverrunRequests.poRevision, po.currentRevision),
        eq(boqOverrunRequests.status, 'APPROVED'),
      ),
    );
  if (approved.some((a) => D(a.overAmount).gte(overrun.overAmount))) return;
  throw new DomainError(
    'BOQ_OVERRUN',
    `ใบสั่งซื้อ ${po.number} ซื้อเกิน BOQ ${overrun.overAmount.toFixed(2)} บาท ต้องได้รับอนุมัติใบ AP ก่อน`,
    409,
  );
}

/** Lines of the version awaiting approval: the pending revision if any, else the saved lines. */
async function linesUnderReview(tx: Db, po: typeof pos.$inferSelect): Promise<PoLineForBoq[]> {
  const pending = po.pendingRevision as SerializedPoRevisionPayload | null;
  if (pending?.lines) return revisionLinesForBoq(pending);
  return tx
    .select({ boqLineId: poLines.boqLineId, netBeforeVat: poLines.allocatedBeforeVat })
    .from(poLines)
    .where(eq(poLines.poId, po.id));
}

/** Before-VAT amounts of a pending revision, allocated the same way approval will store them. */
export function revisionLinesForBoq(payload: SerializedPoRevisionPayload): PoLineForBoq[] {
  const totals = computeDocTotals({
    vatMode: payload.vatMode,
    billDiscount: D(payload.billDiscount),
    shipping: D(payload.shipping),
    lines: payload.lines.map((l) => ({ qty: D(l.qty), unitPrice: D(l.unitPrice), discount: D(l.discount) })),
  });
  return payload.lines.map((l, i) => ({ boqLineId: l.boqLineId ?? null, netBeforeVat: totals.lines[i].allocatedBeforeVat }));
}

async function loadPo(db: Db, poId: string) {
  if (!z.string().uuid().safeParse(poId).success) throw new DomainError('NOT_FOUND', 'ไม่พบใบสั่งซื้อ', 404);
  const [po] = await db.select().from(pos).where(eq(pos.id, poId)).limit(1);
  if (!po) throw new DomainError('NOT_FOUND', 'ไม่พบใบสั่งซื้อ', 404);
  return po;
}

export interface BoqOverrunRequestDto {
  id: string;
  number: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  poId: string;
  poNumber: string;
  poRevision: number;
  overAmount: number;
  lines: BoqOverrunLine[];
  reason: string;
  status: BoqOverrunStatus;
  requestedByName: string;
  decidedByName: string | null;
  decisionNote: string;
  createdAt: string;
}

export interface PoBoqCheck {
  overAmount: number;
  lines: BoqOverrunLine[];
  requests: BoqOverrunRequestDto[];
  /** True when an approved AP for the current revision covers the overrun */
  covered: boolean;
  canRequest: boolean;
  canDecide: boolean;
}

async function requestDtos(db: Db, where: ReturnType<typeof eq> | undefined): Promise<BoqOverrunRequestDto[]> {
  const requester = users;
  const rows = await db
    .select({ r: boqOverrunRequests, poNumber: pos.number, project: projects, requestedByName: requester.name })
    .from(boqOverrunRequests)
    .innerJoin(pos, eq(pos.id, boqOverrunRequests.poId))
    .innerJoin(projects, eq(projects.id, boqOverrunRequests.projectId))
    .innerJoin(requester, eq(requester.id, boqOverrunRequests.requestedBy))
    .where(where)
    .orderBy(desc(boqOverrunRequests.createdAt));

  const deciderIds = [...new Set(rows.map((x) => x.r.decidedBy).filter((x): x is string => !!x))];
  const deciders = deciderIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, deciderIds))
    : [];
  const deciderName = new Map(deciders.map((d) => [d.id, d.name]));

  return rows.map(({ r, poNumber, project, requestedByName }) => ({
    id: r.id,
    number: r.number,
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    poId: r.poId,
    poNumber,
    poRevision: r.poRevision,
    overAmount: Number(r.overAmount),
    lines: r.lines,
    reason: r.reason,
    status: r.status,
    requestedByName,
    decidedByName: r.decidedBy ? deciderName.get(r.decidedBy) ?? null : null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Over-BOQ status of one PO for its detail page. */
export async function getPoBoqCheck(db: Db, actor: SessionUser, poId: string): Promise<PoBoqCheck> {
  const po = await loadPo(db, poId);
  if (po.projectId) assertCan(actor, 'project.view', { projectId: po.projectId });
  const overrun = await computePoOverrun(db, po.id, await linesUnderReview(db, po));
  const requests = await requestDtos(db, eq(boqOverrunRequests.poId, po.id));
  const covered = requests.some(
    (r) => r.status === 'APPROVED' && r.poRevision === po.currentRevision && D(r.overAmount).gte(overrun.overAmount),
  );
  const hasPending = requests.some((r) => r.status === 'PENDING' && r.poRevision === po.currentRevision);
  return {
    overAmount: overrun.overAmount.toNumber(),
    lines: overrun.lines,
    requests,
    covered: overrun.overAmount.lte(0) || covered,
    canRequest: can(actor, 'po.manage') && overrun.overAmount.gt(0) && !covered && !hasPending,
    canDecide: can(actor, 'boqOverrun.approve'),
  };
}

export interface BoqMaterialOption {
  id: string;
  projectId: string;
  /** "BOQ หลัก" or the VO number the line came from */
  source: string;
  no: string;
  description: string;
  unit: string;
  budget: number;
  committed: number;
  remaining: number;
}

/** Material lines of each visible project's main BOQ with what live POs already commit. */
export async function listBoqMaterialOptions(db: Db, actor: SessionUser): Promise<BoqMaterialOption[]> {
  const rows = await db
    .select({ line: boqLines, projectId: boqs.projectId, kind: boqs.kind, voNumber: variationOrders.number })
    .from(boqLines)
    .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
    .leftJoin(variationOrders, eq(variationOrders.id, boqs.voId))
    .where(
      and(
        eq(boqLines.isCategory, false),
        // Main BOQ, plus BOQs of approved variation orders
        or(eq(boqs.kind, 'MAIN'), and(eq(boqs.kind, 'VO'), eq(variationOrders.status, 'APPROVED'))),
      ),
    )
    .orderBy(boqs.projectId, boqs.kind, boqLines.sort);
  const visible = isSiteScopedOnly(actor) ? rows.filter((r) => actor.projectIds.includes(r.projectId)) : rows;
  if (visible.length === 0) return [];

  const committed = await committedByBoqLine(db, visible.map((r) => r.line.id));

  return visible
    .map(({ line, projectId, kind, voNumber }) => {
      const budget = boqMaterialBudget(line);
      const used = committed.get(line.id) ?? D(0);
      return {
        id: line.id,
        projectId,
        source: kind === 'VO' && voNumber ? voNumber : 'BOQ หลัก',
        no: line.no,
        description: line.description,
        unit: line.unit,
        budget: budget.toNumber(),
        committed: used.toNumber(),
        remaining: budget.minus(used).toNumber(),
      };
    })
    .filter((o) => o.budget > 0);
}

export async function listBoqOverrunRequests(db: Db, actor: SessionUser): Promise<BoqOverrunRequestDto[]> {
  const all = await requestDtos(db, undefined);
  return isSiteScopedOnly(actor) ? all.filter((r) => actor.projectIds.includes(r.projectId)) : all;
}

/** ขออนุมัติซื้อเกิน BOQ for the PO's version under review. */
export async function requestBoqOverrun(
  db: Db,
  actor: SessionUser,
  poId: string,
  reasonInput: string,
): Promise<{ id: string; number: string }> {
  assertCan(actor, 'po.manage');
  const reason = z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ต้องซื้อเกิน BOQ').max(1000).safeParse(reasonInput);
  if (!reason.success) throw new DomainError('INVALID_AP', reason.error.issues[0].message);

  return db.transaction(async (tx) => {
    const po = await loadPo(tx, poId);
    if (!po.projectId) throw new DomainError('INVALID_AP', 'PO ของสำนักงานไม่มี BOQ ให้ตรวจสอบ');
    if (po.status === 'CANCELLED' || po.status === 'COMPLETED') {
      throw new DomainError('INVALID_STATE', 'ใบสั่งซื้อนี้ปิดแล้ว', 409);
    }
    const overrun = await computePoOverrun(tx, po.id, await linesUnderReview(tx, po));
    if (overrun.overAmount.lte(0)) throw new DomainError('NO_OVERRUN', 'ใบสั่งซื้อนี้ไม่ได้ซื้อเกิน BOQ');

    const [pending] = await tx
      .select({ id: boqOverrunRequests.id })
      .from(boqOverrunRequests)
      .where(
        and(
          eq(boqOverrunRequests.poId, po.id),
          eq(boqOverrunRequests.poRevision, po.currentRevision),
          eq(boqOverrunRequests.status, 'PENDING'),
        ),
      )
      .limit(1);
    if (pending) throw new DomainError('AP_PENDING', 'มีใบ AP ของใบสั่งซื้อนี้รออนุมัติอยู่แล้ว', 409);

    const number = await nextDocNumber(tx, 'AP');
    const [row] = await tx
      .insert(boqOverrunRequests)
      .values({
        number,
        projectId: po.projectId,
        poId: po.id,
        poRevision: po.currentRevision,
        overAmount: overrun.overAmount.toFixed(2),
        lines: overrun.lines,
        reason: reason.data,
        requestedBy: actor.id,
      })
      .returning();

    await logActivity(tx, {
      entityType: 'PO',
      entityId: po.id,
      action: 'boq_overrun_request',
      userId: actor.id,
      note: `${number}: ซื้อเกิน BOQ ${overrun.overAmount.toFixed(2)} บาท`,
    });
    const owners = await usersWithRole(tx, ['OWNER']);
    await notify(tx, owners, {
      title: `${number} ขออนุมัติซื้อเกิน BOQ (PO ${po.number})`,
      href: `/po/${po.id}`,
      category: 'BOQ',
      level: 'OVER',
      projectId: po.projectId,
    });
    return { id: row.id, number };
  });
}

export async function decideBoqOverrun(
  db: Db,
  actor: SessionUser,
  requestId: string,
  approve: boolean,
  noteInput: string,
): Promise<void> {
  assertCan(actor, 'boqOverrun.approve');
  const note = noteInput.trim().slice(0, 1000);
  if (!approve && !note) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  if (!z.string().uuid().safeParse(requestId).success) throw new DomainError('NOT_FOUND', 'ไม่พบใบ AP', 404);

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(boqOverrunRequests)
      .set({
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedBy: actor.id,
        decidedAt: new Date(),
        decisionNote: note,
        updatedAt: new Date(),
      })
      .where(and(eq(boqOverrunRequests.id, requestId), eq(boqOverrunRequests.status, 'PENDING')))
      .returning();
    if (rows.length === 0) throw new DomainError('INVALID_STATE', 'ใบ AP นี้ไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    const r = rows[0];
    await logActivity(tx, {
      entityType: 'PO',
      entityId: r.poId,
      action: approve ? 'boq_overrun_approve' : 'boq_overrun_reject',
      userId: actor.id,
      note: `${r.number}${note ? `: ${note}` : ''}`,
    });
    await notify(tx, [r.requestedBy], {
      title: `${r.number} ${approve ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`,
      href: `/po/${r.poId}`,
      category: 'BOQ',
    });
  });
}
