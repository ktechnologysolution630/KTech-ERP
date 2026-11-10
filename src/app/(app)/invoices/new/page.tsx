import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listPoBillingInfo } from '@/server/services/invoice';
import { listPos } from '@/server/services/po';
import { InvoiceForm } from './invoice-form';

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const allPos = await listPos(db, actor);
  const validPos = allPos.filter(
    (p) => p.status === 'APPROVED' || p.status === 'ORDERED' || p.status === 'COMPLETED',
  );
  const billing = await listPoBillingInfo(db, actor, validPos.map((p) => p.id));

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          บันทึกใบแจ้งหนี้ / ใบกำกับภาษี (วางบิล)
        </h1>
        <p className="text-xs text-slate-600">
          สำหรับ PO เครดิต ต้องรับของก่อนจึงวางบิลได้ และระบบจะคำนวณวันครบกำหนดจ่ายตามรอบวางบิลและรอบรับเช็คให้อัตโนมัติ
        </p>
      </div>

      <InvoiceForm
        pos={validPos.map((p) => ({ id: p.id, number: p.number, vendorName: p.vendorName, gross: String(p.gross) }))}
        billing={billing}
        initialPoId={sp.poId ?? ''}
        today={bangkokDateString()}
      />
    </div>
  );
}
