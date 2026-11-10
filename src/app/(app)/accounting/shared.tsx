import { formatMoneyDisplay } from '@/domain/money';

export const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const money = (v: number) => formatMoneyDisplay(v.toFixed(2));
export const selectCls = 'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs';

/** Year and month from the query string, defaulting to the current Bangkok month */
export function periodOf(sp: { year?: string; month?: string }, today: string) {
  const year = Number(sp.year) || Number(today.slice(0, 4));
  const month = Math.min(12, Math.max(1, Number(sp.month) || Number(today.slice(5, 7))));
  return { year, month };
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export function MonthYearFields({ year, month, years }: { year: number; month: number; years: number[] }) {
  return (
    <>
      <select name="month" defaultValue={month} aria-label="เดือน" className={selectCls}>
        {THAI_MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select name="year" defaultValue={year} aria-label="ปี" className={selectCls}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y + 543}
          </option>
        ))}
      </select>
    </>
  );
}

export const yearsAround = (year: number) => [year - 2, year - 1, year, year + 1];
