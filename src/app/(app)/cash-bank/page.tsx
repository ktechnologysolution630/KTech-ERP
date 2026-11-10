import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listCompanyAccounts } from '@/server/services/sales-docs';
import { CashBankClient } from './cash-bank-client';

export default async function CashBankPage() {
  const actor = await requireUser();
  const db = await getDb();
  const accounts = await listCompanyAccounts(db, actor);
  return <CashBankClient accounts={accounts} />;
}
