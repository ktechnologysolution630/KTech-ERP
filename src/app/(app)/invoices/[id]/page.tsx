import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { getInvoice } from '@/server/services/invoice';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/components/money-input';
import { cancelInvoiceAction, matchInvoiceAction } from '../actions';

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const inv = await getInvoice(db, actor, id);

  const matchedMap = new Map(inv.matches.map((m) => [m.payableId, m.gross]));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              ใบแจ้งหนี้ {inv.invoiceNo}
            </h1>
            <DocStatusBadge status={inv.status} />
          </div>
          <p className="text-xs text-slate-600 mt-1">
            ผู้ขาย: {inv.vendorName} · PO:{' '}
            <Link href={`/po/${inv.poId}`} className="text-blue-600 hover:underline">
              {inv.poNumber}
            </Link>{' '}
            · วันที่เอกสาร: {inv.invoiceDate}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-500">ยอดก่อน VAT</div>
          <div className="font-semibold">฿{formatMoneyDisplay(inv.beforeVat)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">VAT</div>
          <div className="font-semibold">฿{formatMoneyDisplay(inv.vat)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ยอดรวมทั้งสิ้น</div>
          <div className="font-bold text-slate-900">฿{formatMoneyDisplay(inv.gross)}</div>
        </div>
      </div>

      {inv.status === 'ACTIVE' && inv.poPaymentType !== 'CREDIT' && (
        <form
          action={async (fd: FormData) => {
            'use server';
            const matches = inv.poPayables.map((p) => ({
              payableId: p.id,
              gross: String(fd.get(`match_${p.id}`) ?? '0'),
            }));
            await matchInvoiceAction(inv.id, matches);
          }}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            จับคู่ใบกำกับภาษีกับรายการขอเบิก (Payables)
          </h3>
          <div className="space-y-2 text-xs">
            {inv.poPayables.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2"
              >
                <div>
                  <div className="font-medium text-slate-800">{p.note}</div>
                  <div className="text-slate-500">
                    ยอดตั้งหนี้: ฿{formatMoneyDisplay(p.gross)} · สถานะ: {p.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span>ยอดที่จับคู่:</span>
                  <input
                    type="number"
                    step="0.01"
                    name={`match_${p.id}`}
                    defaultValue={matchedMap.get(p.id) ?? p.gross}
                    className="w-32 rounded border border-slate-300 px-2 py-1 text-right"
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 text-white px-4 py-2 text-xs font-medium"
          >
            บันทึกการจับคู่ใบกำกับภาษี
          </button>
        </form>
      )}

      {inv.status === 'ACTIVE' && (
        <form
          action={async () => {
            'use server';
            await cancelInvoiceAction(inv.id, 'ยกเลิกโดยฝ่ายการเงิน');
          }}
        >
          <button
            type="submit"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            ยกเลิกใบแจ้งหนี้
          </button>
        </form>
      )}
    </div>
  );
}
