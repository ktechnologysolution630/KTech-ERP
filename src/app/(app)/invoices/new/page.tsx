import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listPos } from '@/server/services/po';
import { createInvoiceAction } from '../actions';

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
  const today = bangkokDateString();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          บันทึกใบแจ้งหนี้ / ใบกำกับภาษี
        </h1>
        <p className="text-xs text-slate-600">
          สำหรับ PO เครดิต ระบบจะสร้างรายการตั้งหนี้พร้อมวันครบกำหนดให้อัตโนมัติ
        </p>
      </div>

      <form
        action={async (fd: FormData) => {
          'use server';
          await createInvoiceAction({
            poId: String(fd.get('poId') ?? ''),
            invoiceNo: String(fd.get('invoiceNo') ?? ''),
            invoiceDate: String(fd.get('invoiceDate') ?? ''),
            isTaxInvoice: fd.get('isTaxInvoice') === 'on',
            beforeVat: String(fd.get('beforeVat') ?? '0'),
            vat: String(fd.get('vat') ?? '0'),
            dueDate: String(fd.get('dueDate') ?? ''),
          });
        }}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-sm"
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            ใบสั่งซื้อ (PO) *
          </label>
          <select
            name="poId"
            defaultValue={sp.poId ?? ''}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">-- เลือก PO --</option>
            {validPos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number} · {p.vendorName} (฿{p.gross})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              เลขที่ใบแจ้งหนี้ / ใบกำกับภาษี *
            </label>
            <input
              type="text"
              name="invoiceNo"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              วันที่เอกสาร *
            </label>
            <input
              type="date"
              name="invoiceDate"
              defaultValue={today}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              ยอดก่อน VAT (บาท) *
            </label>
            <input
              type="number"
              step="0.01"
              name="beforeVat"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              VAT (บาท) *
            </label>
            <input
              type="number"
              step="0.01"
              name="vat"
              defaultValue="0.00"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 items-center">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              วันครบกำหนดชำระ (เว้นว่างให้คำนวณตามเครดิต)
            </label>
            <input
              type="date"
              name="dueDate"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <label className="flex items-center gap-2 pt-5 text-xs font-medium text-slate-700">
            <input type="checkbox" name="isTaxInvoice" defaultChecked />
            เป็นใบกำกับภาษีซื้อ (ใช้ในรายงานภาษีซื้อ)
          </label>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-xs font-semibold"
          >
            บันทึกเอกสาร
          </button>
        </div>
      </form>
    </div>
  );
}
