import { listCustomers } from '@/server/services/ar';
import { listProjects } from '@/server/services/master';
import { requireArUser } from '../../ar-guard';
import { ArInvoiceForm } from './ar-invoice-form';

export default async function NewArInvoicePage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const [{ actor, db }, sp] = await Promise.all([requireArUser(), searchParams]);
  const [customers, projects] = await Promise.all([listCustomers(db, actor), listProjects(db, actor)]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">สร้างใบแจ้งหนี้ (ลูกค้า)</h1>
      <ArInvoiceForm
        customers={customers.filter((c) => c.active).map((c) => ({ id: c.id, label: `${c.code} - ${c.name}` }))}
        projects={projects.map((p) => ({ id: p.id, label: `${p.code} - ${p.name}`, customerId: p.customerId }))}
        initialProjectId={sp.projectId}
      />
    </div>
  );
}
