import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { attachments, comments, notifications, type EntityType, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { logActivity } from './activity';
import { removeStoredFile } from './attachments';
import { deletedNumbersData } from './numbering';

/**
 * What every permanent delete of a picked set of records shares: the outcome reported back (what went, what stayed
 * and why), the files, comments and notifications that go with a record, and the activity-log entry that keeps the
 * record of it, with the document numbers that must never be handed out again.
 */

export interface DeleteOutcome {
  deleted: { id: string; number: string }[];
  /** Left in place, with why */
  kept: { id: string; number: string; reason: string }[];
}

const idsSchema = z.array(z.string().uuid()).min(1, 'กรุณาเลือกรายการที่จะลบ').max(1000, 'เลือกได้ครั้งละไม่เกิน 1,000 รายการ');

export function parseIds(ids: string[]): string[] {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) throw new DomainError('INVALID_INPUT', parsed.error.issues[0]!.message);
  return [...new Set(parsed.data)];
}

export const MUST_CANCEL_FIRST = 'ยังไม่ได้ยกเลิก กด "ยกเลิก" ที่เอกสารก่อนจึงลบได้';

const isForeignKeyViolation = (err: unknown): boolean => {
  const { code, cause } = err as { code?: string; cause?: { code?: string } };
  return code === '23503' || cause?.code === '23503';
};

/** Something new points at a record while the delete ran: nothing was removed */
export async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw new DomainError('IN_USE', 'มีเอกสารอื่นอ้างถึงรายการที่เลือกอยู่ จึงยังไม่ได้ลบ กรุณาลองใหม่อีกครั้ง', 409);
    }
    throw err;
  }
}

/** Files, comments and notifications that hang on records being removed */
export async function removeTraces(tx: Db, entityIds: string[], hrefs: string[] = []) {
  if (entityIds.length > 0) {
    const files = await tx.select({ url: attachments.url }).from(attachments).where(inArray(attachments.entityId, entityIds));
    await tx.delete(attachments).where(inArray(attachments.entityId, entityIds));
    await tx.delete(comments).where(inArray(comments.entityId, entityIds));
    for (const file of files) await removeStoredFile(tx, file.url);
  }
  if (hrefs.length > 0) await tx.delete(notifications).where(inArray(notifications.href, hrefs));
}

export interface Target {
  id: string;
  number: string;
}

/** One entry per record removed; `numbers` are the document numbers that must never come back */
export async function logDeletes(
  tx: Db,
  actor: SessionUser,
  entityType: EntityType,
  rows: (Target & { logEntityId?: string; numbers?: string[]; note?: string; action?: string })[],
) {
  for (const r of rows) {
    await logActivity(tx, {
      entityType,
      entityId: r.logEntityId ?? r.id,
      action: r.action ?? 'DELETE',
      userId: actor.id,
      note: r.note ?? `ลบ ${r.number}`,
      data: r.numbers && r.numbers.length > 0 ? deletedNumbersData(r.numbers) : undefined,
    });
  }
}

/** Splits the picked records into those that may go and those kept, with why */
export function split<T extends Target>(targets: T[], why: (t: T) => string | null): { go: T[]; kept: DeleteOutcome['kept'] } {
  const go: T[] = [];
  const kept: DeleteOutcome['kept'] = [];
  for (const t of targets) {
    const reason = why(t);
    if (reason) kept.push({ id: t.id, number: t.number, reason });
    else go.push(t);
  }
  return { go, kept };
}

export const outcome = (go: Target[], kept: DeleteOutcome['kept']): DeleteOutcome => ({ deleted: go.map((t) => ({ id: t.id, number: t.number })), kept });

export const notFound = (what: string) => new DomainError('NOT_FOUND', `ไม่พบ${what}ที่เลือก อาจถูกลบไปแล้ว`, 404);
