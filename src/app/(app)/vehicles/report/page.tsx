import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { formatMoneyDisplay } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { formatThaiDateTime } from '@/domain/vehicle';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getVehicleReport } from '@/server/services/vehicles';

const baht = (n: number) => formatMoneyDisplay(n.toFixed(2));
const km = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 1 });

function Table({ title, head, rows, empty = 'ไม่มีข้อมูลในช่วงนี้' }: { title: string; head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={`px-3 py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={head.length} className="px-3 py-6 text-center text-slate-500">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={`px-3 py-2 ${j === 0 ? 'text-left' : 'text-right'}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** รายงานการใช้รถ: distance and cost by vehicle, driver and project; vehicles due for service; late and damaged returns */
export default async function VehicleReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, 'vehicle.track')) redirect('/vehicles');
  const params = await searchParams;
  const today = bangkokDateString();
  const from = params.from || `${today.slice(0, 8)}01`;
  const to = params.to || today;
  let report;
  try {
    report = await getVehicleReport(await getDb(), actor, { from, to });
  } catch (err) {
    if (err instanceof DomainError) redirect('/vehicles/report');
    throw err;
  }
  const totals = report.byVehicle.reduce((t, v) => ({ trips: t.trips + v.trips, km: t.km + v.km, cost: t.cost + v.cost }), { trips: 0, km: 0, cost: 0 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">รายงานการใช้รถ</h1>
          <p className="text-xs text-slate-500">นับรายการที่คืนรถแล้วในช่วงวันที่ที่เลือก ระยะทางตามเลขไมล์</p>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-xs">
          <label className="space-y-1">
            <span className="block font-semibold text-slate-700">ตั้งแต่</span>
            <input type="date" name="from" defaultValue={from} className="rounded-lg border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="block font-semibold text-slate-700">ถึง</span>
            <input type="date" name="to" defaultValue={to} className="rounded-lg border border-slate-300 px-2 py-1.5" />
          </label>
          <button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 font-semibold text-white">
            แสดง
          </button>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        {[
          ['จำนวนเที่ยว', totals.trips.toLocaleString('th-TH')],
          ['ระยะทางรวม', `${km(totals.km)} กม.`],
          ['ค่าใช้จ่ายรวม', `${baht(totals.cost)} บาท`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-slate-500">{l}</p>
            <p className="text-lg font-bold text-slate-900">{v}</p>
          </div>
        ))}
      </div>

      {(report.overdue.length > 0 || report.service.length > 0 || report.damaged.length > 0) && (
        <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
          <h2 className="text-sm font-bold">ต้องติดตาม</h2>
          <ul className="space-y-1">
            {report.overdue.map((t) => (
              <li key={t.id}>
                <Link href={`/vehicles/${t.id}`} prefetch={false} className="font-semibold underline">
                  {t.plateNo || t.vehicleCode}
                </Link>{' '}
                ยังไม่คืนรถ เกินกำหนด {formatThaiDateTime(t.plannedEnd)} · {t.driverName}
              </li>
            ))}
            {report.service.map((s) => (
              <li key={s.assetId}>
                <strong>{s.plateNo || s.code}</strong> ถึงรอบซ่อมบำรุงที่ {km(s.dueAtKm)} กม. ({s.remainingKm <= 0 ? `เลยมา ${km(-s.remainingKm)}` : `เหลือ ${km(s.remainingKm)}`} กม.)
              </li>
            ))}
            {report.damaged.map((t) => (
              <li key={t.id}>
                <Link href={`/vehicles/${t.id}`} prefetch={false} className="font-semibold underline">
                  {t.plateNo || t.vehicleCode}
                </Link>{' '}
                แจ้งความเสียหาย: {t.damage} · {t.driverName}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Table
        title="แยกตามรถ"
        head={['รถ', 'เที่ยว', 'ระยะทาง (กม.)', 'น้ำมัน (ลิตร)', 'ค่าใช้จ่าย (บาท)', 'บาท/กม.']}
        rows={report.byVehicle.map((v) => [`${v.plateNo || v.code} ${v.name}`, v.trips, km(v.km), v.liters ? km(v.liters) : '-', baht(v.cost), v.costPerKm === null ? '-' : baht(v.costPerKm)])}
      />
      <Table title="แยกตามผู้ขับ" head={['ผู้ขับ', 'เที่ยว', 'ระยะทาง (กม.)', 'ค่าใช้จ่าย (บาท)']} rows={report.byDriver.map((d) => [d.name, d.trips, km(d.km), baht(d.cost)])} />
      <Table title="แยกตามโครงการ" head={['โครงการ', 'เที่ยว', 'ระยะทาง (กม.)', 'ค่าใช้จ่าย (บาท)']} rows={report.byProject.map((p) => [`${p.code} ${p.name}`, p.trips, km(p.km), baht(p.cost)])} />
    </div>
  );
}
