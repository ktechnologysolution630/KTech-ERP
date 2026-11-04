import { eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { projects, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { findProvince, summarizeForecast, type DayForecast, type ForecastPoint } from '@/domain/weather';
import { assertCan } from '@/server/policy';

export type ProjectForecast =
  | { status: 'OK'; province: string; forecast: DayForecast }
  /** The project's location names no province we can recognise */
  | { status: 'NO_PROVINCE' }
  /** The forecast only reaches about 9 days ahead and has no past */
  | { status: 'OUT_OF_RANGE'; province: string }
  | { status: 'UNAVAILABLE'; province: string };

const API = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
// met.no's terms require an identifying User-Agent and asks clients not to refetch needlessly
const USER_AGENT = 'KTech-ERP https://github.com/ktechnologysolution630/KTech-ERP';
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

const cache = new Map<string, { at: number; points: ForecastPoint[] }>();

async function fetchPoints(key: string, lat: number, lon: number, fetcher: typeof fetch): Promise<ForecastPoint[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.points;
  const res = await fetcher(`${API}?lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`met.no responded ${res.status}`);
  const json = (await res.json()) as { properties?: { timeseries?: ForecastPoint[] } };
  const points = json.properties?.timeseries;
  if (!Array.isArray(points)) throw new Error('met.no response has no timeseries');
  cache.set(key, { at: Date.now(), points });
  return points;
}

export function clearForecastCache() {
  cache.clear();
}

/**
 * Forecast for the province in the project's location. Only the province's coordinates leave the
 * system. A weather outage must never block writing a report, so failures come back as a status.
 */
export async function getProjectForecast(db: Db, actor: SessionUser, projectId: string, date: string, fetcher: typeof fetch = fetch): Promise<ProjectForecast> {
  assertCan(actor, 'project.view', { projectId });
  const [project] = await db.select({ location: projects.location }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  const province = findProvince(project.location);
  if (!province) return { status: 'NO_PROVINCE' };
  try {
    const forecast = summarizeForecast(await fetchPoints(province.name, province.lat, province.lon, fetcher), date);
    return forecast ? { status: 'OK', province: province.name, forecast } : { status: 'OUT_OF_RANGE', province: province.name };
  } catch (err) {
    console.error('weather forecast failed', err);
    return { status: 'UNAVAILABLE', province: province.name };
  }
}
