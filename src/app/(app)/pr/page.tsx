import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { listPrs } from '@/server/services/pr';
import { listOutstandingPrLines } from '@/server/services/pr-outstanding';
import { can } from '@/server/policy';
import { listPos } from '@/server/services/po';
import { PrListClient } from './pr-list-client';

export default async function PrListPage() {
  const actor = await requireUser();
  const db = await getDb();

  const [prs, pos, projects, outstanding] = await Promise.all([
    listPrs(db, actor, {}),
    listPos(db, actor, {}),
    listProjects(db, actor),
    listOutstandingPrLines(db, actor),
  ]);

  // Group by project
  const projectStats = projects.map((prj) => {
    const prList = prs.filter((p) => p.projectId === prj.id);
    const poList = pos.filter((p) => p.projectId === prj.id);
    const totalValue = poList.reduce((sum, p) => sum + Number(p.gross || 0), 0);

    return {
      projectId: prj.id,
      projectCode: prj.code,
      projectName: prj.name,
      prCount: prList.length,
      poCount: poList.length,
      totalDocs: prList.length + poList.length,
      totalValue,
      prs: prList,
    };
  }).filter((p) => p.prCount > 0);

  return (
    <PrListClient
      projectStats={projectStats}
      allPrs={prs}
      outstanding={outstanding}
      canDelete={can(actor, 'pr.delete')}
    />
  );
}