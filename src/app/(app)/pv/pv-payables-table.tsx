import { formatMoneyDisplay } from '@/domain/money';

/** A bill the voucher can pay: ticked when it is on the voucher, with the withholding rate to take */
export interface PvPayableRow {
  id: string;
  note: string;
  poNumber: string | null;
  invoiceNo: string | null;
  dueDate: string | null;
  beforeVat: string;
  gross: string;
  whtRate: number;
  checked: boolean;
}

const WHT_OPTIONS: [number, string][] = [
  [0, 'ไม่หัก (0%)'],
  [1, '1% (ขนส่ง)'],
  [2, '2% (โฆษณา)'],
  [3, '3% (บริการ/รับเหมา)'],
  [5, '5% (ค่าเช่า)'],
];

/**
 * The bills of one vendor as form fields: a payableId checkbox and a wht_<id> rate per row, read by
 * the create and edit pages' server actions
 */
export function PvPayablesTable({ rows }: { rows: PvPayableRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-slate-50 text-slate-600">
        <tr>
          <th className="px-3 py-2 text-left">เลือก</th>
          <th className="px-3 py-2 text-left">รายการ / อ้างอิง</th>
          <th className="px-3 py-2 text-left">ครบกำหนด</th>
          <th className="px-3 py-2 text-right">ก่อน VAT</th>
          <th className="px-3 py-2 text-right">ยอดรวม</th>
          <th className="px-3 py-2 text-right">หัก ณ ที่จ่าย (%)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((p) => {
          // A rate set some other way still shows as it is
          const options = WHT_OPTIONS.some(([v]) => v === p.whtRate) ? WHT_OPTIONS : [...WHT_OPTIONS, [p.whtRate, `${p.whtRate}%`] as [number, string]];
          return (
            <tr key={p.id}>
              <td className="px-3 py-2">
                <input type="checkbox" name="payableId" value={p.id} defaultChecked={p.checked} aria-label={`เลือก ${p.note}`} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-slate-800">{p.note}</div>
                <div className="text-slate-500">
                  {p.poNumber ? `PO: ${p.poNumber}` : ''} {p.invoiceNo ? `· IV: ${p.invoiceNo}` : ''}
                </div>
              </td>
              <td className="px-3 py-2">{p.dueDate ?? '-'}</td>
              <td className="px-3 py-2 text-right">฿{formatMoneyDisplay(p.beforeVat)}</td>
              <td className="px-3 py-2 text-right font-semibold">฿{formatMoneyDisplay(p.gross)}</td>
              <td className="px-3 py-2 text-right">
                <select name={`wht_${p.id}`} defaultValue={String(p.whtRate)} aria-label={`หัก ณ ที่จ่ายของ ${p.note}`} className="rounded border border-slate-300 px-2 py-1">
                  {options.map(([v, label]) => (
                    <option key={v} value={String(v)}>
                      {label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The ticked bills and their rates, as the PV services take them */
export function readPvPayables(fd: FormData): { payableIds: string[]; whtRates: Record<string, number>; note: string } {
  const payableIds = fd.getAll('payableId').map(String);
  const whtRates: Record<string, number> = {};
  for (const pid of payableIds) whtRates[pid] = Number(fd.get(`wht_${pid}`) ?? 0);
  return { payableIds, whtRates, note: String(fd.get('note') ?? '') };
}
