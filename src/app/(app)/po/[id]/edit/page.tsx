import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects, listVendors } from '@/server/services/master';
import { getPoOrNotFound } from '../../get-po-or-not-found';
import { listOrderablePrLines } from '@/server/services/pr';
import { listBoqMaterialOptions } from '@/server/services/boq-overrun';
import { PoForm } from '@/components/po-form';
import { companyHeaderFrom } from '@/components/doc-paper-data';
import { getSettings } from '@/server/services/settings';
import { bangkokDateString } from '@/domain/thai';

export default async function EditPoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const [po, projects, vendors, orderable, boqMaterials, settings] = await Promise.all([
    getPoOrNotFound(db, actor, id),
    listProjects(db, actor),
    listVendors(db),
    listOrderablePrLines(db, actor),
    listBoqMaterialOptions(db, actor),
    getSettings(db),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">แก้ไขใบสั่งซื้อ {po.number}</h1>
      <PoForm
        projects={projects}
        vendors={vendors}
        company={companyHeaderFrom(settings)}
        currentUserName={actor.name}
        today={bangkokDateString()}
        boqMaterials={boqMaterials}
        orderablePrLines={orderable.map((l) => ({
          id: l.id,
          prNumber: l.prNumber,
          projectId: l.projectId,
          projectCode: l.projectCode,
          description: l.description,
          unitName: l.unitName,
          remainingQty: l.remainingQty.toFixed(3),
          estUnitPrice: l.estUnitPrice,
        }))}
        existing={{
          id: po.id,
          number: po.number,
          docDate: po.docDate,
          department: po.department,
          requesterName: po.requesterName,
          paymentTerms: po.paymentTerms,
          projectId: po.projectId,
          vendorId: po.vendorId,
          paymentType: po.paymentType,
          creditDays: po.creditDays,
          terms: { billingSchedule: po.billingSchedule, creditBasis: po.creditBasis, chequeSchedule: po.chequeSchedule, payMethod: po.payMethod },
          vatMode: po.vatMode,
          billDiscount: po.billDiscount,
          shipping: po.shipping,
          deliveryDate: po.deliveryDate,
          deliveryAddress: po.deliveryAddress,
          note: po.note,
          isApprovedRevision: po.status === 'APPROVED' || po.status === 'ORDERED',
          lines: po.lines.map((l) => ({
            id: l.id,
            prLineId: l.prLineId,
            boqLineId: l.boqLineId,
            description: l.description,
            detail: l.detail,
            unitName: l.unitName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discount: l.discount,
          })),
          installments: po.installments.map((inst) => ({
            name: inst.name,
            percent: inst.percent ?? '0',
            condition: inst.condition,
            conditionNote: inst.conditionNote,
          })),
        }}
      />
    </div>
  );
}
