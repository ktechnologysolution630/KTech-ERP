import { getDb } from '@/db/client';
import { formatMoneyDisplay } from '@/domain/money';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { isSiteScopedOnly } from '@/server/policy';
import { ALL_KEY, CENTRAL_KEY, cardStores, getStockCard, listCardItems } from '@/server/services/stock-card';
import { AutoSubmitForm } from '@/components/auto-submit-form';
import { SearchSelect } from '@/components/search-select';

const TYPE_LABEL = { RECEIVE: 'รับเข้า', ISSUE: 'เบิก/จ่ายออก', TRANSFER: 'โอนย้าย', ADJUST: 'ปรับปรุง (AJ)', RETURN: 'รับคืน' } as const;
const field = 'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs';
const money = (v: number) => (v === 0 ? '' : formatMoneyDisplay(v.toFixed(2)));
const qty = (v: number) => (v === 0 ? '' : v.toLocaleString('th-TH', { maximumFractionDigits: 3 }));
const qs = (sp: Record<string, string>) => new URLSearchParams(sp).toString();

type Sp = { item?: string; store?: string; from?: string; to?: string };

/** สมุดคุมสต็อก: one item's movements at one store with quantity and moving-average value */
export default async function StockCardPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const today = bangkokDateString();
  const [items, stores] = await Promise.all([listCardItems(db), cardStores(db, actor)]);
  const scoped = isSiteScopedOnly(actor);
  const itemId = sp.item && items.some((i) => i.id === sp.item) ? sp.item : items[0]?.id;
  const store = sp.store || (scoped ? CENTRAL_KEY : ALL_KEY);
  const from = sp.from || `${today.slice(0, 7)}-01`;
  const to = sp.to || today;
  const card = itemId ? await getStockCard(db, actor, { stockItemId: itemId, store, from, to }) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">สมุดคุมสต็อก (Stock Card)</h1>
        <p className="text-xs text-slate-500">ความเคลื่อนไหวรับเข้า-จ่ายออก-โอน-ปรับปรุงของสินค้าแต่ละตัว แยกตามคลัง คิดมูลค่าแบบต้นทุนเฉลี่ยเคลื่อนที่ (Moving Average)</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <AutoSubmitForm className="flex flex-wrap items-end gap-2">
          <SearchSelect name="item" defaultValue={itemId} aria-label="สินค้า" className={`${field} max-w-xs`}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} {i.name}
              </option>
            ))}
          </SearchSelect>
          <SearchSelect name="store" defaultValue={store} aria-label="คลัง" className={field}>
            {!scoped && <option value={ALL_KEY}>ทุกคลังรวมกัน</option>}
            {stores.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </SearchSelect>
          <label className="text-[11px] text-slate-500">
            ตั้งแต่ <input type="date" name="from" defaultValue={from} className={field} />
          </label>
          <label className="text-[11px] text-slate-500">
            ถึง <input type="date" name="to" defaultValue={to} className={field} />
          </label>
        </AutoSubmitForm>
        {card && (
          <a href={`/api/csv/stock-card?${qs({ item: card.item.id, store, from, to })}`} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            Export CSV
          </a>
        )}
      </div>
      {!card ? (
        <p className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">ยังไม่มีสินค้าในทะเบียน</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['สินค้า', `${card.item.sku} ${card.item.name}`],
              ['คลัง', card.storeName],
              ['คงเหลือ', `${qty(card.closing.qty) || '0'} ${card.item.unit}`],
              ['มูลค่าคงเหลือ / ทุนเฉลี่ย', `${money(card.closing.value) || '0.00'} / ${money(card.closing.avgCost) || '0.00'}`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[11px] text-slate-500">{l}</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">{v}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1000px] text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium">วันที่</th>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium">เลขที่ / อ้างอิง</th>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium">รายการ</th>
                  <th colSpan={2} className="px-3 py-1 text-center font-medium">รับเข้า</th>
                  <th colSpan={2} className="px-3 py-1 text-center font-medium">จ่ายออก</th>
                  <th rowSpan={2} className="px-3 py-2 text-right font-medium">ทุน/หน่วย</th>
                  <th colSpan={3} className="px-3 py-1 text-center font-medium">คงเหลือ</th>
                </tr>
                <tr>
                  {['จำนวน', 'มูลค่า', 'จำนวน', 'มูลค่า', 'จำนวน', 'มูลค่า', 'ทุนเฉลี่ย'].map((h, i) => (
                    <th key={i} className="px-3 py-1 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50 text-slate-600">
                  <td className="px-3 py-1.5">{formatThaiDate(from)}</td>
                  <td colSpan={7} className="px-3 py-1.5">
                    ยอดยกมา
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{qty(card.opening.qty) || '0'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(card.opening.value) || '0.00'}</td>
                  <td />
                </tr>
                {card.rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400">
                      ไม่มีความเคลื่อนไหวในช่วงนี้
                    </td>
                  </tr>
                )}
                {card.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatThaiDate(r.date)}</td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono">{r.number}</span>
                      {r.reference && <span className="block text-[10px] text-slate-400">{r.reference}</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {TYPE_LABEL[r.type]}
                      {r.notes && <span className="block max-w-[220px] truncate text-[10px] text-slate-400">{r.notes}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{qty(r.qtyIn)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.valueIn)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{qty(r.qtyOut)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.valueOut)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.unitCost)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{qty(r.balanceQty) || '0'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.balanceValue) || '0.00'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.avgCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
