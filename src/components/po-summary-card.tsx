import { type PoSummary } from '@/domain/po-summary';
import { formatMoneyDisplay } from './money-input';

export function PoSummaryCard({ summary }: { summary: PoSummary }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          สรุปสถานะการรับของและการชำระเงิน
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.labels.map((lbl) => {
            const isWarning =
              lbl === 'จ่ายแล้ว ของยังไม่มา' ||
              lbl === 'ยังไม่ได้ใบกำกับภาษี' ||
              lbl === 'รอคืนเงินจากผู้ขาย';
            const isSuccess = lbl === 'รับครบ' || lbl === 'จ่ายครบ';
            return (
              <span
                key={lbl}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  isWarning
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : isSuccess
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-700'
                }`}
              >
                {lbl}
              </span>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-slate-500">ยอดสั่งซื้อ (PO)</div>
          <div className="font-bold text-slate-900 text-sm mt-0.5">
            ฿{formatMoneyDisplay(summary.poGross.toFixed(2))}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-slate-500">มูลค่าของที่รับแล้ว</div>
          <div className="font-bold text-emerald-700 text-sm mt-0.5">
            ฿{formatMoneyDisplay(summary.receivedGross.toFixed(2))}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-slate-500">ตั้งหนี้ / ขอเบิกแล้ว</div>
          <div className="font-bold text-slate-800 text-sm mt-0.5">
            ฿{formatMoneyDisplay(summary.payablesGross.toFixed(2))}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-slate-500">อนุมัติจ่าย (PV)</div>
          <div className="font-bold text-blue-700 text-sm mt-0.5">
            ฿{formatMoneyDisplay(summary.pvApprovedGross.toFixed(2))}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-slate-500">จ่ายแล้วสะสม</div>
          <div className="font-bold text-emerald-700 text-sm mt-0.5">
            ฿{formatMoneyDisplay(summary.paidGross.toFixed(2))}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-slate-500">คงเหลือต้องจ่าย</div>
          <div className="font-bold text-slate-900 text-sm mt-0.5">
            ฿{formatMoneyDisplay(summary.remainingToPay.toFixed(2))}
          </div>
        </div>
      </div>

      {(summary.paidNotReceived || summary.refundDue.gt(0)) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {summary.paidNotReceived && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              <strong>จ่ายแล้วแต่ของยังไม่มา:</strong> ฿
              {formatMoneyDisplay(summary.paidNotReceivedAmount.toFixed(2))}
            </div>
          )}
          {summary.refundDue.gt(0) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">
              <strong>รอคืนเงินจากผู้ขาย (ปิดยอดค้างรับ):</strong> ฿
              {formatMoneyDisplay(summary.refundDue.toFixed(2))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
