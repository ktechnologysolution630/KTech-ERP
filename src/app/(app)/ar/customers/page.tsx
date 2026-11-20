import { listCustomers } from '@/server/services/ar';
import { customerOutstanding, listSalespeople, salesBySalesperson } from '@/server/services/customer-credit';
import { bangkokDateString } from '@/domain/thai';
import { can } from '@/server/policy';
import { requireArUser } from '../ar-guard';
import { CustomersClient } from './customers-client';

export default async function CustomersPage() {
  const { actor, db } = await requireArUser();
  const today = bangkokDateString();
  const [rows, outstanding, salespeople, bySalesperson] = await Promise.all([
    listCustomers(db, actor),
    customerOutstanding(db),
    listSalespeople(db, actor),
    salesBySalesperson(db, actor, { from: `${today.slice(0, 4)}-01-01`, to: today }),
  ]);
  return (
    <CustomersClient
      canDelete={can(actor, 'accounting.delete')}
      salespeople={salespeople}
      salesBySalesperson={bySalesperson}
      customers={rows.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        taxId: c.taxId ?? '',
        branch: c.branch,
        address: c.address,
        contactName: c.contactName,
        phone: c.phone,
        email: c.email,
        creditDays: c.creditDays,
        creditLimit: Number(c.creditLimit),
        salespersonId: c.salespersonId ?? '',
        outstanding: outstanding.get(c.id) ?? 0,
        active: c.active,
      }))}
    />
  );
}
