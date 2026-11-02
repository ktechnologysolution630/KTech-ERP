import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listVendors } from '@/server/services/master';
import { listOpenPayables } from '@/server/services/payable';
import { formatMoneyDisplay } from '@/components/money-input';
import { createPvAction } from '../actions';

export default async function NewPvPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string }>;
}) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const [vendors, openPayables] = await Promise.all([
    listVendors(db, actor),
    listOpenPayables(db, actor, {}),
  ]);

  const selectedVendorId =
    sp.vendorId ?? openPayables[0]?.vendorId ?? vendors[0]?.id ?? '';
  const vendorPayables = openPayables.filter(
    (p) => p.vendorId === selectedVendorId,
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          สร้างใบสำคัญจ่าย (New Payment Voucher)
        </h1>
        <p className="text-xs text-slate-600">
          เลือกผู้ขาย เลือกรายการตั้งหนี้ที่ต้องการจ่าย และกำหนดอัตราภาษีหัก ณ ที่จ่าย
        </p>
      </div>

      <form method="get" className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            เลือกผู้ขาย (Vendor)
          </label>
          <select
            name="vendorId"
            defaultValue={selectedVendorId}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} - {v.name} (หัก ณ ที่จ่ายเริ่มต้น {v.defaultWhtRate}%)
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          แสดงรายการค้างจ่าย
        </button>
      </form>

      <form
        action={async (fd: FormData) => {
          'use server';
          const payableIds = fd.getAll('payableId').map(String);
          const whtRates: Record<string, number> = {};
          for (const pid of payableIds) {
            whtRates[pid] = Number(fd.get(`wht_${pid}`) ?? 0);
          }
          await createPvAction({
            vendorId: String(fd.get('vendorId') ?? ''),
            payableIds,
            whtRates,
            note: String(fd.get('note') ?? ''),
          });
        }}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <input type="hidden" name="vendorId" value={selectedVendorId} />

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">
            รายการตั้งหนี้ที่เปิดอยู่ของผู้ขายรายนี้
          </h3>
          {vendorPayables.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              ไม่มีรายการตั้งหนี้ค้างจ่ายสำหรับผู้ขายรายนี้
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">เลือก</th>
                  <th className="px-3 py-2 text-left">รายการ / อ้างอิง</th>
                  <th className="px-3 py-2 text-left">ครบกำหนด</th>
                  <th className="px-3 py-2 text-right">ก่อน VAT</th>
                  <th className="px-3 py-2 text-right">ยอดรวม</th>
                  <th className="px-3 py-2 text-right">หัก ณ ที่จ่าย (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vendorPayables.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name="payableId"
                        value={p.id}
                        defaultChecked
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{p.note}</div>
                      <div className="text-slate-500">
                        {p.poNumber ? `PO: ${p.poNumber}` : ''}{' '}
                        {p.invoiceNo ? `· IV: ${p.invoiceNo}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2">{p.dueDate}</td>
                    <td className="px-3 py-2 text-right">
                      ฿{formatMoneyDisplay(p.beforeVat)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      ฿{formatMoneyDisplay(p.gross)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <select
                        name={`wht_${p.id}`}
                        defaultValue={String(p.defaultWhtRate)}
                        className="rounded border border-slate-300 px-2 py-1"
                      >
                        <option value="0">ไม่หัก (0%)</option>
                        <option value="1">1% (ขนส่ง)</option>
                        <option value="2">2% (โฆษณา)</option>
                        <option value="3">3% (บริการ/รับเหมา)</option>
                        <option value="5">5% (ค่าเช่า)</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            หมายเหตุ
          </label>
          <input
            type="text"
            name="note"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={vendorPayables.length === 0}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-5 py-2 text-xs font-semibold"
        >
          สร้างใบสำคัญจ่าย (PV)
        </button>
      </form>
    </div>
  );
}
