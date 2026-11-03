import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listPrs } from '@/server/services/pr';
import { listPos } from '@/server/services/po';
import { ApproveClient } from './approve-client';

export default async function PurchasingApprovePage() {
  const actor = await requireUser();
  const db = await getDb();

  const [prs, pos] = await Promise.all([
    listPrs(db, actor, { status: 'SUBMITTED' }),
    listPos(db, actor, { status: 'PENDING_APPROVAL' }),
  ]);

  const pendingPrs = prs.map((p) => ({
    id: p.id,
    docNumber: p.number,
    type: 'PR' as const,
    customer: '-',
    project: p.projectName,
    vendor: '-',
    date: p.createdAt,
    amount: 0,
    status: p.status,
    owner: p.requesterName,
    link: `/pr/${p.id}`,
  }));

  const pendingPos = pos.map((p) => ({
    id: p.id,
    docNumber: p.number,
    type: 'PO' as const,
    customer: '-',
    project: p.projectName,
    vendor: p.vendorName,
    date: p.createdAt,
    amount: Number(p.gross || 0),
    status: p.status,
    owner: 'ผู้จัดซื้อ',
    link: `/po/${p.id}`,
  }));

  const allPending = [...pendingPrs, ...pendingPos].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <ApproveClient
      pendingPrCount={pendingPrs.length}
      pendingPoCount={pendingPos.length}
      pendingDocs={allPending}
    />
  );
}