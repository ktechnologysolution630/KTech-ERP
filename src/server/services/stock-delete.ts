import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  invoices,
  poLines,
  pos,
  receiptLines,
  receipts,
  stockAdjustRequests,
  stockBalances,
  stockDocs,
  stockItems,
  stockMovements,
  type SessionUser,
} from '@/db/schema';

import { D, round2, sum, type Decimal } from '@/domain/money';
import { assertCan } from '@/server/policy';
import { guarded, logDeletes, notFound, outcome, parseIds, removeTraces, split, type DeleteOutcome } from './record-delete';

/**
 * Deleting what moved stock: PO goods receipts, stock documents, manual movements and unused stock items. A delete
 * takes the movements off the balances they changed and removes them in the same step, so the ledger, the monthly
 * flow and the site reports still add up. When the stock is no longer there (issued or moved on since), nothing is
 * removed and the reason says so.
 */

type Movement = typeof stockMovements.$inferSelect;

const STORE = (projectId: string | null) => (projectId ? 'ที่หน้างาน' : 'ในคลังกลาง');

/** The balance changes that undo these movements, by item and store (null = central store) */
function undoDeltas(rows: Movement[]): Map<string, { itemId: string; projectId: string | null; delta: Decimal }> {
  const out = new Map<string, { itemId: string; projectId: string | null; delta: Decimal }>();
  const add = (itemId: string, projectId: string | null, delta: Decimal) => {
    const key = `${itemId}|${projectId ?? ''}`;
    const prev = out.get(key);
    out.set(key, { itemId, projectId, delta: (prev?.delta ?? D(0)).plus(delta) });
  };
  for (const m of rows) {
    const qty = D(m.quantity);
    switch (m.type) {
      case 'RECEIVE':
      case 'RETURN':
        add(m.stockItemId, m.projectId, qty.neg());
        break;
      case 'ISSUE':
        add(m.stockItemId, m.projectId, qty);
        break;
      case 'TRANSFER':
        add(m.stockItemId, m.projectId, qty);
        add(m.stockItemId, m.targetProjectId, qty.neg());
        break;
      case 'ADJUST':
        // Stored signed
        add(m.stockItemId, m.projectId, qty.neg());
        break;
    }
  }
  return out;
}

/**
 * Takes the movements off the balances and removes them. Returns why it cannot, without changing anything, when a
 * store no longer holds what has to come out of it.
 */
export async function reverseMovements(tx: Db, rows: Movement[]): Promise<string | null> {
  if (rows.length === 0) return null;
  const deltas = [...undoDeltas(rows).values()].filter((d) => !d.delta.isZero());
  const itemIds = [...new Set(deltas.map((d) => d.itemId))].sort();
  // Same lock order as applyStockMovement: the item row first, so concurrent movements wait
  const items = itemIds.length ? await tx.select().from(stockItems).where(inArray(stockItems.id, itemIds)).orderBy(stockItems.id).for('update') : [];

  const balanceOf = async (itemId: string, projectId: string | null) => {
    const [row] = await tx
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.stockItemId, itemId), projectId ? eq(stockBalances.projectId, projectId) : isNull(stockBalances.projectId)))
      .limit(1);
    return row ?? null;
  };

  const plan: { row: typeof stockBalances.$inferSelect | null; itemId: string; projectId: string | null; next: Decimal }[] = [];
  for (const d of deltas) {
    const row = await balanceOf(d.itemId, d.projectId);
    const current = D(row?.quantity ?? 0);
    const next = current.plus(d.delta);
    if (next.lt(0)) {
      const item = items.find((i) => i.id === d.itemId);
      return `${item?.name ?? 'วัสดุ'} ถูกเบิกหรือโอนออกไปแล้ว คงเหลือ${STORE(d.projectId)}เพียง ${current.toNumber()} ${item?.unit ?? ''} ต้องคืนออก ${d.delta.neg().toNumber()}`.trim();
    }
    plan.push({ row, itemId: d.itemId, projectId: d.projectId, next });
  }

  for (const p of plan) {
    if (p.row) {
      await tx.update(stockBalances).set({ quantity: p.next.toFixed(3), updatedAt: new Date() }).where(eq(stockBalances.id, p.row.id));
    } else {
      await tx.insert(stockBalances).values({ stockItemId: p.itemId, projectId: p.projectId, warehouseName: p.projectId ? 'คลังหน้างาน' : 'คลังกลาง', quantity: p.next.toFixed(3) });
    }
  }
  await tx.delete(stockMovements).where(inArray(stockMovements.id, rows.map((m) => m.id)));

  // A receipt set the item's cost; without it, the latest receipt left decides
  const repriced = [...new Set(rows.filter((m) => m.type === 'RECEIVE').map((m) => m.stockItemId))];
  for (const itemId of repriced) {
    const [last] = await tx
      .select({ unitCost: stockMovements.unitCost })
      .from(stockMovements)
      .where(and(eq(stockMovements.stockItemId, itemId), eq(stockMovements.type, 'RECEIVE'), gt(stockMovements.unitCost, '0')))
      .orderBy(desc(stockMovements.createdAt))
      .limit(1);
    if (last) await tx.update(stockItems).set({ unitCost: last.unitCost, updatedAt: new Date() }).where(eq(stockItems.id, itemId));
  }
  return null;
}

// ───────────────────────────── PO goods receipts ─────────────────────────────

/** What the PO's confirmed receipts are worth, leaving one out */
async function receivedValueWithout(tx: Db, poId: string, receiptId: string): Promise<Decimal> {
  const rows = await tx
    .select({ qty: receiptLines.qty, unitGross: poLines.unitGross })
    .from(receiptLines)
    .innerJoin(receipts, and(eq(receipts.id, receiptLines.receiptId), eq(receipts.poId, poId), eq(receipts.status, 'CONFIRMED'), ne(receipts.id, receiptId)))
    .innerJoin(poLines, eq(poLines.id, receiptLines.poLineId));
  return round2(sum(rows.map((r) => D(r.qty).times(D(r.unitGross)))));
}

/** Rounding between line VAT and the bill's VAT may differ by a few satang, as when billing */
const RECEIVED_TOLERANCE = D(1);

/**
 * Why a receipt cannot come off its PO, or null: a closed PO keeps what it received, and a credit PO cannot be left
 * billed for more than it then holds.
 */
export async function receiptHold(
  tx: Db,
  receipt: { id: string; status: string },
  po: { id: string; status: string; closedShort: boolean; paymentType: string },
): Promise<string | null> {
  if (po.status === 'COMPLETED') return 'ใบสั่งซื้อปิดแล้ว (รับของและจ่ายเงินครบ) จึงลบหรือยกเลิกใบรับของไม่ได้';
  if (po.closedShort) return 'ใบสั่งซื้อปิดยอดค้างรับแล้ว จึงลบหรือยกเลิกใบรับของไม่ได้';
  if (po.paymentType === 'CREDIT' && receipt.status === 'CONFIRMED') {
    const [billed] = await tx
      .select({ gross: sql<string>`coalesce(sum(${invoices.gross}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.poId, po.id), eq(invoices.status, 'ACTIVE')));
    const left = await receivedValueWithout(tx, po.id, receipt.id);
    if (D(billed?.gross ?? 0).gt(left.plus(RECEIVED_TOLERANCE))) {
      return `วางบิลไปแล้ว ฿${D(billed!.gross).toFixed(2)} เกินมูลค่าของที่จะเหลือ ฿${left.toFixed(2)} ยกเลิกใบแจ้งหนี้ผู้ขายก่อน`;
    }
  }
  return null;
}

/** The movements a receipt put into stock */
export const receiptMovements = (tx: Db, receiptId: string) =>
  tx.select().from(stockMovements).where(and(eq(stockMovements.referenceType, 'RECEIPT'), eq(stockMovements.referenceId, receiptId)));

/**
 * Removes goods receipts from their PO, taking what they put into stock back out. The PO's received quantity is
 * worked out from its receipts, so it follows by itself and the goods can be received again.
 */
export async function deleteReceipts(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: receipts.id,
          status: receipts.status,
          receivedAt: receipts.receivedAt,
          deliveryNoteNo: receipts.deliveryNoteNo,
          poId: pos.id,
          poNumber: pos.number,
          poStatus: pos.status,
          closedShort: pos.closedShort,
          paymentType: pos.paymentType,
        })
        .from(receipts)
        .innerJoin(pos, eq(pos.id, receipts.poId))
        .where(inArray(receipts.id, picked))
        .orderBy(receipts.poId)
        .for('update', { of: pos });
      if (rows.length === 0) throw notFound('ใบรับของ');
      const result: DeleteOutcome = { deleted: [], kept: [] };
      for (const r of rows) {
        const number = `${r.poNumber} รับวันที่ ${r.receivedAt}${r.deliveryNoteNo ? ` (${r.deliveryNoteNo})` : ''}`;
        const hold = await receiptHold(tx, { id: r.id, status: r.status }, { id: r.poId, status: r.poStatus, closedShort: r.closedShort, paymentType: r.paymentType });
        const short = hold ? null : await reverseMovements(tx, await receiptMovements(tx, r.id));
        if (hold || short) {
          result.kept.push({ id: r.id, number, reason: (hold ?? short)! });
          continue;
        }
        await removeTraces(tx, [r.id]);
        // Lines go with the receipt (on delete cascade)
        await tx.delete(receipts).where(eq(receipts.id, r.id));
        await logDeletes(tx, actor, 'PO', [{ id: r.id, number, logEntityId: r.poId, action: 'RECEIPT_DELETED', note: `ลบใบรับของ ${number}` }]);
        result.deleted.push({ id: r.id, number });
      }
      return result;
    }),
  );
}

// ───────────────────────────── Stock documents and movements ─────────────────────────────

/** Receive, issue, transfer, borrow and material-usage documents, with what they moved */
export async function deleteStockDocs(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: stockDocs.id, number: stockDocs.number, accountingStatus: stockDocs.accountingStatus })
        .from(stockDocs)
        .where(inArray(stockDocs.id, picked))
        .orderBy(stockDocs.id)
        .for('update');
      if (targets.length === 0) throw notFound('เอกสารสต็อก');
      const result: DeleteOutcome = { deleted: [], kept: [] };
      for (const t of targets) {
        if (t.accountingStatus === 'POSTED') {
          result.kept.push({ id: t.id, number: t.number, reason: 'บัญชีลงบันทึกแล้ว ลบไม่ได้' });
          continue;
        }
        const moved = await tx.select().from(stockMovements).where(eq(stockMovements.docId, t.id));
        const short = await reverseMovements(tx, moved);
        if (short) {
          result.kept.push({ id: t.id, number: t.number, reason: short });
          continue;
        }
        await removeTraces(tx, [t.id]);
        await tx.delete(stockDocs).where(eq(stockDocs.id, t.id));
        await logDeletes(tx, actor, 'STOCK_DOC', [{ ...t, note: `ลบเอกสารสต็อก ${t.number}`, numbers: [t.number] }]);
        result.deleted.push({ id: t.id, number: t.number });
      }
      return result;
    }),
  );
}

/** Movements keyed in by hand or as opening stock; the rest go with the document they came from */
export async function deleteStockMovements(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx.select().from(stockMovements).where(inArray(stockMovements.id, picked));
      if (rows.length === 0) throw notFound('รายการเคลื่อนไหว');
      const docNumbers = new Map(
        (await tx.select({ id: stockDocs.id, number: stockDocs.number }).from(stockDocs).where(inArray(stockDocs.id, rows.map((r) => r.docId).filter((d): d is string => Boolean(d))))).map((d) => [d.id, d.number]),
      );
      const targets = rows.map((r) => ({ ...r, number: r.movementNumber }));
      const { go, kept } = split(targets, (m) => {
        if (m.docId) return `มาจากเอกสาร ${docNumbers.get(m.docId) ?? ''} ให้ลบที่เอกสารแทน`.replace('  ', ' ');
        if (m.referenceType === 'RECEIPT') return `มาจากใบรับของของ ${m.referenceNumber ?? 'ใบสั่งซื้อ'} ให้ลบที่หน้าใบสั่งซื้อแทน`;
        if (m.referenceType === 'ADJUSTMENT') return `มาจากคำขอปรับยอด ${m.referenceNumber ?? ''} ที่อนุมัติแล้ว ลบไม่ได้`.replace('  ', ' ');
        return null;
      });
      const deleted: typeof go = [];
      for (const m of go) {
        const short = await reverseMovements(tx, [m]);
        if (short) kept.push({ id: m.id, number: m.number, reason: short });
        else deleted.push(m);
      }
      if (deleted.length > 0) {
        await logDeletes(tx, actor, 'STOCK_DOC', deleted.map((m) => ({ id: m.id, number: m.number, note: `ลบรายการเคลื่อนไหว ${m.number} (${m.type} ${m.quantity})`, numbers: [m.number] })));
      }
      return outcome(deleted, kept);
    }),
  );
}

/** Stock items nothing ever moved; one with history stays */
export async function deleteStockItems(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'data.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx.select({ id: stockItems.id, sku: stockItems.sku, name: stockItems.name }).from(stockItems).where(inArray(stockItems.id, picked)).for('update');
      if (rows.length === 0) throw notFound('สินค้าในสต็อก');
      const targets = rows.map((r) => ({ id: r.id, number: `${r.sku} ${r.name}` }));
      const targetIds = targets.map((t) => t.id);
      const [moved, asked, held] = await Promise.all([
        tx.selectDistinct({ id: stockMovements.stockItemId }).from(stockMovements).where(inArray(stockMovements.stockItemId, targetIds)),
        tx.selectDistinct({ id: stockAdjustRequests.stockItemId }).from(stockAdjustRequests).where(inArray(stockAdjustRequests.stockItemId, targetIds)),
        tx.selectDistinct({ id: stockBalances.stockItemId }).from(stockBalances).where(and(inArray(stockBalances.stockItemId, targetIds), ne(stockBalances.quantity, '0'))),
      ]);
      const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id);
      const { go, kept } = split(targets, (t) => {
        if (has(moved, t.id)) return 'มีประวัติการเคลื่อนไหว ลบไม่ได้ (ลบเอกสารที่เกี่ยวข้องก่อน)';
        if (has(asked, t.id)) return 'มีคำขอปรับยอดอ้างถึง ลบคำขอนั้นก่อน';
        return has(held, t.id) ? 'ยังมียอดคงเหลืออยู่' : null;
      });
      if (go.length > 0) {
        // Balances and count lines go with it (on delete cascade); a PO line keeps its own description
        await tx.delete(stockItems).where(inArray(stockItems.id, go.map((t) => t.id)));
        await logDeletes(tx, actor, 'ITEM', go.map((t) => ({ ...t, note: `ลบสินค้าในสต็อก ${t.number}` })));
      }
      return outcome(go, kept);
    }),
  );
}

