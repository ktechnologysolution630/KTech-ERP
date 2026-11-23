import { getDb } from '@/db/client';
import { ActionErrorBanner } from '@/components/action-error-banner';
import { returnOnRefusal } from '@/lib/action-outcome';
import { requireUser } from '@/server/auth/current-user';
import { listVendors } from '@/server/services/master';
import { listOpenPayables } from '@/server/services/payable';
import { createPvAction } from '../actions';
import { PvPayablesTable, readPvPayables } from '../pv-payables-table';
import { SearchSelect } from '@/components/search-select';

export default async function NewPvPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string; error?: string | string[] }>;
}) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const [vendors, openPayables] = await Promise.all([
    listVendors(db),
    listOpenPayables(db, actor, {}),
  ]);

  const selectedVendorId =
    sp.vendorId ?? openPayables[0]?.vendorId ?? vendors[0]?.id ?? '';
  const vendorPayables = openPayables.filter(
    (p) => p.vendorId === selectedVendorId,
  );

  return (
    <div className="max-w-3xl space-y-6">
      <ActionErrorBanner
        message={sp.error}
        clearHref={selectedVendorId ? `/pv/new?vendorId=${encodeURIComponent(selectedVendorId)}` : '/pv/new'}
      />
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
          <SearchSelect
            name="vendorId"
            defaultValue={selectedVendorId}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} - {v.name} (หัก ณ ที่จ่ายเริ่มต้น {v.defaultWhtRate}%)
              </option>
            ))}
          </SearchSelect>
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
          const vendorId = String(fd.get('vendorId') ?? '');
          await returnOnRefusal(`/pv/new?vendorId=${encodeURIComponent(vendorId)}`, () =>
            createPvAction({ vendorId, ...readPvPayables(fd) }),
          );
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
            <PvPayablesTable
              rows={vendorPayables.map((p) => ({
                id: p.id,
                note: p.note,
                poNumber: p.poNumber,
                invoiceNo: p.invoiceNo,
                dueDate: p.dueDate,
                beforeVat: p.beforeVat,
                gross: p.gross,
                whtRate: p.defaultWhtRate,
                checked: true,
              }))}
            />
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
