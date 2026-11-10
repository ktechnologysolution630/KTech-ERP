import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { items, poLines, prLines, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';

const idsSchema = z.array(z.string().uuid()).min(1, 'กรุณาเลือกรายการที่จะลบ').max(5000, 'เลือกได้ครั้งละไม่เกิน 5,000 รายการ');

export interface ItemDeleteResult {
  deleted: number;
  /** Named on PR/PO lines: kept for those documents but switched off, so they leave the pickers */
  deactivated: { id: string; code: string; name: string }[];
}

/**
 * Removes items from the register. Items a PR or PO line still names cannot go (the document
 * would lose its item), so they are switched off instead and no longer offered for new lines.
 */
export async function deleteItems(db: Db, actor: SessionUser, ids: string[]): Promise<ItemDeleteResult> {
  assertCan(actor, 'item.delete');
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) throw new DomainError('INVALID_ITEM', parsed.error.issues[0]!.message);

  return db.transaction(async (tx) => {
    const targets = await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(inArray(items.id, parsed.data)).for('update');
    if (targets.length === 0) throw new DomainError('NOT_FOUND', 'ไม่พบรายการที่เลือก อาจถูกลบไปแล้ว', 404);
    const targetIds = targets.map((t) => t.id);

    const [onPr, onPo] = await Promise.all([
      tx.selectDistinct({ id: prLines.itemId }).from(prLines).where(inArray(prLines.itemId, targetIds)),
      tx.selectDistinct({ id: poLines.itemId }).from(poLines).where(inArray(poLines.itemId, targetIds)),
    ]);
    const used = new Set([...onPr, ...onPo].map((r) => r.id).filter((id): id is string => !!id));
    const removable = targets.filter((t) => !used.has(t.id));
    const kept = targets.filter((t) => used.has(t.id));

    if (removable.length > 0) await tx.delete(items).where(inArray(items.id, removable.map((t) => t.id)));
    if (kept.length > 0) await tx.update(items).set({ active: false, updatedAt: new Date() }).where(inArray(items.id, kept.map((t) => t.id)));

    await logActivity(tx, {
      entityType: 'ITEM',
      entityId: actor.id,
      action: 'DELETE',
      userId: actor.id,
      note: `ลบสินค้า ${removable.length} รายการ, ปิดใช้งาน ${kept.length} รายการ`,
    });
    return { deleted: removable.length, deactivated: kept };
  });
}
