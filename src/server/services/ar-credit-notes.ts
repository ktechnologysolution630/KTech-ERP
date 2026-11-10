import { desc, eq, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { arCreditNotes, arInvoices, customers, projects, type SessionUser } from '@/db/schema';
import { assertCan } from '@/server/policy';

/** Every ใบลดหนี้ with the invoice it reduces, newest first */
export async function listArCreditNotes(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  const rows = await db
    .select({
      cn: arCreditNotes,
      invoiceNumber: arInvoices.number,
      customerName: customers.name,
      projectCode: projects.code,
      projectName: projects.name,
    })
    .from(arCreditNotes)
    .innerJoin(arInvoices, eq(arInvoices.id, arCreditNotes.invoiceId))
    .innerJoin(customers, eq(customers.id, arInvoices.customerId))
    .leftJoin(projects, eq(projects.id, arInvoices.projectId))
    .orderBy(desc(arCreditNotes.docDate), desc(arCreditNotes.createdAt));
  return rows.map((r) => ({
    ...r.cn,
    invoiceNumber: r.invoiceNumber ?? '-',
    customerName: r.customerName,
    projectLabel: r.projectCode ? `${r.projectCode} ${r.projectName}` : '',
  }));
}

/** Issued invoices a credit note can be made against */
export async function listCreditableInvoices(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  return db
    .select({ id: arInvoices.id, number: arInvoices.number, customerName: customers.name, status: arInvoices.status })
    .from(arInvoices)
    .innerJoin(customers, eq(customers.id, arInvoices.customerId))
    .where(inArray(arInvoices.status, ['ISSUED', 'PARTIAL', 'PAID']))
    .orderBy(desc(arInvoices.createdAt));
}
