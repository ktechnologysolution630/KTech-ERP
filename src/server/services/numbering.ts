import { sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { docCounters } from '@/db/schema';
import { docPeriod } from '@/domain/thai';

export type DocPrefix =
  | 'PR'
  | 'PO'
  | 'PV'
  | 'WHT'
  | 'PRV'
  | 'SM'
  | 'SAR'
  | 'BOQ'
  | 'PJ'
  | 'AP'
  | 'VO'
  | 'INV'
  | 'RC'
  | 'CN'
  | 'ADV'
  | 'RS'
  | 'MAT';

export async function nextDocNumber(
  tx: Db,
  prefix: DocPrefix,
  at: Date = new Date(),
): Promise<string> {
  const period = docPeriod(at);
  const rows = await tx
    .insert(docCounters)
    .values({ prefix, period, last: 1 })
    .onConflictDoUpdate({
      target: [docCounters.prefix, docCounters.period],
      set: {
        last: sql`${docCounters.last} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  const seq = String(rows[0]!.last).padStart(4, '0');
  return `${prefix}-${period}-${seq}`;
}
