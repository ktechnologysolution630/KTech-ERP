import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listOpenPayables } from '@/server/services/payable';
import { formatMoneyDisplay } from '@/domain/money';
import { can } from '@/server/policy';
import { BulkDeleteBar, BulkDeleteProvider, SelectAllBox, SelectBox } from '@/components/bulk-delete';
import { deletePayablesAction } from '@/app/(app)/delete-actions';

const SOURCE_LABEL: Record<string, string> = {
  CREDIT_INVOICE: 'ใบแจ้งหนี้',
  PREPAID_REQUEST: 'ขอจ่ายล่วงหน้า',
  INSTALLMENT: 'งวดผ่อนชำระ',
  CONTRACTOR_CLAIM: 'เบิกงวดผู้รับเหมา',
  EXPENSE: 'เบิกค่าใช้จ่าย',
  LABOR: 'ค่าแรง',
  CREDIT_NOTE: 'ใบลดหนี้ผู้ขาย (หักยอด)',
  OPENING: 'เจ้าหนี้คงค้างยกมา',
};

export default async function PayablesPage() {
  const actor = await requireUser();
  const db = await getDb();
  const payables = await listOpenPayables(db, actor, {});
  // Owner and admin: a prepaid or instalment request no voucher took can be removed for good
  const canDelete = can(actor, 'data.delete');
  const label = (p: (typeof payables)[number]) =>
    `${SOURCE_LABEL[p.sourceType] ?? p.sourceType} ${p.poNumber ?? p.note} · ฿${formatMoneyDisplay(p.gross)}`;

  const page = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            รายการตั้งหนี้รอทำจ่าย (Open Payables)
          </h1>
          <p className="text-xs text-slate-600">
            เรียงตามวันครบกำหนดชำระ สำหรับฝ่ายการเงินนำไปรวมทำใบสำคัญจ่าย (PV)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && <BulkDeleteBar />}
          <Link
            href="/pv/new"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-medium"
          >
            + สร้างใบสำคัญจ่าย (PV)
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              {canDelete && (
                <th className="w-8 px-4 py-3">
                  <SelectAllBox items={payables.map((p) => ({ id: p.id, label: label(p) }))} />
                </th>
              )}
              <th className="px-4 py-3 text-left">ครบกำหนด</th>
              <th className="px-4 py-3 text-left">ผู้ขาย</th>
              <th className="px-4 py-3 text-left">ประเภท</th>
              <th className="px-4 py-3 text-left">PO / อ้างอิง</th>
              <th className="px-4 py-3 text-right">ก่อน VAT</th>
              <th className="px-4 py-3 text-right">VAT</th>
              <th className="px-4 py-3 text-right">ยอดรวม</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payables.length === 0 ? (
              <tr>
                <td colSpan={canDelete ? 8 : 7} className="px-4 py-8 text-center text-slate-500">
                  ไม่มีรายการตั้งหนี้ค้างทำจ่าย
                </td>
              </tr>
            ) : (
              payables.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  {canDelete && (
                    <td className="px-4 py-3">
                      <SelectBox id={p.id} label={label(p)} />
                    </td>
                  )}
                  <td className="px-4 py-3 text-xs font-medium">{p.dueDate}</td>
                  <td className="px-4 py-3">{p.vendorName}</td>
                  <td className="px-4 py-3 text-xs">{p.sourceType}</td>
                  <td className="px-4 py-3 text-xs">
                    {p.poId ? (
                      <Link
                        href={`/po/${p.poId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {p.poNumber}
                      </Link>
                    ) : (
                      '-'
                    )}{' '}
                    · {p.note}
                  </td>
                  <td className="px-4 py-3 text-right">
                    ฿{formatMoneyDisplay(p.beforeVat)}
                  </td>
                  <td className="px-4 py-3 text-right">฿{formatMoneyDisplay(p.vat)}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    ฿{formatMoneyDisplay(p.gross)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (!canDelete) return page;
  return (
    <BulkDeleteProvider
      action={deletePayablesAction}
      noun="รายการตั้งจ่าย"
      unit="รายการ"
      hint="ลบได้เฉพาะรายการที่ยังไม่เข้าใบสำคัญจ่าย จากการขอจ่ายล่วงหน้าหรืองวดผ่อน (งวดผ่อนจะกลับไปขอจ่ายใหม่ได้) รายการจากใบแจ้งหนี้ผู้ขายหรือใบขอเบิกให้ลบที่เอกสารนั้นแทน"
    >
      {page}
    </BulkDeleteProvider>
  );
}
