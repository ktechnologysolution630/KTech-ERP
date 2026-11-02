import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { saveProjectAction } from '../actions';

export default async function ProjectsMasterPage() {
  const actor = await requireUser();
  const db = await getDb();
  const list = await listProjects(db, actor);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">ข้อมูลโครงการ</h1>

      <form
        action={saveProjectAction}
        className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">รหัสโครงการ</label>
          <input
            name="code"
            required
            placeholder="เช่น PJ-2569-01"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อโครงการ</label>
          <input
            name="name"
            required
            placeholder="ชื่อโครงการก่อสร้าง"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          + บันทึกโครงการ
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">รหัส</th>
              <th className="px-4 py-3 text-left">ชื่อโครงการ</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{p.code}</td>
                <td className="px-4 py-3 text-slate-700">{p.name}</td>
                <td className="px-4 py-3 text-xs">
                  {p.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
