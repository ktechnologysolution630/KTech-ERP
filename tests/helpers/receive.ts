import { and, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { receipts, type SessionUser } from '@/db/schema';
import { getPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';

/**
 * Receives every line of a PO in full, so a credit bill can be placed against it.
 * Does nothing when the PO already has a delivery, so it can sit before every bill.
 */
export async function receiveAll(db: Db, actor: SessionUser, poId: string, receivedAt = '2026-11-01') {
  const [already] = await db.select({ id: receipts.id }).from(receipts).where(and(eq(receipts.poId, poId), eq(receipts.status, 'CONFIRMED'))).limit(1);
  if (already) return;
  const po = await getPo(db, actor, poId);
  if (po.paymentType !== 'CREDIT') return;
  await createReceipt(db, actor, {
    poId,
    receivedAt,
    lines: po.lines.map((l) => ({ poLineId: l.id, qty: l.qty })),
  });
}

/** Tests approve vouchers whose bills fall due after today */
export const EARLY_PAY_REASON = 'ทดสอบ: จ่ายก่อนครบกำหนด';
