import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { agoText, formatThaiDateTime, fuelLabel, LIVE_STATE_LABEL, TRIP_STATUS_LABEL, TRIP_STATUS_TONE } from '@/domain/vehicle';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getTrip, listVehicles } from '@/server/services/vehicles';
import { DriverTracker } from './driver-tracker';
import { CancelTripButton, DecisionPanel, ExpensesPanel, HandoverForm, TripRouteMap } from './trip-panels';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export default async function VehicleTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  let trip;
  try {
    trip = await getTrip(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  const vehicle = (await listVehicles(db)).find((v) => v.id === trip.assetId);
  const startPhotos = trip.photos.filter((p) => p.stage === 'START');
  const endPhotos = trip.photos.filter((p) => p.stage === 'END');
  const canAddExpense = (trip.status === 'IN_USE' || trip.status === 'RETURNED') && (trip.isDriver || trip.requestedBy === actor.id || can(actor, 'vehicle.approve'));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/vehicles" prefetch={false} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> กลับไปรายการใช้รถ
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {trip.plateNo || trip.vehicleCode} <span className="text-base font-medium text-slate-500">{trip.vehicleName}</span>
          </h1>
          <p className="text-xs text-slate-500">
            {trip.number} · ขอโดย {trip.requesterName} เมื่อ {formatThaiDateTime(trip.createdAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${TRIP_STATUS_TONE[trip.status]}`}>{TRIP_STATUS_LABEL[trip.status]}</span>
          {trip.canCancel && <CancelTripButton tripId={trip.id} />}
        </div>
      </div>

      {trip.overdue && (
        <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          <AlertTriangle className="h-4 w-4" /> เกินเวลาคืนรถที่จองไว้ ({formatThaiDateTime(trip.plannedEnd)})
        </p>
      )}
      {trip.status === 'REJECTED' && trip.decisionNote && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <strong>ไม่อนุมัติโดย {trip.decidedByName}:</strong> {trip.decisionNote}
        </p>
      )}

      {trip.canApprove && <DecisionPanel tripId={trip.id} />}

      {/* What the driver does next, at the top where a phone shows it first */}
      {trip.status === 'APPROVED' && trip.canHandle && <HandoverForm tripId={trip.id} stage="START" minOdometer={vehicle?.odometerKm ?? null} />}
      {trip.status === 'IN_USE' && trip.isDriver && <DriverTracker tripId={trip.id} />}
      {trip.status === 'IN_USE' && trip.canHandle && <HandoverForm tripId={trip.id} stage="END" minOdometer={trip.startOdometerKm} />}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <Row label="วัตถุประสงค์">{trip.purpose}</Row>
          <Row label="ปลายทาง">{trip.destination || '-'}</Row>
          <Row label="ช่วงเวลาที่จอง">
            {formatThaiDateTime(trip.plannedStart)} – {formatThaiDateTime(trip.plannedEnd)}
          </Row>
          <Row label="ผู้ขับ">{trip.driverName}</Row>
          <Row label="โครงการ">{trip.projectCode ? `${trip.projectCode} ${trip.projectName}` : 'สำนักงาน / ส่วนกลาง'}</Row>
          {trip.decidedByName && trip.status !== 'REJECTED' && <Row label="อนุมัติโดย">{`${trip.decidedByName} · ${formatThaiDateTime(trip.decidedAt)}`}</Row>}
        </dl>
      </section>

      {(trip.startedAt || trip.endedAt) && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { title: 'ตอนรับรถ', at: trip.startedAt, km: trip.startOdometerKm, fuel: trip.startFuel, note: trip.startNote, photos: startPhotos, damage: '' },
            { title: 'ตอนคืนรถ', at: trip.endedAt, km: trip.endOdometerKm, fuel: trip.endFuel, note: trip.endNote, photos: endPhotos, damage: trip.damage },
          ]
            .filter((s) => s.at)
            .map((s) => (
              <div key={s.title} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs">
                <h2 className="text-sm font-bold text-slate-900">{s.title}</h2>
                <dl className="grid grid-cols-2 gap-2">
                  <Row label="เวลา">{formatThaiDateTime(s.at)}</Row>
                  <Row label="เลขไมล์">{s.km !== null ? `${s.km.toLocaleString('th-TH')} กม.` : '-'}</Row>
                  <Row label="น้ำมัน">{fuelLabel(s.fuel)}</Row>
                  {s.note && <Row label="หมายเหตุ">{s.note}</Row>}
                </dl>
                {s.damage && <p className="rounded-lg bg-red-50 px-2 py-1.5 font-semibold text-red-700">ความเสียหาย: {s.damage}</p>}
                <div className="flex flex-wrap gap-2">
                  {s.photos.map((p, i) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={`${s.title} รูปที่ ${i + 1}`} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            ))}
        </section>
      )}

      {trip.distanceKm !== null && (
        <section className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-slate-500">ระยะทางตามเลขไมล์</p>
            <p className="text-lg font-bold text-slate-900">{trip.distanceKm.toLocaleString('th-TH')} กม.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-slate-500">ระยะทางตาม GPS (โดยประมาณ)</p>
            <p className="text-lg font-bold text-slate-900">{trip.gpsKm.toLocaleString('th-TH')} กม.</p>
          </div>
        </section>
      )}

      {(trip.status === 'IN_USE' || trip.status === 'RETURNED') && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">เส้นทาง</h2>
            {trip.live && (
              <span className="text-xs text-slate-600">
                {LIVE_STATE_LABEL[trip.live]} · อัปเดต {agoText(trip.lastSeenAt)}
              </span>
            )}
          </div>
          <TripRouteMap
            tripId={trip.id}
            live={trip.status === 'IN_USE'}
            last={trip.lastLat !== null && trip.lastLng !== null && trip.live ? { lat: trip.lastLat, lng: trip.lastLng, state: trip.live, label: trip.plateNo || trip.vehicleCode } : null}
          />
        </section>
      )}

      {(trip.status === 'IN_USE' || trip.status === 'RETURNED') && (
        <ExpensesPanel
          tripId={trip.id}
          canAdd={canAddExpense}
          expenses={trip.expenses.map((e) => ({ ...e, canRemove: e.createdBy === actor.id || can(actor, 'vehicle.approve') }))}
        />
      )}
    </div>
  );
}
