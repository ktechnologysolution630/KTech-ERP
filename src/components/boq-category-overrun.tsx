import { AlertTriangle } from 'lucide-react';
import type { BoqCategoryOverrun } from '@/domain/boq-overrun';
import { formatMoneyDisplay } from '@/domain/money';

const baht = (v: string) => formatMoneyDisplay(Number(v).toFixed(2));

/**
 * Tells the buyer (on the PO form) or the approver (on the PO) that the order takes a BOQ category
 * (หมวด/กลุ่มงาน) over its material budget. Saving and approving go on; this only warns.
 */
export function BoqCategoryOverrunNote({ overruns, className = '' }: { overruns: BoqCategoryOverrun[]; className?: string }) {
  if (overruns.length === 0) return null;
  return (
    <section role="alert" aria-label="สั่งซื้อเกินงบของกลุ่ม" className={`rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900 ${className}`}>
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <AlertTriangle className="h-4 w-4" /> สั่งซื้อเกินงบของกลุ่ม {overruns.length} กลุ่ม
      </h2>
      <p className="mt-0.5 text-red-800">เทียบงบวัสดุของหมวดใน BOQ กับยอด PO ทั้งหมดที่ใช้หมวดนั้น (ก่อน VAT) รวมใบนี้</p>
      <ul className="mt-2 space-y-1">
        {overruns.map((o) => (
          <li key={o.categoryId} className="rounded border border-red-200 bg-white px-2 py-1.5">
            <strong>{o.name}</strong>: เกินงบ <strong>{baht(o.over)} บาท</strong>
            <span className="text-red-700">
              {' '}
              (งบ {baht(o.budget)} · สั่งไปแล้ว {baht(o.committedElsewhere)} · ใบนี้ {baht(o.thisPo)})
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
