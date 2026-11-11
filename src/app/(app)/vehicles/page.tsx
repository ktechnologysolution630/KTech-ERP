import Link from 'next/link';
import { AlertTriangle, Plus } from 'lucide-react';
import { getDb } from '@/db/client';
import { formatThaiDateTime, TRIP_STATUS_LABEL, TRIP_STATUS_TONE, type TripStatus } from '@/domain/vehicle';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listTrips } from '@/server/services/vehicles';

const FILTERS: { key: string; label: string; statuses?: TripStatus[] }[] = [
  { key: 'open', label: 'ยังไม่ปิด', statuses: ['REQUESTED', 'APPROVED', 'IN_USE'] },
  { key: 'waiting', label: 'รออนุมัติ', statuses: ['REQUESTED'] },
  { key: 'out', label: 'กำลังใช้งาน', statuses: ['IN_USE'] },
  { key: 'done', label: 'คืนแล้ว', statuses: ['RETURNED'] },
  { key: 'all', label: 'ทั้งหมด' },
];

/** ขอใช้รถ / บันทึกการใช้รถ: one's own trips, or every trip for those who watch the fleet */
export default async function VehicleTripsPage({ searchParams }: { searchParams: Promise<{ scope?: string; filter?: string }> }) {
  const actor = await requireUser();
  const params = await searchParams;
  const canSeeAll = can(actor, 'vehicle.track');
  const scope = canSeeAll && params.scope !== 'mine' ? 'all' : 'mine';
  const filter = FILTERS.find((f) => f.key === params.filter) ?? FILTERS[0]!;
  const trips = await listTrips(await getDb(), actor, { scope, status: filter.statuses });
  const href = (p: { scope?: string; filter?: string }) => `/vehicles?scope=${p.scope ?? scope}&filter=${p.filter ?? filter.key}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">การใช้รถ</h1>
          <p className="text-xs text-slate-500">ขอใช้รถ รอการอนุมัติ รับรถ ส่งตำแหน่งระหว่างขับ และคืนรถ</p>
        </div>
        <Link href="/vehicles/new" prefetch={false} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab]">
          <Plus className="h-4 w-4" /> ขอใช้รถ
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {canSeeAll && (
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
            {(['all', 'mine'] as const).map((s) => (
              <Link key={s} href={href({ scope: s })} prefetch={false} className={`px-3 py-1.5 font-medium ${scope === s ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
                {s === 'all' ? 'ทุกคน' : 'ของฉัน'}
              </Link>
            ))}
          </div>
        )}
        {FILTERS.map((f) => (
          <Link key={f.key} href={href({ filter: f.key })} prefetch={false} className={`rounded-full border px-3 py-1 font-medium ${filter.key === f.key ? 'border-[#2453d4] bg-blue-50 text-[#2453d4]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {f.label}
          </Link>
        ))}
      </div>

      {trips.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">ยังไม่มีรายการ</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {trips.map((t) => (
            <li key={t.id}>
              <Link href={`/vehicles/${t.id}`} prefetch={false} className="block h-full rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-xs transition hover:border-[#2453d4]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{t.plateNo || t.vehicleCode}</p>
                    <p className="text-slate-500">{t.vehicleName}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TRIP_STATUS_TONE[t.status]}`}>{TRIP_STATUS_LABEL[t.status]}</span>
                </div>
                <p className="mt-2 line-clamp-2 font-medium text-slate-800">{t.purpose}</p>
                <dl className="mt-2 space-y-0.5 text-slate-600">
                  <div>
                    <dt className="inline text-slate-400">เวลา </dt>
                    <dd className="inline">
                      {formatThaiDateTime(t.plannedStart)} – {formatThaiDateTime(t.plannedEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-400">ผู้ขับ </dt>
                    <dd className="inline">{t.driverName}</dd>
                    {t.projectCode && <dd className="inline"> · {t.projectCode}</dd>}
                  </div>
                  {t.distanceKm !== null && (
                    <div>
                      <dt className="inline text-slate-400">ระยะทาง </dt>
                      <dd className="inline">{t.distanceKm.toLocaleString('th-TH')} กม.</dd>
                    </div>
                  )}
                </dl>
                <p className="mt-2 text-[11px] text-slate-400">{t.number}</p>
                {t.overdue && (
                  <p className="mt-1 inline-flex items-center gap-1 font-semibold text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5" /> เกินเวลาคืนรถ
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
