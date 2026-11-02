import { getDb } from '@/db/client';
import { ROLES } from '@/db/schema';
import { requireUser } from '@/server/auth/current-user';
import { listProjects, listUsersWithRoles } from '@/server/services/master';
import { saveUserAction } from '../actions';

export default async function UsersMasterPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [userList, projectList] = await Promise.all([
    listUsersWithRoles(db),
    listProjects(db, actor),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">จัดการผู้ใช้งานและบทบาท</h1>

      <form
        action={saveUserAction}
        className="rounded-xl border border-slate-200 bg-white p-4 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อ-นามสกุล *</label>
            <input name="name" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">อีเมล *</label>
            <input name="email" type="email" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">รหัสผ่านเริ่มต้น</label>
            <input name="password" type="password" placeholder="อย่างน้อย 4 ตัวอักษร" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">บทบาท (เลือกได้หลายบทบาท) *</label>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((r) => (
              <label key={r} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" name="roles" value={r} className="rounded" />
                {r}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">โครงการที่สังกัด (สำหรับ Foreman / Engineer / PM)</label>
          <div className="flex flex-wrap gap-3">
            {projectList.map((p) => (
              <label key={p.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" name="projectIds" value={p.id} className="rounded" />
                {p.code} - {p.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
          >
            + สร้างผู้ใช้งาน
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">ชื่อ</th>
              <th className="px-4 py-3 text-left">อีเมล</th>
              <th className="px-4 py-3 text-left">บทบาท</th>
              <th className="px-4 py-3 text-left">จำนวนโครงการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {userList.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-xs">{u.roles.join(', ')}</td>
                <td className="px-4 py-3 text-xs">{u.projectIds.length} โครงการ</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
