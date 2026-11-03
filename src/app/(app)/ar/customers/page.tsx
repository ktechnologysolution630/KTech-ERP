import { listCustomers } from '@/server/services/ar';
import { requireArUser } from '../ar-guard';
import { CustomersClient } from './customers-client';

export default async function CustomersPage() {
  const { actor, db } = await requireArUser();
  const rows = await listCustomers(db, actor);
  return (
    <CustomersClient
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
        active: c.active,
      }))}
    />
  );
}
