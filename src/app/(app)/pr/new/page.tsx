import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listItems, listProjects } from '@/server/services/master';
import { PrForm } from '@/components/pr-form';

export default async function NewPrPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [projects, items] = await Promise.all([
    listProjects(db, actor),
    listItems(db),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">เปิดใบขอซื้อใหม่ (PR)</h1>
      <PrForm projects={projects} items={items} />
    </div>
  );
}
