import Link from 'next/link';
import { getDb } from '@/db/client';
import { serviceDue } from '@/domain/vehicle';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listVehicles } from '@/server/services/vehicles';
import { VehicleProfileRow } from './vehicle-profile-row';

/** ทะเบียนรถ: the vehicles of the asset register, with plate, odometer and service interval */
export default async function VehicleFleetPage() {
  const actor = await requireUser();
  const vehicles = await listVehicles(await getDb());
  const editable = can(actor, 'vehicle.manage');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">ทะเบียนรถ</h1>
        <p className="text-xs text-slate-500">
          รถมาจาก{' '}
          <Link href="/assets" prefetch={false} className="font-semibold text-[#2453d4] underline">
            ทะเบียนทรัพย์สิน
          </Link>{' '}
          หมวด &quot;ยานพาหนะ&quot; ที่ยังใช้งานอยู่ เพิ่มรถใหม่ได้ที่นั่น
        </p>
      </div>
      {vehicles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">ยังไม่มีรถในทะเบียนทรัพย์สิน</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2 font-semibold">รถ</th>
                <th className="px-3 py-2 font-semibold">ทะเบียน</th>
                <th className="px-3 py-2 text-right font-semibold">เลขไมล์ล่าสุด</th>
                <th className="px-3 py-2 text-right font-semibold">ซ่อมบำรุงทุก (กม.)</th>
                <th className="px-3 py-2 text-right font-semibold">ซ่อมบำรุงล่าสุดที่ (กม.)</th>
                <th className="px-3 py-2 font-semibold">ถึงรอบซ่อมบำรุง</th>
                <th className="px-3 py-2 font-semibold">ให้จอง</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles.map((v) => (
                <VehicleProfileRow key={v.id} vehicle={v} due={serviceDue(v)} editable={editable} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
