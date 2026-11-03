import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listPrs } from '@/server/services/pr';
import { listPos } from '@/server/services/po';
import type { PurchasingDocRow } from '@/components/purchasing-doc-table';
import { PurchasingClient } from './purchasing-client';

export default async function PurchasingPage() {
  const actor = await requireUser();
  const db = await getDb();

  const [prList, poList] = await Promise.all([
    listPrs(db, actor, {}),
    listPos(db, actor, {}),
  ]);

  const pendingPrCount = prList.filter((p) => p.status === 'SUBMITTED').length;
  const issuedPoCount = poList.filter((p) => p.status === 'APPROVED' || p.status === 'ORDERED').length;
  const pendingReceiveCount = poList.filter((p) => p.status === 'ORDERED').length;

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const poTotalThisMonth = poList
    .filter((p) => {
      const d = new Date(p.createdAt);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    })
    .reduce((sum, p) => sum + Number(p.gross || 0), 0);

  const unifiedDocs: PurchasingDocRow[] = [
    ...prList.map((p) => ({
      id: p.id,
      docNumber: p.number,
      type: 'PR' as const,
      project: p.projectName || '-',
      vendor: '-',
      date: p.createdAt,
      amount: null,
      status: p.status,
      owner: p.requesterName || '-',
      link: `/pr/${p.id}`,
    })),
    ...poList.map((p) => ({
      id: p.id,
      docNumber: p.number,
      type: 'PO' as const,
      project: p.projectName || '-',
      vendor: p.vendorName || '-',
      date: p.createdAt,
      amount: Number(p.gross || 0),
      status: p.status,
      owner: p.creatorName,
      link: `/po/${p.id}`,
    })),
  ];

  return (
    <PurchasingClient
      stats={{
        pendingPrCount,
        issuedPoCount,
        pendingReceiveCount,
        poTotalThisMonth,
      }}
      documents={unifiedDocs}
    />
  );
}