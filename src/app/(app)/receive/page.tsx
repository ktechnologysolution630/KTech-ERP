import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listReceivablePos } from '@/server/services/receipt';
import { listPos } from '@/server/services/po';
import { ReceiveListClient, type ProjectReceiveGroup } from './receive-list-client';

export default async function ReceiveListPage() {
  const actor = await requireUser();
  const db = await getDb();

  // Load receivable POs and all POs to calculate Waiting, Partially, Received counts
  const [receivablePos, allPos] = await Promise.all([
    listReceivablePos(db, actor),
    listPos(db, actor, {}),
  ]);

  // Group receivable POs by project
  const projectMap = new Map<string, ProjectReceiveGroup>();

  for (const po of receivablePos) {
    const pId = po.projectId || 'OFFICE';
    if (!projectMap.has(pId)) {
      projectMap.set(pId, {
        projectId: pId,
        projectCode: po.projectCode,
        projectName: po.projectName,
        waitingCount: 0,
        partiallyCount: 0,
        receivedCount: 0,
        totalValue: 0,
        pos: [],
      });
    }

    const group = projectMap.get(pId)!;
    const poGross = allPos.find((p) => p.id === po.id);
    const grossVal = Number(poGross?.gross || 0);

    group.pos.push({
      id: po.id,
      number: po.number,
      vendorName: po.vendorName,
      status: po.status,
      deliveryDate: po.deliveryDate ? po.deliveryDate.toString() : null,
      remainingLineCount: po.remainingLineCount,
      gross: grossVal,
    });

    group.totalValue += grossVal;

    // Distinguish waiting receive vs partially received
    if (po.status === 'APPROVED') {
      group.waitingCount += 1;
    } else {
      group.partiallyCount += 1;
    }
  }

  // Count fully received POs per project from allPos
  for (const p of allPos) {
    if (p.status === 'COMPLETED') {
      const pId = p.projectId || 'OFFICE';
      if (projectMap.has(pId)) {
        projectMap.get(pId)!.receivedCount += 1;
      }
    }
  }

  const projectGroups = Array.from(projectMap.values());

  return <ReceiveListClient projectGroups={projectGroups} />;
}
