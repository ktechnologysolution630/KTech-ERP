import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { listPrs } from '@/server/services/pr';
import { listPos } from '@/server/services/po';
import { PoListClient } from './po-list-client';

export default async function PoListPage() {
  const actor = await requireUser();
  const db = await getDb();

  const [prs, pos, projects] = await Promise.all([
    listPrs(db, actor, {}),
    listPos(db, actor, {}),
    listProjects(db, actor),
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
      pos: poList,
    };
  }).filter((p) => p.poCount > 0);

  return (
    <PoListClient
      projectStats={projectStats}
      allPos={pos}
    />
  );
}