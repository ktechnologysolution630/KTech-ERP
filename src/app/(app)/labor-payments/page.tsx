import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listMilestoneProjects } from '@/server/services/milestones';
import { LaborPaymentsClient, type LaborTab } from './labor-payments-client';

const TABS: LaborTab[] = ['payment-milestones', 'receive-milestones', 'milestones'];

export default async function LaborPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab: LaborTab = TABS.includes(sp.tab as LaborTab) ? (sp.tab as LaborTab) : 'payment-milestones';
  const actor = await requireUser();
  const db = await getDb();
  const [pay, receive] = await Promise.all([
    listMilestoneProjects(db, actor, 'PAY'),
    listMilestoneProjects(db, actor, 'RECEIVE'),
  ]);

  return <LaborPaymentsClient tab={tab} pay={pay} receive={receive} />;
}
