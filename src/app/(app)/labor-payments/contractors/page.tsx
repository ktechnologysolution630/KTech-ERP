import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listVendors } from '@/server/services/master';
import { ContractorsClient, type ContractorItem } from './contractors-client';

export default async function ContractorsPage() {
  const actor = await requireUser();
  const db = await getDb();
  const allVendors = await listVendors(db);

  // Map vendors to ContractorItem shape
  const contractors: ContractorItem[] = allVendors.map((v) => ({
    id: v.id,
    code: v.code,
    name: v.name,
    contactPerson: v.taxId ? `Tax ID: ${v.taxId}` : 'ผู้รับผิดชอบงาน',
    phone: v.phone || '-',
    workType: v.type === 'INDIVIDUAL' ? 'งานเหมาค่าแรง' : 'งานรับเหมาทั่วไป',
    paymentTerms: v.defaultCreditDays > 0 ? `${v.defaultCreditDays} วัน` : 'ตามงวดงาน',
    bankName: v.bankName,
    bankAccountNo: v.bankAccountNo,
    bankAccountName: v.bankAccountName,
    retention: '5%',
    whtRate: `${v.defaultWhtRate}%`,
  }));

  return <ContractorsClient initialContractors={contractors} />;
}
