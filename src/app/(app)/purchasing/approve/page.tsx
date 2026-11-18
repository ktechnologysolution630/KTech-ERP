import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listBoqOverrunRequests } from '@/server/services/boq-overrun';
import { listPrs, projectIdsWithPm } from '@/server/services/pr';
import { listPos } from '@/server/services/po';
import { ApproveClient } from './approve-client';

export default async function PurchasingApprovePage() {
  const actor = await requireUser();
  const db = await getDb();

  const [submittedPrs, overBoqPrs, reviewPos, approvalPos, overruns] = await Promise.all([
    listPrs(db, actor, { status: 'SUBMITTED' }),
    listPrs(db, actor, { status: 'OWNER_REVIEW' }),
    listPos(db, actor, { status: 'PENDING_REVIEW' }),
    listPos(db, actor, { status: 'PENDING_APPROVAL' }),
    listBoqOverrunRequests(db, actor),
  ]);
  // A PO waits for the purchasing head first; others see it once it is passed on for approval
  const pos = [...reviewPos.filter((p) => can(actor, 'po.review', { createdBy: p.createdBy })), ...approvalPos];

  // The owner sees a submitted PR only on a project without a PM; until then it is the PM's
  const withPm = await projectIdsWithPm(db, [...new Set(submittedPrs.map((p) => p.projectId))]);
  const visibleSubmitted = submittedPrs.filter(
    (p) => !actor.roles.includes('OWNER') || can(actor, 'pr.approve', { projectId: p.projectId, projectHasPm: withPm.has(p.projectId) }),
  );

  const pendingPrs = [...overBoqPrs, ...visibleSubmitted].map((p) => ({
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
