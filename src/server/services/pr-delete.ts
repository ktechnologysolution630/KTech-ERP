import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { attachments, comments, notifications, poLines, prLines, prs, pos, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { removeStoredFile } from './attachments';

const idsSchema = z.array(z.string().uuid()).min(1, 'กรุณาเลือกใบขอซื้อที่จะลบ').max(1000, 'เลือกได้ครั้งละไม่เกิน 1,000 ใบ');

export interface PrDeleteResult {
  deleted: { id: string; number: string }[];
  /** Ordered on a PO: kept, since the PO's lines point at them */
  kept: { id: string; number: string; poNumbers: string[] }[];
}

/**
 * Permanently removes requisitions, e.g. test data. One a PO has ordered from cannot go;
 * cancel it instead. Comments and files on the PR go with it; the activity log keeps a record.
 */
export async function deletePrs(db: Db, actor: SessionUser, ids: string[]): Promise<PrDeleteResult> {
  assertCan(actor, 'pr.delete');
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) throw new DomainError('INVALID_PR', parsed.error.issues[0]!.message);

  return db.transaction(async (tx) => {
    const targets = await tx.select({ id: prs.id, number: prs.number, status: prs.status }).from(prs).where(inArray(prs.id, parsed.data)).for('update');
    if (targets.length === 0) throw new DomainError('NOT_FOUND', 'ไม่พบใบขอซื้อที่เลือก อาจถูกลบไปแล้ว', 404);
    const targetIds = targets.map((t) => t.id);

    const ordered = await tx
      .select({ prId: prLines.prId, poNumber: pos.number })
      .from(poLines)
      .innerJoin(prLines, eq(prLines.id, poLines.prLineId))
      .innerJoin(pos, eq(pos.id, poLines.poId))
      .where(inArray(prLines.prId, targetIds));
    const poByPr = new Map<string, Set<string>>();
    for (const o of ordered) poByPr.set(o.prId, (poByPr.get(o.prId) ?? new Set()).add(o.poNumber));

    const removable = targets.filter((t) => !poByPr.has(t.id));
    const kept = targets.filter((t) => poByPr.has(t.id)).map((t) => ({ id: t.id, number: t.number, poNumbers: [...poByPr.get(t.id)!] }));

    if (removable.length > 0) {
      const removeIds = removable.map((t) => t.id);
      const files = await tx.select({ url: attachments.url }).from(attachments).where(inArray(attachments.entityId, removeIds));
      await tx.delete(attachments).where(inArray(attachments.entityId, removeIds));
      await tx.delete(comments).where(inArray(comments.entityId, removeIds));
      for (const file of files) await removeStoredFile(tx, file.url);
      await tx.delete(notifications).where(inArray(notifications.href, removeIds.map((id) => `/pr/${id}`)));
      // Lines go with their PR (on delete cascade)
      await tx.delete(prs).where(inArray(prs.id, removeIds));
      for (const t of removable) {
        await logActivity(tx, { entityType: 'PR', entityId: t.id, action: 'DELETE', userId: actor.id, note: `ลบ ${t.number} (สถานะ ${t.status})` });
      }
    }
    return { deleted: removable.map((t) => ({ id: t.id, number: t.number })), kept };
  });
}
