import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { projects } from '@/db/schema';
import { findProvince, summarizeForecast, type ForecastPoint } from '@/domain/weather';
import { clearForecastCache, getProjectForecast } from '@/server/services/weather';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

const point = (time: string, temp: number, wind: number, oneHour?: [string, number], sixHours?: [string, number]): ForecastPoint => ({
  time,
  data: {
    instant: { details: { air_temperature: temp, wind_speed: wind } },
    ...(oneHour ? { next_1_hours: { summary: { symbol_code: oneHour[0] }, details: { precipitation_amount: oneHour[1] } } } : {}),
    ...(sixHours ? { next_6_hours: { summary: { symbol_code: sixHours[0] }, details: { precipitation_amount: sixHours[1] } } } : {}),
  },
});

describe('province matching', () => {
  test('finds provinces and refuses words that merely contain a short name', () => {
    expect(findProvince('จังหวัดชัยภูมิ')?.name).toBe('ชัยภูมิ');
    expect(findProvince('ต.ในเมือง อ.เมือง จ.ขอนแก่น')?.name).toBe('ขอนแก่น');
    expect(findProvince('ชัยภูมิ')?.name).toBe('ชัยภูมิ');
    expect(findProvince('ถนนพระราม 9 กรุงเทพฯ')?.name).toBe('กรุงเทพมหานคร');
    expect(findProvince('สาขาโคราช')?.name).toBe('นครราชสีมา');
    expect(findProvince('อ.แม่สอด จ.ตาก')?.name).toBe('ตาก');
    expect(findProvince('ตาก')?.name).toBe('ตาก');
    // "ตาก" inside ตากสิน and the word "เลย" are not provinces
    expect(findProvince('ถนนตากสิน')).toBeNull();
    expect(findProvince('ไม่มีข้อมูลเลย')).toBeNull();
    expect(findProvince('เซ็นทรัลพระรามเก้า')).toBeNull();
    expect(findProvince('')).toBeNull();
  });
});

describe('forecast summary', () => {
  test('summarises the Bangkok calendar day, worst condition first, without double counting rain', () => {
    const points = [
      // 16:00Z on the 3rd is 23:00 on the 3rd in Bangkok: not this day
      point('2026-11-03T16:00:00Z', 40, 20, ['thunderstorm', 9]),
      point('2026-11-03T17:00:00Z', 25, 2, ['cloudy', 0.5]), // 00:00 on the 4th
      point('2026-11-03T18:00:00Z', 26, 5, ['rain', 1.5]),
      // 6-hourly from here: its 6-hour figure covers the step
      point('2026-11-04T00:00:00Z', 34, 3, undefined, ['partlycloudy', 2]),
      point('2026-11-04T06:00:00Z', 35, 1, undefined, ['thunderstorm', 4]),
      point('2026-11-04T18:00:00Z', 24, 1, ['clearsky', 9]), // 01:00 on the 5th
    ];
    const day = summarizeForecast(points, '2026-11-04');
    expect(day).toMatchObject({ maxTemp: 35, minTemp: 25, temperature: 25, windKmh: 18, condition: 'ฝนฟ้าคะนอง', normal: false });
    expect(day!.rainMm).toBeCloseTo(0.5 + 1.5 + 2 + 4, 1);
    expect(summarizeForecast(points, '2026-12-25')).toBeNull();

    const calm = summarizeForecast([point('2026-11-05T01:00:00Z', 30, 2, ['fair', 0])], '2026-11-05');
    expect(calm).toMatchObject({ condition: 'แจ่มใส', rainMm: 0, normal: true });
  });
});

describe('project forecast', () => {
  let db: Db;
  let f: SeededBasics;
  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
    clearForecastCache();
    await db.update(projects).set({ location: 'จังหวัดชัยภูมิ' }).where(eq(projects.id, f.projectA));
  });
  afterEach(() => vi.restoreAllMocks());

  const ok = () => new Response(JSON.stringify({ properties: { timeseries: [point('2026-11-04T01:00:00Z', 30, 2, ['rain', 1])] } }));

  test('sends only province coordinates, caches, and reports each failure as a status', async () => {
    const fetcher = vi.fn(async () => ok()) as unknown as typeof fetch;
    const first = await getProjectForecast(db, f.users.foreman, f.projectA, '2026-11-04', fetcher);
    expect(first).toMatchObject({ status: 'OK', province: 'ชัยภูมิ', forecast: { condition: 'ฝนตก' } });
    const calls = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[0]![0]).toContain('lat=15.81&lon=102.03');
    expect((calls[0]![1].headers as Record<string, string>)['User-Agent']).toContain('KTech-ERP');

    expect(await getProjectForecast(db, f.users.foreman, f.projectA, '2026-11-25', fetcher)).toEqual({ status: 'OUT_OF_RANGE', province: 'ชัยภูมิ' });
    expect(calls).toHaveLength(1);

    await expect(getProjectForecast(db, f.users.otherForeman, f.projectA, '2026-11-04', fetcher)).rejects.toMatchObject({ status: 403 });

    await db.update(projects).set({ location: 'ไซต์งานหลัก' }).where(eq(projects.id, f.projectA));
    expect(await getProjectForecast(db, f.users.foreman, f.projectA, '2026-11-04', fetcher)).toEqual({ status: 'NO_PROVINCE' });
  });

  test('an outage or bad response never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const down = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await getProjectForecast(db, f.users.foreman, f.projectA, '2026-11-04', down)).toEqual({ status: 'UNAVAILABLE', province: 'ชัยภูมิ' });
    const bad = (async () => new Response('{}')) as unknown as typeof fetch;
    expect((await getProjectForecast(db, f.users.foreman, f.projectA, '2026-11-04', bad)).status).toBe('UNAVAILABLE');
    const refused = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    expect((await getProjectForecast(db, f.users.foreman, f.projectA, '2026-11-04', refused)).status).toBe('UNAVAILABLE');
  });
});
