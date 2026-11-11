import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { poLines, pos, prLines, projects, prs, receiptLines, receipts, type SessionUser } from '@/db/schema';
import { D } from '@/domain/money';
import { type OutstandingPrLine } from '@/domain/pr-outstanding';
import { isSiteScopedOnly } from '@/server/policy';

/**
 * Lines of submitted and approved PRs that have not been received in full: asked for 10, got 3,
 * 7 outstanding. Goods count once their receipt is confirmed, through any PO made from the line.
 * A draft has asked for nothing yet, and a rejected, cancelled or closed PR expects nothing more.
 */
export async function listOutstandingPrLines(db: Db, actor: SessionUser, filters: { projectId?: string } = {}): Promise<OutstandingPrLine[]> {
  const openPrs = (
    await db
      .select({ id: prs.id, number: prs.number, status: prs.status, projectId: prs.projectId, projectCode: projects.code, projectName: projects.name })
      .from(prs)
      .innerJoin(projects, eq(projects.id, prs.projectId))
      .where(inArray(prs.status, ['SUBMITTED', 'APPROVED']))
      .orderBy(asc(prs.number))
  ).filter((p) => {
    if (isSiteScopedOnly(actor) && !actor.projectIds.includes(p.projectId)) return false;
    return !filters.projectId || p.projectId === filters.projectId;
  });
  if (openPrs.length === 0) return [];

  const lines = await db
    .select()
    .from(prLines)
    .where(inArray(prLines.prId, openPrs.map((p) => p.id)))
    .orderBy(asc(prLines.createdAt));
  if (lines.length === 0) return [];

  const ordered = await db
    .select({ id: poLines.id, prLineId: poLines.prLineId, qty: poLines.qty })
    .from(poLines)
    .innerJoin(pos, and(eq(pos.id, poLines.poId), ne(pos.status, 'CANCELLED')))
    .where(inArray(poLines.prLineId, lines.map((l) => l.id)));
  const received = ordered.length
    ? await db
        .select({ poLineId: receiptLines.poLineId, qty: receiptLines.qty })
        .from(receiptLines)
        .innerJoin(receipts, and(eq(receipts.id, receiptLines.receiptId), eq(receipts.status, 'CONFIRMED')))
        .where(inArray(receiptLines.poLineId, ordered.map((o) => o.id)))
    : [];

  const receivedByPoLine = new Map<string, ReturnType<typeof D>>();
  for (const r of received) receivedByPoLine.set(r.poLineId, (receivedByPoLine.get(r.poLineId) ?? D(0)).plus(D(r.qty)));
  const byPrLine = new Map<string, { ordered: ReturnType<typeof D>; received: ReturnType<typeof D> }>();
  for (const o of ordered) {
    if (!o.prLineId) continue;
    const sum = byPrLine.get(o.prLineId) ?? { ordered: D(0), received: D(0) };
    byPrLine.set(o.prLineId, { ordered: sum.ordered.plus(D(o.qty)), received: sum.received.plus(receivedByPoLine.get(o.id) ?? D(0)) });
  }

  const linesByPr = new Map<string, typeof lines>();
  for (const l of lines) linesByPr.set(l.prId, [...(linesByPr.get(l.prId) ?? []), l]);
  return openPrs.flatMap((pr) =>
    (linesByPr.get(pr.id) ?? []).flatMap((l) => {
      // Hired work is not goods that arrive, so it is never "waiting to be received"
      if (l.lineKind === 'LABOR') return [];
      const sum = byPrLine.get(l.id) ?? { ordered: D(0), received: D(0) };
      const outstanding = D(l.qty).minus(sum.received);
      if (!outstanding.gt(0)) return [];
      return [
        {
          prId: pr.id,
          prNumber: pr.number,
          prStatus: pr.status,
          projectId: pr.projectId,
          projectCode: pr.projectCode,
          projectName: pr.projectName,
          prLineId: l.id,
          itemId: l.itemId,
          description: l.description,
          unitName: l.unitName,
          qty: D(l.qty).toNumber(),
          orderedQty: sum.ordered.toNumber(),
          receivedQty: sum.received.toNumber(),
          outstandingQty: outstanding.toNumber(),
        },
      ];
    }),
  );
}
