import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects, listVendors } from '@/server/services/master';
import { getPoOrNotFound } from '../../get-po-or-not-found';
import { listOrderablePrLines } from '@/server/services/pr';
import { listBoqMaterialOptions } from '@/server/services/boq-overrun';
import { listLastPurchasePrices } from '@/server/services/price-history';
import { PoForm } from '@/components/po-form';
import { companyHeaderFrom } from '@/components/doc-paper-data';
import { getSettings } from '@/server/services/settings';
import { getFormTemplates } from '@/server/services/form-templates';
import { bangkokDateString } from '@/domain/thai';
import Link from 'next/link';
import { PO_EDITABLE } from '../../edit-rule';

export default async function EditPoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const [po, projects, vendors, orderable, boqMaterials, settings, forms] = await Promise.all([
    getPoOrNotFound(db, actor, id),
    listProjects(db, actor),
    listVendors(db),
    listOrderablePrLines(db, actor),
    listBoqMaterialOptions(db, actor),
    getSettings(db),
    getFormTemplates(db),
  ]);

  if (!PO_EDITABLE.includes(po.status)) {
    return (
      <div className="space-y-4">
        <Link href={`/po/${po.id}`} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
          ← กลับไปหน้า {po.number}
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          {po.status === 'PENDING_REVIEW' || po.status === 'PENDING_APPROVAL'
            ? 'ใบสั่งซื้อนี้กำลังรอตรวจหรือรออนุมัติ จึงแก้ไขไม่ได้ ถ้าต้องแก้ให้ผู้อนุมัติตีกลับก่อน'
            : 'ใบสั่งซื้อที่ยกเลิกหรือปิดแล้วแก้ไขไม่ได้'}
        </div>
      </div>
    );
  }

  // Compared with what was bought before this order was first written, never with the order itself
  const lastPrices = await listLastPurchasePrices(db, { exceptPoId: po.id, before: po.createdAt });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">แก้ไขใบสั่งซื้อ {po.number}</h1>
      <PoForm
        projects={projects}
        vendors={vendors}
        company={companyHeaderFrom(settings, forms.header)}
        forms={{ PO: forms.texts.PO }}
        currentUserName={actor.name}
        today={bangkokDateString()}
        boqMaterials={boqMaterials}
        lastPrices={lastPrices}
        orderablePrLines={orderable.map((l) => ({
          id: l.id,
          prNumber: l.prNumber,
          projectId: l.projectId,
          projectCode: l.projectCode,
          description: l.description,
          unitName: l.unitName,
          remainingQty: l.remainingQty.toFixed(3),
          estUnitPrice: l.estUnitPrice,
          boqLineId: l.boqLineId,
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
