import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listVendors } from '@/server/services/master';
import { SpreadsheetImportBox } from '@/components/spreadsheet-import-box';
import { importVendorsAction, saveVendorAction } from '../actions';

export default async function VendorsMasterPage() {
  await requireUser();
  const db = await getDb();
  const list = await listVendors(db);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">ผู้ขาย / ร้านค้า</h1>

      <SpreadsheetImportBox
        title="นำเข้าผู้ขายจาก Excel / CSV"
        hint="คอลัมน์ที่รองรับ: รหัส, ชื่อ, ประเภท, เลขผู้เสียภาษี, สาขา, ที่อยู่, โทร, ธนาคาร, เลขบัญชี, ชื่อบัญชี, เครดิต(วัน), หัก ณ ที่จ่าย(%)"
        onImportRows={importVendorsAction}
      />

      <form
        action={saveVendorAction}
        className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-4 gap-3"
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">รหัสผู้ขาย *</label>
          <input name="code" required className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อผู้ขาย/ร้านค้า *</label>
          <input name="name" required className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ประเภท</label>
          <select name="type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            <option value="COMPANY">นิติบุคคล (ภ.ง.ด.53)</option>
            <option value="INDIVIDUAL">บุคคลธรรมดา (ภ.ง.ด.3)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">เลขผู้เสียภาษี (13 หลัก)</label>
          <input name="taxId" maxLength={13} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">รหัสสาขา (5 หลัก)</label>
          <input name="branch" defaultValue="00000" maxLength={5} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">เครดิต (วัน)</label>
          <input name="defaultCreditDays" type="number" defaultValue={30} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">หัก ณ ที่จ่าย (%)</label>
          <select name="defaultWhtRate" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            <option value={0}>0%</option>
            <option value={1}>1%</option>
            <option value={2}>2%</option>
            <option value={3}>3%</option>
            <option value={5}>5%</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">เบอร์โทร</label>
          <input name="phone" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ธนาคาร</label>
          <input name="bankName" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">เลขบัญชี</label>
          <input name="bankAccountNo" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อบัญชี</label>
          <input name="bankAccountName" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ที่อยู่</label>
          <input name="address" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div className="sm:col-span-4 flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
          >
            + บันทึกผู้ขาย
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">รหัส</th>
              <th className="px-4 py-3 text-left">ชื่อผู้ขาย</th>
              <th className="px-4 py-3 text-left">ประเภท</th>
              <th className="px-4 py-3 text-left">เลขผู้เสียภาษี</th>
              <th className="px-4 py-3 text-right">เครดิต (วัน)</th>
              <th className="px-4 py-3 text-right">WHT (%)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3 font-medium">{v.code}</td>
                <td className="px-4 py-3">{v.name}</td>
                <td className="px-4 py-3 text-xs">{v.type === 'COMPANY' ? 'นิติบุคคล' : 'บุคคล'}</td>
                <td className="px-4 py-3 text-xs">{v.taxId || '-'} ({v.branch})</td>
                <td className="px-4 py-3 text-right">{v.defaultCreditDays}</td>
                <td className="px-4 py-3 text-right">{v.defaultWhtRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
