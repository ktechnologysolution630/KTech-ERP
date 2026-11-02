import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listItems, listUnits } from '@/server/services/master';
import { SpreadsheetImportBox } from '@/components/spreadsheet-import-box';
import { importItemsAction, saveItemAction } from '../actions';

export default async function ItemsMasterPage() {
  await requireUser();
  const db = await getDb();
  const [itemList, unitList] = await Promise.all([listItems(db), listUnits(db)]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">รายการสินค้า / วัสดุก่อสร้าง</h1>

      <SpreadsheetImportBox
        title="นำเข้าสินค้าจาก Excel / CSV"
        hint="คอลัมน์ที่รองรับ: รหัส, ชื่อ, หน่วย, หมวด (หากยังไม่มีหน่วย ระบบจะสร้างให้อัตโนมัติ)"
        onImportRows={importItemsAction}
      />

      <form
        action={saveItemAction}
        className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">รหัสสินค้า *</label>
          <input name="code" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อสินค้า/วัสดุ *</label>
          <input name="name" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">หน่วยนับ *</label>
          <input
            name="unitName"
            list="unit-options"
            required
            placeholder="เช่น ถุง, เส้น"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <datalist id="unit-options">
            {unitList.map((u) => (
              <option key={u.id} value={u.name} />
            ))}
          </datalist>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          + บันทึกสินค้า
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">รหัส</th>
              <th className="px-4 py-3 text-left">ชื่อสินค้า</th>
              <th className="px-4 py-3 text-left">หน่วย</th>
              <th className="px-4 py-3 text-left">หมวด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {itemList.map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-3 font-medium">{it.code}</td>
                <td className="px-4 py-3">{it.name}</td>
                <td className="px-4 py-3">{it.unitName}</td>
                <td className="px-4 py-3 text-slate-500">{it.category || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
