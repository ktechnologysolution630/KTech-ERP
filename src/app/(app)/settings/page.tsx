import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { getSettings } from '@/server/services/settings';
import { MoneyInput } from '@/components/money-input';
import { saveSettingsAction } from '@/app/(app)/master/actions';

export default async function SettingsPage() {
  await requireUser();
  const db = await getDb();
  const s = await getSettings(db);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-slate-900">ตั้งค่าบริษัทและวงเงินอนุมัติ</h1>

      <form
        action={saveSettingsAction}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อบริษัท</label>
          <input
            name="companyName"
            defaultValue={s.companyName}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ที่อยู่บริษัท</label>
          <textarea
            name="companyAddress"
            defaultValue={s.companyAddress}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              เลขประจำตัวผู้เสียภาษี (13 หลัก)
            </label>
            <input
              name="companyTaxId"
              defaultValue={s.companyTaxId}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">รหัสสาขา</label>
            <input
              name="companyBranch"
              defaultValue={s.companyBranch}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            วงเงิน PO ที่หัวหน้าจัดซื้ออนุมัติได้ (บาท, ยอดรวม VAT ต่ำกว่ายอดนี้)
          </label>
          <MoneyInput name="poApprovalLimit" defaultValue={s.poApprovalLimit} />
          <p className="text-xs text-slate-500 mt-1">
            หากยอดรวม VAT ของ PO ต่ำกว่าวงเงินนี้ หัวหน้าจัดซื้อหรือเจ้าของอนุมัติได้ หากเท่ากับหรือเกินกว่านี้ต้องให้เจ้าของอนุมัติเท่านั้น
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-sm font-medium"
          >
            บันทึกการตั้งค่า
          </button>
        </div>
      </form>
    </div>
  );
}
