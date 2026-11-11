import { TrendingUp } from 'lucide-react';
import { formatMoneyDisplay } from '@/domain/money';
import type { PriceIncrease } from '@/domain/price-history';
import { formatThaiDate } from '@/domain/thai';

const baht = (n: number) => formatMoneyDisplay(n.toFixed(2));

/** Where the last price comes from: the order, its date and who sold it */
function LastPurchaseRef({ up, newTab }: { up: PriceIncrease; newTab?: boolean }) {
  return (
    <>
      <a href={`/po/${up.last.poId}`} {...(newTab ? { target: '_blank', rel: 'noreferrer' } : {})} className="font-semibold underline">
        {up.last.poNumber}
      </a>{' '}
      ({formatThaiDate(up.last.purchasedOn)} · {up.last.vendorName})
    </>
  );
}

/** Under a line of the PO form while it is being written. Saving is not blocked; the buyer is only told. */
export function PriceIncreaseNote({ up, unitName, label }: { up: PriceIncrease; unitName: string; label: string }) {
  return (
    <p role="status" aria-label={label} className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
      ราคาสูงกว่ารอบที่แล้ว{' '}
      <strong>
        +{baht(up.diff)} บาท/{unitName || 'หน่วย'} (+{up.percent}%)
      </strong>{' '}
      รอบที่แล้ว {baht(up.last.unitPrice)} รอบนี้ {baht(up.unitPrice)} จาก <LastPurchaseRef up={up} newTab />
    </p>
  );
}

/** On the PO itself, where the approver reads it before deciding */
export function PriceIncreasePanel({ increases }: { increases: (PriceIncrease & { description: string; unitName: string })[] }) {
  if (increases.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 print:hidden" aria-label="รายการที่ราคาสูงกว่ารอบที่แล้ว">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <TrendingUp className="h-4 w-4" /> ราคาสูงกว่ารอบที่แล้ว {increases.length} รายการ
      </h2>
      <p className="mt-0.5 text-amber-800">เทียบราคาต่อหน่วยก่อน VAT หลังหักส่วนลดรายการ กับใบสั่งซื้อล่าสุดที่อนุมัติแล้วของรายการเดียวกัน</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse bg-white">
          <thead>
            <tr className="bg-amber-100 text-left">
              <th className="border border-amber-200 px-2 py-1.5 font-semibold">รายการ</th>
              <th className="border border-amber-200 px-2 py-1.5 text-right font-semibold">รอบที่แล้ว</th>
              <th className="border border-amber-200 px-2 py-1.5 text-right font-semibold">รอบนี้</th>
              <th className="border border-amber-200 px-2 py-1.5 text-right font-semibold">สูงขึ้น</th>
              <th className="border border-amber-200 px-2 py-1.5 font-semibold">ซื้อครั้งก่อนจาก</th>
            </tr>
          </thead>
          <tbody>
            {increases.map((up, i) => (
              <tr key={i}>
                <td className="border border-amber-200 px-2 py-1.5 font-medium">
                  {up.description} <span className="font-normal text-slate-500">/ {up.unitName}</span>
                </td>
                <td className="border border-amber-200 px-2 py-1.5 text-right">{baht(up.last.unitPrice)}</td>
                <td className="border border-amber-200 px-2 py-1.5 text-right font-semibold">{baht(up.unitPrice)}</td>
                <td className="border border-amber-200 px-2 py-1.5 text-right font-semibold text-red-700">
                  +{baht(up.diff)} (+{up.percent}%)
                </td>
                <td className="border border-amber-200 px-2 py-1.5">
                  <LastPurchaseRef up={up} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
