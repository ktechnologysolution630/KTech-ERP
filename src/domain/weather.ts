/** Thai provinces with the approximate coordinates of their capital: [name, latitude, longitude]. */
const PROVINCES: readonly [string, number, number][] = [
  ['กรุงเทพมหานคร', 13.75, 100.52], ['กระบี่', 8.09, 98.91], ['กาญจนบุรี', 14.02, 99.53], ['กาฬสินธุ์', 16.43, 103.51],
  ['กำแพงเพชร', 16.48, 99.52], ['ขอนแก่น', 16.44, 102.83], ['จันทบุรี', 12.61, 102.1], ['ฉะเชิงเทรา', 13.69, 101.07],
  ['ชลบุรี', 13.36, 100.98], ['ชัยนาท', 15.19, 100.13], ['ชัยภูมิ', 15.81, 102.03], ['ชุมพร', 10.49, 99.18],
  ['เชียงราย', 19.91, 99.84], ['เชียงใหม่', 18.79, 98.98], ['ตรัง', 7.56, 99.61], ['ตราด', 12.24, 102.52],
  ['ตาก', 16.88, 99.13], ['นครนายก', 14.21, 101.21], ['นครปฐม', 13.82, 100.06], ['นครพนม', 17.41, 104.78],
  ['นครราชสีมา', 14.97, 102.1], ['นครศรีธรรมราช', 8.43, 99.96], ['นครสวรรค์', 15.7, 100.14], ['นนทบุรี', 13.86, 100.51],
  ['นราธิวาส', 6.43, 101.82], ['น่าน', 18.78, 100.78], ['บึงกาฬ', 18.36, 103.65], ['บุรีรัมย์', 14.99, 103.1],
  ['ปทุมธานี', 14.02, 100.53], ['ประจวบคีรีขันธ์', 11.81, 99.8], ['ปราจีนบุรี', 14.05, 101.37], ['ปัตตานี', 6.87, 101.25],
  ['พระนครศรีอยุธยา', 14.35, 100.57], ['พะเยา', 19.17, 99.9], ['พังงา', 8.45, 98.53], ['พัทลุง', 7.62, 100.08],
  ['พิจิตร', 16.44, 100.35], ['พิษณุโลก', 16.82, 100.26], ['เพชรบุรี', 13.11, 99.94], ['เพชรบูรณ์', 16.42, 101.16],
  ['แพร่', 18.14, 100.14], ['ภูเก็ต', 7.88, 98.39], ['มหาสารคาม', 16.18, 103.3], ['มุกดาหาร', 16.54, 104.72],
  ['แม่ฮ่องสอน', 19.3, 97.97], ['ยโสธร', 15.79, 104.15], ['ยะลา', 6.54, 101.28], ['ร้อยเอ็ด', 16.05, 103.65],
  ['ระนอง', 9.96, 98.64], ['ระยอง', 12.68, 101.28], ['ราชบุรี', 13.54, 99.82], ['ลพบุรี', 14.8, 100.65],
  ['ลำปาง', 18.29, 99.49], ['ลำพูน', 18.57, 99.01], ['เลย', 17.49, 101.72], ['ศรีสะเกษ', 15.12, 104.32],
  ['สกลนคร', 17.16, 104.15], ['สงขลา', 7.19, 100.6], ['สตูล', 6.62, 100.07], ['สมุทรปราการ', 13.6, 100.6],
  ['สมุทรสงคราม', 13.41, 100.0], ['สมุทรสาคร', 13.55, 100.27], ['สระแก้ว', 13.82, 102.07], ['สระบุรี', 14.53, 100.91],
  ['สิงห์บุรี', 14.89, 100.4], ['สุโขทัย', 17.01, 99.82], ['สุพรรณบุรี', 14.47, 100.12], ['สุราษฎร์ธานี', 9.14, 99.33],
  ['สุรินทร์', 14.88, 103.49], ['หนองคาย', 17.88, 102.74], ['หนองบัวลำภู', 17.2, 102.44], ['อ่างทอง', 14.59, 100.45],
  ['อำนาจเจริญ', 15.86, 104.63], ['อุดรธานี', 17.41, 102.79], ['อุตรดิตถ์', 17.63, 100.1], ['อุทัยธานี', 15.38, 100.02],
  ['อุบลราชธานี', 15.24, 104.85],
];

const ALIASES: Record<string, string> = { กรุงเทพ: 'กรุงเทพมหานคร', กทม: 'กรุงเทพมหานคร', 'กทม.': 'กรุงเทพมหานคร', อยุธยา: 'พระนครศรีอยุธยา', โคราช: 'นครราชสีมา' };

/** Short names are ordinary words or parts of names ("เลย", "ตาก" in "ตากสิน"), so they count only after "จังหวัด"/"จ.". */
const MIN_UNPREFIXED_LENGTH = 5;

export interface Province {
  name: string;
  lat: number;
  lon: number;
}

const toProvince = (name: string): Province | null => {
  const p = PROVINCES.find(([n]) => n === (ALIASES[name] ?? name));
  return p ? { name: p[0], lat: p[1], lon: p[2] } : null;
};

/** Finds the province named in a project's free-text location, or null if none is recognisable. */
export function findProvince(location: string): Province | null {
  const text = location.trim();
  if (!text) return null;
  const names = [...PROVINCES.map(([n]) => n), ...Object.keys(ALIASES)].sort((a, b) => b.length - a.length);
  const exact = names.find((n) => text === n || text.includes(`จังหวัด${n}`) || text.includes(`จ.${n}`) || text.includes(`จ. ${n}`));
  if (exact) return toProvince(exact);
  const loose = names.find((n) => n.length >= MIN_UNPREFIXED_LENGTH && text.includes(n));
  return loose ? toProvince(loose) : null;
}

/** One point of a met.no locationforecast timeseries (only the fields used). */
export interface ForecastPoint {
  time: string;
  data: {
    instant: { details: { air_temperature?: number; wind_speed?: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number } };
  };
}

export interface DayForecast {
  date: string;
  maxTemp: number;
  minTemp: number;
  temperature: number;
  rainMm: number;
  windKmh: number;
  condition: string;
  normal: boolean;
}

/** Conditions from most to least severe; a day is described by the worst one forecast. */
const CONDITIONS: [RegExp, string][] = [
  [/thunder/, 'ฝนฟ้าคะนอง'],
  [/heavyrain/, 'ฝนตกหนัก'],
  [/rain|sleet|snow/, 'ฝนตก'],
  [/fog/, 'หมอก'],
  [/^cloudy/, 'เมฆมาก'],
  [/partlycloudy/, 'มีเมฆบางส่วน'],
  [/fair|clearsky/, 'แจ่มใส'],
];

/** Calendar date of an instant in Thailand (UTC+7). */
const bangkokDate = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Summarises one Bangkok-time calendar day of a forecast; null when the forecast does not cover it. */
export function summarizeForecast(points: ForecastPoint[], date: string): DayForecast | null {
  const day = points.filter((p) => bangkokDate(p.time) === date);
  const temps = day.map((p) => p.data.instant.details.air_temperature).filter((t): t is number => t !== undefined);
  if (temps.length === 0) return null;

  // Hourly near-term, then 6-hourly steps; each step counts only its own span so rain is not added twice
  let rain = 0;
  for (let i = 0; i < day.length; i++) {
    const p = day[i]!;
    const hourly = p.data.next_1_hours?.details?.precipitation_amount;
    const hoursToNext = i + 1 < day.length ? (Date.parse(day[i + 1]!.time) - Date.parse(p.time)) / 3_600_000 : 1;
    if (hourly !== undefined && hoursToNext <= 1) rain += hourly;
    else rain += p.data.next_6_hours?.details?.precipitation_amount ?? hourly ?? 0;
  }

  const symbols = day.flatMap((p) => [p.data.next_1_hours?.summary?.symbol_code, p.data.next_6_hours?.summary?.symbol_code]).filter((s): s is string => !!s);
  const condition = CONDITIONS.find(([re]) => symbols.some((s) => re.test(s)))?.[1] ?? '-';
  const windKmh = Math.max(0, ...day.map((p) => (p.data.instant.details.wind_speed ?? 0) * 3.6));
  const roundedWind = Math.round(windKmh);

  return {
    date,
    maxTemp: Math.round(Math.max(...temps)),
    minTemp: Math.round(Math.min(...temps)),
    temperature: Math.round(temps[0]!),
    rainMm: round1(rain),
    windKmh: roundedWind,
    condition,
    // Heads-up rather than an official warning: heavy rain or strong wind can stop site work
    normal: !/ฟ้าคะนอง|หนัก/.test(condition) && rain < 35 && roundedWind < 40,
  };
}
