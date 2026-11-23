import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db/client';
import { prFormKind } from '@/domain/form-templates';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { getFormTemplates } from '@/server/services/form-templates';
import { listItems, listProjects, listVendors } from '@/server/services/master';
import { getPr } from '@/server/services/pr';
import { listBoqQtyOptions } from '@/server/services/pr-boq';
import { listOutstandingPrLines } from '@/server/services/pr-outstanding';
import { getSettings } from '@/server/services/settings';
import { companyHeaderFrom, vendorRefsFrom } from '@/components/doc-paper-data';
import { PrForm } from '@/components/pr-form';
import { canEditPr } from '../../edit-rule';
import { loadOrNotFound } from '@/app/(app)/or-not-found';

export default async function EditPrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const pr = await loadOrNotFound(id, () => getPr(db, actor, id));

  const back = (
    <Link href={`/pr/${pr.id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
      <ArrowLeft className="h-4 w-4" /> กลับไปหน้า {pr.number}
    </Link>
  );

  if (!canEditPr(actor, pr)) {
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          {pr.status === 'DRAFT' || pr.status === 'REJECTED'
            ? 'แก้ไขได้เฉพาะผู้ขอซื้อ เจ้าของ หรือผู้ดูแลระบบ'
            : 'ใบขอซื้อนี้ส่งขออนุมัติแล้ว แก้ไขได้เฉพาะใบร่างหรือใบที่ถูกตีกลับ'}
        </div>
      </div>
    );
  }

  const [projects, items, vendors, settings, forms, outstanding, boqOptions] = await Promise.all([
    listProjects(db, actor),
    listItems(db),
    listVendors(db),
    getSettings(db),
    getFormTemplates(db),
    // Lines repeating what an earlier PR is waiting on, and the BOQ to ask against
    listOutstandingPrLines(db, actor, { projectId: pr.projectId }),
    listBoqQtyOptions(db, actor),
  ]);
  const kind = prFormKind(pr.prType);

  return (
    <div className="space-y-4">
      {back}
      <h1 className="text-xl font-bold text-slate-900">แก้ไขใบขอซื้อ {pr.number}</h1>
      <PrForm
        projects={projects}
        items={items}
        vendors={vendorRefsFrom(vendors)}
        company={companyHeaderFrom(settings, forms.header)}
        forms={{ [kind]: forms.texts[kind] }}
        currentUserName={pr.requesterName}
        today={bangkokDateString()}
        outstanding={outstanding}
        boqOptions={boqOptions}
        existing={{
          id: pr.id,
          number: pr.number,
          prType: pr.prType,
          workEnd: pr.workEnd,
          projectId: pr.projectId,
          note: pr.note,
          docDate: pr.docDate,
          needBy: pr.needBy,
          vendorId: pr.vendorId,
          department: pr.department,
          requesterText: pr.requesterText,
          deliveryPlace: pr.deliveryPlace,
          paymentTerms: pr.paymentTerms,
          vatMode: pr.vatMode,
          billDiscount: pr.billDiscount,
          // Only what the form edits: the ordered and remaining quantities are Decimals a client component cannot take
          lines: pr.lines.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            detail: l.detail,
            lineKind: l.lineKind,
            unitName: l.unitName,
            category: l.category,
            itemGroup: l.itemGroup,
            boqLineId: l.boqLineId,
            outsideBoq: l.outsideBoq,
            qty: l.qty,
            estUnitPrice: l.estUnitPrice,
            discount: l.discount,
            neededDate: l.neededDate,
            note: l.note,
          })),
        }}
      />
    </div>
  );
}
