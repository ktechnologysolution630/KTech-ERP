import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getFleetLive } from '@/server/services/vehicles';
import { LiveFleet } from './live-fleet';

/** ติดตามรถ Realtime: every vehicle that is out, on a map that refreshes itself */
export default async function VehicleLivePage() {
  const actor = await requireUser();
  if (!can(actor, 'vehicle.track')) redirect('/vehicles');
  const initial = await getFleetLive(await getDb(), actor);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">ติดตามรถ Realtime</h1>
        <p className="text-xs text-slate-500">ตำแหน่งจากมือถือผู้ขับ อัปเดตอัตโนมัติทุก 10 วินาที</p>
      </div>
      <LiveFleet initial={initial} />
    </div>
  );
}
