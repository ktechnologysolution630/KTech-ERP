import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listTakeoffs } from '@/server/services/boq-takeoff';
import { listProjects } from '@/server/services/master';
import { BoqTakeoffList } from '@/components/boq-takeoff-list';

export default async function BoqTakeoffPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [takeoffs, projects] = await Promise.all([listTakeoffs(db, actor), listProjects(db, actor)]);
  return <BoqTakeoffList takeoffs={takeoffs} projects={projects.map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }))} />;
}
