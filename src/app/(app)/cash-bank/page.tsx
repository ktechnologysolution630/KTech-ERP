import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listCompanyAccounts } from '@/server/services/sales-docs';
import { can } from '@/server/policy';
import { CashBankClient } from './cash-bank-client';

export default async function CashBankPage() {
  const actor = await requireUser();
  const db = await getDb();
  const accounts = await listCompanyAccounts(db, actor);
  return <CashBankClient accounts={accounts} canDelete={can(actor, 'accounting.delete')} />;
}
