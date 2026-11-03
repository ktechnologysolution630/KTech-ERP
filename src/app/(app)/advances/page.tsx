import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listAdvances } from '@/server/services/advances';
import { listProjects } from '@/server/services/master';
import { AdvancesClient } from './advances-client';

export default async function AdvancesPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [data, projects] = await Promise.all([listAdvances(db, actor), listProjects(db, actor)]);
  return (
    <AdvancesClient
      data={data}
      currentUserId={actor.id}
      projects={projects.map((p) => ({ id: p.id, label: `${p.code} - ${p.name}` }))}
    />
  );
}
