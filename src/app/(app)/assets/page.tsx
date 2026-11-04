import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listAssets } from '@/server/services/assets';
import { listProjects } from '@/server/services/master';
import { AssetsClient } from './assets-client';

export default async function AssetsPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [page, projects] = await Promise.all([listAssets(db, actor), listProjects(db, actor)]);
  return <AssetsClient page={page} projects={projects.map((p) => ({ id: p.id, label: `${p.code} - ${p.name}` }))} />;
}
