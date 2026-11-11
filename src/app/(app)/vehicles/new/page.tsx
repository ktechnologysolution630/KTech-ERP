import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { listDriverOptions, listUpcomingBookings, listVehicles } from '@/server/services/vehicles';
import { TripRequestForm } from './trip-request-form';

export default async function NewVehicleTripPage({ searchParams }: { searchParams: Promise<{ vehicle?: string }> }) {
  const actor = await requireUser();
  const db = await getDb();
  const params = await searchParams;
  const [vehicles, drivers, projects, bookings] = await Promise.all([listVehicles(db), listDriverOptions(db), listProjects(db, actor), listUpcomingBookings(db)]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">ขอใช้รถ</h1>
        <p className="text-xs text-slate-500">เมื่อได้รับอนุมัติ ผู้ขับจะรับรถ ถ่ายรูป และส่งตำแหน่งจากมือถือระหว่างใช้งาน</p>
      </div>
      <TripRequestForm
        vehicles={vehicles.filter((v) => v.bookable).map((v) => ({ id: v.id, label: `${v.plateNo || v.code} · ${v.name}` }))}
        drivers={drivers}
        projects={projects.map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }))}
        bookings={bookings.map((b) => ({ ...b, start: b.start.toISOString(), end: b.end.toISOString() }))}
        me={actor.id}
        initialVehicle={params.vehicle}
      />
    </div>
  );
}
