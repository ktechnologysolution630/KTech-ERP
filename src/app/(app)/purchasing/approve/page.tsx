import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listBoqOverrunRequests } from '@/server/services/boq-overrun';
import { listPrs } from '@/server/services/pr';
import { listPos } from '@/server/services/po';
import { ApproveClient } from './approve-client';

export default async function PurchasingApprovePage() {
  const actor = await requireUser();
  const db = await getDb();

  const [prs, pos, overruns] = await Promise.all([
    listPrs(db, actor, { status: 'SUBMITTED' }),
    listPos(db, actor, { status: 'PENDING_APPROVAL' }),
    listBoqOverrunRequests(db, actor),
  ]);

  const pendingPrs = prs.map((p) => ({
    id: p.id,
    docNumber: p.number,
    type: 'PR' as const,
    project: p.projectName,
    vendor: '-',
    date: p.createdAt,
    // A PR lists quantities only; prices are set on the PO
    amount: null,
    status: p.status,
    owner: p.requesterName,
    link: `/pr/${p.id}`,
  }));

  const pendingPos = pos.map((p) => ({
    id: p.id,
    docNumber: p.number,
    type: 'PO' as const,
    project: p.projectName,
    vendor: p.vendorName,
    date: p.createdAt,
    amount: Number(p.gross || 0),
    status: p.status,
    owner: p.creatorName,
    link: `/po/${p.id}`,
  }));

  return (
    <ApproveClient
      pendingPrCount={pendingPrs.length}
      pendingDocs={[...pendingPrs, ...pendingPos]}
      overruns={overruns.filter((r) => r.status === 'PENDING')}
      canDecideOverrun={can(actor, 'boqOverrun.approve')}
    />
  );
}
