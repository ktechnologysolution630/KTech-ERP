'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Calendar, CheckCircle2, FileText, Package, Plus, Search, XCircle } from 'lucide-react';
import { GsapReveal } from '@/components/gsap-animator';
import type { StockItemDto, StockMovementDto, StockPageData } from '@/server/services/stock';
import { decideStockAdjustAction } from './actions';
import { ItemDialog, MovementDialog, type MovementKind } from './stock-dialogs';

const CATEGORY_COLORS = ['#4f8df7', '#32b8eb', '#8b5cf6', '#2563eb', '#0ea5a4', '#7c3aed'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TYPE_LABEL: Record<string, string> = { RECEIVE: 'รับเข้า', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย', ADJUST: 'ปรับยอด', RETURN: 'รับคืน' };
const TYPE_BADGE: Record<string, string> = {
  RECEIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ISSUE: 'bg-rose-50 text-rose-700 border-rose-200',
  TRANSFER: 'bg-blue-50 text-blue-700 border-blue-200',
  ADJUST: 'bg-purple-50 text-purple-700 border-purple-200',
};
const ADJUST_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'รออนุมัติ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED: { label: 'อนุมัติแล้ว', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED: { label: 'ไม่อนุมัติ', cls: 'bg-red-50 text-red-700 border-red-200' },
};
const CENTRAL = 'CENTRAL';
const locKey = (projectId: string | null) => projectId ?? CENTRAL;

const baht = (n: number, digits = 2) => n.toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const qtyText = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
const dateText = (d: Date | string) => new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${TH_MONTHS[m - 1]} ${String((y + 543) % 100).padStart(2, '0')}`;
};

function donut(segments: { color: string; percent: number }[]) {
  if (segments.length === 0) return 'conic-gradient(#e2e8f0 0deg 360deg)';
  let at = 0;
  const parts = segments.map((s) => {
    const from = at;
    at += Math.max(4, (s.percent / 100) * 360);
    return `${s.color} ${from}deg ${Math.min(360, at)}deg`;
  });
  if (at < 360) parts.push(`#e2e8f0 ${at}deg 360deg`);
  return `conic-gradient(${parts.join(', ')})`;
}

/** Balance change a movement causes at one location (or across all locations when key is undefined). */
function deltaAt(m: StockMovementDto, key: string | undefined): number {
  const src = locKey(m.projectId);
  if (m.type === 'TRANSFER') {
    if (key === undefined) return 0;
    if (key === src) return -m.quantity;
    if (key === locKey(m.targetProjectId)) return m.quantity;
    return 0;
  }
  if (key !== undefined && key !== src) return 0;
  if (m.type === 'ISSUE') return -m.quantity;
  return m.quantity; // RECEIVE, RETURN, ADJUST (signed)
}

const card = 'overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.3)]';
const tableHead = 'bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0';

export function StockClient({ data }: { data: StockPageData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';
  const setTab = (tab: string) => router.push(`/stock?tab=${tab}`);

  const [movementDialog, setMovementDialog] = useState<{ kind: MovementKind; itemId?: string } | null>(null);
  const [itemDialog, setItemDialog] = useState<{ item: StockItemDto | null } | null>(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('All');
  const [chartMonths, setChartMonths] = useState<6 | 12>(6);

  const canMoveAnything = data.permissions.moveCentral || data.permissions.movableProjectIds.length > 0;
  const q = search.trim().toLowerCase();

  const filteredMovements = data.movements.filter((m) => {
    if (typeFilter !== 'All' && m.type !== typeFilter) return false;
    if (locationFilter !== 'All' && locKey(m.projectId) !== locationFilter && locKey(m.targetProjectId) !== locationFilter) return false;
    if (q && ![m.itemName, m.sku, m.movementNumber, m.fromName, m.toName].some((s) => s.toLowerCase().includes(q))) return false;
    return true;
  });

  const showTopBar = currentTab === 'overview' || currentTab === 'movements';

  return (
    <div className="space-y-4 font-sans text-slate-800">
      {showTopBar && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาวัสดุ, SKU, เลขที่เอกสาร, ต้นทาง, ปลายทาง..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (currentTab === 'overview' && e.target.value) setTab('movements');
              }}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-[#2453d4]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-xs">
              <span className="text-slate-400 text-[11px]">ประเภท:</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-transparent font-medium text-xs focus:outline-none">
                <option value="All">ทั้งหมด</option>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-xs">
              <span className="text-slate-400 text-[11px]">คลัง:</span>
              <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="bg-transparent font-medium text-xs focus:outline-none max-w-[220px]">
                <option value="All">ทั้งหมด</option>
                {data.locations.map((l) => (
                  <option key={locKey(l.projectId)} value={locKey(l.projectId)}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {canMoveAnything && (
              <button
                type="button"
                onClick={() => setMovementDialog({ kind: 'RECEIVE' })}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm"
              >
                <Plus className="w-4 h-4" />
                สร้างรายการ
              </button>
            )}
          </div>
        </div>
      )}

      {currentTab === 'overview' && <OverviewTab data={data} chartMonths={chartMonths} setChartMonths={setChartMonths} onSeeAll={() => setTab('all-stock')} />}
      {currentTab === 'movements' && <MovementsTab movements={filteredMovements} />}
      {currentTab === 'low-stock' && (
        <LowStockTab
          items={data.items}
          canEdit={data.permissions.manageItems}
          onEdit={(item) => setItemDialog({ item })}
          onReorder={(item) => setMovementDialog({ kind: 'RECEIVE', itemId: item.id })}
          canMove={canMoveAnything}
        />
      )}
      {currentTab === 'issues' && <LedgerTab data={data} />}
      {currentTab === 'material-usage' && (
        <UsageTab data={data} canRecord={canMoveAnything} onRecord={() => setMovementDialog({ kind: 'ISSUE' })} />
      )}
      {currentTab === 'all-stock' && (
        <AllStockTab
          data={data}
          onCreateItem={data.permissions.manageItems ? () => setItemDialog({ item: null }) : undefined}
          onEditItem={data.permissions.manageItems ? (item) => setItemDialog({ item }) : undefined}
          onHistory={() => setTab('document-history')}
        />
      )}
      {currentTab === 'document-history' && <AdjustHistoryTab data={data} onBack={() => setTab('all-stock')} />}

      {movementDialog && (
        <MovementDialog data={data} initialKind={movementDialog.kind} initialItemId={movementDialog.itemId} onClose={() => setMovementDialog(null)} />
      )}
      {itemDialog && <ItemDialog item={itemDialog.item} poLines={data.poLineOptions} onClose={() => setItemDialog(null)} />}
    </div>
  );
}

function OverviewTab({
  data,
  chartMonths,
  setChartMonths,
  onSeeAll,
}: {
  data: StockPageData;
  chartMonths: 6 | 12;
  setChartMonths: (m: 6 | 12) => void;
  onSeeAll: () => void;
}) {
  const months = data.monthly.slice(-chartMonths);
  const peak = Math.max(1, ...months.flatMap((m) => [m.receiveValue, m.issueValue]));
  const hasFlow = months.some((m) => m.receiveCount + m.issueCount > 0);

  const totalValue = data.items.reduce((s, i) => s + i.totalValue, 0);
  const byCategory = new Map<string, { count: number; value: number }>();
  for (const it of data.items) {
    const c = byCategory.get(it.category) ?? { count: 0, value: 0 };
    c.count += 1;
    c.value += it.totalValue;
    byCategory.set(it.category, c);
  }
  const categories = [...byCategory.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .map(([label, c], i) => ({
      label,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      count: c.count,
      value: c.value,
      percent: totalValue > 0 ? (c.value / totalValue) * 100 : 0,
    }));

  const byLocation = data.locations
    .map((l) => {
      let value = 0;
      let count = 0;
      for (const it of data.items) {
        const b = it.balances.find((x) => locKey(x.projectId) === locKey(l.projectId));
        if (b && b.quantity > 0) {
          count += 1;
          value += b.quantity * it.unitCost;
        }
      }
      return { name: l.name, count, value };
    })
    .filter((l) => l.count > 0)
    .sort((a, b) => b.value - a.value);
  const maxLoc = Math.max(1, ...byLocation.map((l) => l.value));

  return (
    <GsapReveal className="space-y-4">
      <section className={card}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">รับเข้า - จ่ายออกย้อนหลัง {chartMonths === 6 ? '6 เดือน' : '1 ปี'}</h2>
            <p className="text-xs text-slate-500">มูลค่าตามราคาทุน (บาท) และจำนวนรายการ</p>
          </div>
          <select
            value={chartMonths}
            onChange={(e) => setChartMonths(Number(e.target.value) as 6 | 12)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs outline-none"
          >
            <option value={6}>6 เดือน</option>
            <option value={12}>1 ปี</option>
          </select>
        </div>
        {hasFlow ? (
          <>
            <div className="flex items-end gap-2 h-48 border-b border-slate-200 px-1">
              {months.map((m) => (
                <div key={m.month} className="flex-1 flex items-end justify-center gap-1 h-full" title={`${monthLabel(m.month)}: รับเข้า ฿${baht(m.receiveValue)} (${m.receiveCount}) · จ่ายออก ฿${baht(m.issueValue)} (${m.issueCount})`}>
                  <div className="w-1/3 max-w-6 rounded-t bg-emerald-500" style={{ height: `${(m.receiveValue / peak) * 100}%` }} />
                  <div className="w-1/3 max-w-6 rounded-t bg-rose-400" style={{ height: `${(m.issueValue / peak) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="grid gap-2 text-center text-xs text-slate-500 pt-2" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
              {months.map((m) => (
                <span key={m.month}>{monthLabel(m.month)}</span>
              ))}
            </div>
            <div className="mt-3 flex justify-center gap-4 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> รับเข้า
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> จ่ายออก
              </span>
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400">ยังไม่มีข้อมูลการเคลื่อนไหวในช่วงเวลานี้</div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={card}>
          <div className="mb-5">
            <h3 className="text-base font-bold text-slate-900">สต็อกตามหมวดวัสดุ</h3>
            <p className="text-xs text-slate-500">แสดงทั้งจำนวนรายการและมูลค่าตามราคาทุน</p>
          </div>
          <div className="grid gap-5 lg:grid-cols-[240px_1fr] lg:items-center">
            <div className="mx-auto grid h-[200px] w-[200px] place-items-center rounded-full shadow-inner" style={{ background: donut(categories) }}>
              <div className="grid h-[120px] w-[120px] place-items-center rounded-full bg-white text-center shadow-xs">
                <div>
                  <div className="text-[11px] text-slate-400">รวมทั้งสิ้น</div>
                  <div className="text-base font-bold text-slate-950">{data.items.length.toLocaleString('th-TH')} รายการ</div>
                  <div className="text-xs font-semibold text-[#2453d4]">฿{baht(totalValue)}</div>
                </div>
              </div>
            </div>
            <div className="space-y-2.5">
              {categories.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-4">ไม่มีข้อมูลหมวดหมู่</div>
              ) : (
                categories.map((c) => (
                  <div key={c.label} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                      <span className="truncate text-slate-700 font-medium">{c.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-right shrink-0">
                      <span className="text-slate-400 text-[11px]">{c.percent.toFixed(1)}%</span>
                      <span className="text-slate-600">{c.count} รายการ</span>
                      <span className="font-semibold text-slate-900">฿{baht(c.value, 0)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className={card}>
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">สต็อกตามคลัง / โครงการ</h3>
              <p className="text-xs text-slate-500">จำนวนรายการที่มีของและมูลค่าตามราคาทุน</p>
            </div>
            <button type="button" onClick={onSeeAll} className="text-xs font-medium text-[#2453d4] hover:underline">
              ดูทั้งหมด
            </button>
          </div>
          <div className="space-y-4">
            {byLocation.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-8">ยังไม่มีสต็อกคงเหลือ</div>
            ) : (
              byLocation.map((l) => (
                <div key={l.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-semibold text-slate-800 truncate">{l.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-slate-500">{l.count} รายการ</span>
                      <span className="font-bold text-slate-900">฿{baht(l.value)}</span>
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#2453d4]" style={{ width: `${Math.max(4, (l.value / maxLoc) * 100)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </GsapReveal>
  );
}

function MovementsTab({ movements }: { movements: StockMovementDto[] }) {
  return (
    <GsapReveal>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">รายการเคลื่อนไหวล่าสุด</h2>
          <span className="text-xs text-slate-500">{movements.length} รายการ</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className={tableHead}>
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">วันที่ / เลขที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ประเภท</th>
                <th className="px-3.5 py-2.5 text-left font-medium">วัสดุ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ต้นทาง</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ปลายทาง</th>
                <th className="px-3.5 py-2.5 text-right font-medium">จำนวน</th>
                <th className="px-3.5 py-2.5 text-right font-medium">มูลค่า</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้ทำรายการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    ไม่พบรายการเคลื่อนไหว
                  </td>
                </tr>
              ) : (
                movements.map((m) => {
                  const sign = m.type === 'ISSUE' ? '-' : m.type === 'ADJUST' && m.quantity < 0 ? '' : m.type === 'TRANSFER' ? '' : '+';
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <div className="text-slate-600">{dateText(m.date)}</div>
                        <div className="font-mono text-[10px] text-slate-400">{m.movementNumber}</div>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${TYPE_BADGE[m.type]}`}>{TYPE_LABEL[m.type]}</span>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium text-slate-900">{m.itemName}</div>
                        <div className="font-mono text-[10px] text-slate-400">{m.sku}</div>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-600">{m.fromName}</td>
                      <td className="px-3.5 py-2.5 text-slate-600">{m.toName}</td>
                      <td className="px-3.5 py-2.5 text-right font-bold text-slate-900 whitespace-nowrap">
                        {sign}
                        {qtyText(m.quantity)} {m.unit}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-slate-600">฿{baht(m.value)}</td>
                      <td className="px-3.5 py-2.5 text-slate-500">{m.performedByName}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </GsapReveal>
  );
}

function LowStockTab({
  items,
  canEdit,
  canMove,
  onEdit,
  onReorder,
}: {
  items: StockItemDto[];
  canEdit: boolean;
  canMove: boolean;
  onEdit: (item: StockItemDto) => void;
  onReorder: (item: StockItemDto) => void;
}) {
  const withPoint = items.filter((i) => i.reorderPoint > 0).sort((a, b) => Number(b.isLowStock) - Number(a.isLowStock));
  const lowCount = withPoint.filter((i) => i.isLowStock).length;
  return (
    <GsapReveal>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">แจ้งเตือนวัสดุใกล้หมด</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            รายการที่ตั้งจุดสั่งซื้อไว้ · ตัวเลขสีแดงคือคงเหลือไม่เกินจุดสั่งซื้อ ({lowCount} รายการ) · ตั้งจุดสั่งซื้อได้จากปุ่ม &quot;แก้ไข&quot; หรือแท็บสต็อกทั้งหมด
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead className={tableHead}>
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">วัสดุ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">คงเหลือ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">จุดสั่งซื้อ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">คงเหลือแยกคลัง</th>
                <th className="px-3.5 py-2.5 text-center font-medium w-40">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {withPoint.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    ยังไม่มีรายการที่ตั้งจุดสั่งซื้อ
                  </td>
                </tr>
              ) : (
                withPoint.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-3.5 py-2.5">
                      <div className="font-semibold text-slate-900">{it.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {it.sku} · {it.category}
                      </div>
                    </td>
                    <td className={`px-3.5 py-2.5 text-right font-bold ${it.isLowStock ? 'text-rose-600' : 'text-slate-900'}`}>
                      {qtyText(it.totalQty)} {it.unit}
                    </td>
                    <td className="px-3.5 py-2.5 text-right text-slate-600">
                      {qtyText(it.reorderPoint)} {it.unit}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-500">
                      {it.balances.filter((b) => b.quantity > 0).map((b) => `${b.locationName}: ${qtyText(b.quantity)}`).join(' · ') || '-'}
                    </td>
                    <td className="px-3.5 py-2.5 text-center space-x-1.5 whitespace-nowrap">
                      {canEdit && (
                        <button type="button" onClick={() => onEdit(it)} className="px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-medium">
                          แก้ไข
                        </button>
                      )}
                      {canMove && it.isLowStock && (
                        <button type="button" onClick={() => onReorder(it)} className="px-2.5 py-1 rounded bg-[#2453d4] text-white text-[11px] font-medium">
                          รับเข้า
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </GsapReveal>
  );
}

/** Stock card: every movement of one item with a running balance, optionally per location. */
function LedgerTab({ data }: { data: StockPageData }) {
  const [chosenItemId, setItemId] = useState(data.items[0]?.id ?? '');
  const [loc, setLoc] = useState('All');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  // Text that names an item (name / SKU / category) narrows the item list and shows that item's card
  const itemMatches = q ? data.items.filter((i) => `${i.sku} ${i.name} ${i.category}`.toLowerCase().includes(q)) : [];
  const itemOptions = itemMatches.length > 0 ? itemMatches : data.items;
  const itemId = itemMatches.length > 0 && !itemMatches.some((i) => i.id === chosenItemId) ? itemMatches[0]!.id : chosenItemId;
  const item = data.items.find((i) => i.id === itemId);
  const key = loc === 'All' ? undefined : loc;

  const rows = useMemo(() => {
    if (!item) return [];
    const relevant = data.movements
      .filter((m) => m.stockItemId === item.id && deltaAt(m, key) !== 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const current = key === undefined ? item.totalQty : (item.balances.find((b) => locKey(b.projectId) === key)?.quantity ?? 0);
    // Opening balance before the oldest movement still in the 13-month window
    let running = current - relevant.reduce((s, m) => s + deltaAt(m, key), 0);
    const opening = running;
    const list = relevant.map((m) => {
      const delta = deltaAt(m, key);
      running += delta;
      return { m, delta, balance: running };
    });
    return [{ opening }, ...list.reverse()];
  }, [data.movements, item, key]);

  // Otherwise the text filters the card's lines (document, reference, from/to, recorded by, note);
  // balances stay those of the full card
  const filterLines = q !== '' && itemMatches.length === 0;
  const lineMatches = (m: StockMovementDto) =>
    [m.movementNumber, m.referenceNumber ?? '', m.fromName, m.toName, m.performedByName, m.notes, TYPE_LABEL[m.type]]
      .join(' ')
      .toLowerCase()
      .includes(q);
  const shownLines = rows.filter((r): r is Exclude<(typeof rows)[number], { opening: number }> => !('opening' in r) && (!filterLines || lineMatches(r.m)));

  return (
    <GsapReveal>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">รายงานความเคลื่อนไหวสินค้า</h2>
            <p className="text-xs text-slate-400">บัตรคุมสินค้า: รับ-จ่ายทุกรายการพร้อมยอดคงเหลือ (ย้อนหลัง 13 เดือน)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="py-1.5 px-3 text-xs border border-slate-200 rounded-lg bg-white max-w-[280px]">
              {data.items.length === 0 && <option value="">ยังไม่มีรายการวัสดุ</option>}
              {itemOptions.map((it) => (
                <option key={it.id} value={it.id}>
                  [{it.sku}] {it.name}
                </option>
              ))}
            </select>
            <select value={loc} onChange={(e) => setLoc(e.target.value)} className="py-1.5 px-3 text-xs border border-slate-200 rounded-lg bg-white max-w-[220px]">
              <option value="All">ทุกคลัง</option>
              {data.locations.map((l) => (
                <option key={locKey(l.projectId)} value={locKey(l.projectId)}>
                  {l.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs">
              <FileText className="w-3.5 h-3.5" /> พิมพ์
            </button>
          </div>
        </div>
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาสินค้า, SKU, เอกสาร, ต้นทาง, ปลายทาง..."
              aria-label="ค้นหาในรายงานความเคลื่อนไหวสินค้า"
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-[#2453d4]"
            />
          </div>
          {q && (
            <p className="mt-1.5 text-[11px] text-slate-500" role="status">
              {itemMatches.length > 0
                ? `พบสินค้า ${itemMatches.length} รายการที่ตรงกับ “${search.trim()}” — เลือกได้จากช่องด้านบน`
                : `ไม่พบชื่อสินค้า — แสดงเฉพาะรายการเคลื่อนไหวที่ตรงกับ “${search.trim()}” (${shownLines.length} รายการ)`}
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className={tableHead}>
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium">เลขที่ / อ้างอิง</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ประเภท</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ต้นทาง → ปลายทาง</th>
                <th className="px-3.5 py-2.5 text-right font-medium">รับ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">จ่าย</th>
                <th className="px-3.5 py-2.5 text-right font-medium">คงเหลือ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้บันทึก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!item ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    เลือกสินค้าเพื่อดูความเคลื่อนไหว
                  </td>
                </tr>
              ) : filterLines && shownLines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    ไม่พบรายการเคลื่อนไหวที่ตรงกับ “{search.trim()}”
                  </td>
                </tr>
              ) : (
                shownLines.map((r) =>
                  (
                    <tr key={r.m.id} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{dateText(r.m.date)}</td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-mono text-[#2453d4]">{r.m.movementNumber}</div>
                        {r.m.referenceNumber && <div className="text-[10px] text-slate-400">{r.m.referenceNumber}</div>}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${TYPE_BADGE[r.m.type]}`}>{TYPE_LABEL[r.m.type]}</span>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-600">
                        {r.m.fromName} → {r.m.toName}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-emerald-700 font-semibold">{r.delta > 0 ? qtyText(r.delta) : ''}</td>
                      <td className="px-3.5 py-2.5 text-right text-rose-600 font-semibold">{r.delta < 0 ? qtyText(-r.delta) : ''}</td>
                      <td className="px-3.5 py-2.5 text-right font-bold text-slate-900">
                        {qtyText(r.balance)} {item.unit}
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-500">{r.m.performedByName}</td>
                    </tr>
                  ),
                )
              )}
              {item && (
                <tr className="bg-slate-50">
                  <td colSpan={6} className="px-3.5 py-2 text-right text-slate-500">
                    ยอดยกมา
                  </td>
                  <td className="px-3.5 py-2 text-right font-semibold text-slate-700">
                    {qtyText((rows[0] as { opening: number }).opening)} {item.unit}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </GsapReveal>
  );
}

function UsageTab({ data, canRecord, onRecord }: { data: StockPageData; canRecord: boolean; onRecord: () => void }) {
  const [mode, setMode] = useState<'monthly' | 'cumulative'>('monthly');
  const [loc, setLoc] = useState('All');
  const months = data.monthly.slice(-6).map((m) => m.month);

  const issues = data.movements.filter((m) => m.type === 'ISSUE' && (loc === 'All' || locKey(m.projectId) === loc));
  // rows = item × location, cells = value per month (monthly) or running total (cumulative)
  const rows = new Map<string, { item: string; unit: string; location: string; perMonth: Record<string, { qty: number; value: number }> }>();
  for (const m of issues) {
    const ym = (() => {
      const t = new Date(new Date(m.date).getTime() + 7 * 3600_000);
      return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
    })();
    if (!months.includes(ym)) continue;
    const k = `${m.stockItemId}|${locKey(m.projectId)}`;
    const row = rows.get(k) ?? { item: m.itemName, unit: m.unit, location: m.fromName, perMonth: {} };
    const cell = row.perMonth[ym] ?? { qty: 0, value: 0 };
    cell.qty += m.quantity;
    cell.value += m.value;
    row.perMonth[ym] = cell;
    rows.set(k, row);
  }
  const list = [...rows.values()];
  const totals = months.map((ym) => list.reduce((s, r) => s + (r.perMonth[ym]?.value ?? 0), 0));
  const shown = (r: (typeof list)[number], i: number) => {
    if (mode === 'monthly') return r.perMonth[months[i]] ?? { qty: 0, value: 0 };
    return months.slice(0, i + 1).reduce((a, ym) => ({ qty: a.qty + (r.perMonth[ym]?.qty ?? 0), value: a.value + (r.perMonth[ym]?.value ?? 0) }), { qty: 0, value: 0 });
  };

  return (
    <GsapReveal className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">บันทึกการใช้วัสดุ</h1>
        {canRecord && (
          <button type="button" onClick={onRecord} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm">
            <Plus className="w-4 h-4" />
            บันทึกการใช้วัสดุ
          </button>
        )}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">ภาพรวมการใช้วัสดุ 6 เดือนล่าสุด</h2>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs">
              <FileText className="w-3.5 h-3.5 text-slate-500" /> รายงานการเบิกใช้วัสดุ
            </button>
            <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
              {(['monthly', 'cumulative'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-3 py-1 rounded-md ${mode === m ? 'font-semibold bg-white text-[#2453d4] shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {m === 'monthly' ? 'รายเดือน' : 'สะสม'}
                </button>
              ))}
            </div>
            <select value={loc} onChange={(e) => setLoc(e.target.value)} className="text-xs rounded-lg border border-slate-200 px-3 py-1.5 bg-white max-w-[220px]">
              <option value="All">ทุกคลัง / โครงการ</option>
              {data.locations.map((l) => (
                <option key={locKey(l.projectId)} value={locKey(l.projectId)}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className={tableHead}>
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">วัสดุ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">คลัง / โครงการ</th>
                {months.map((ym) => (
                  <th key={ym} className="px-3.5 py-2.5 text-right font-medium">
                    {monthLabel(ym)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.length === 0 ? (
                <tr>
                  <td colSpan={2 + months.length} className="py-12 text-center text-slate-400">
                    ยังไม่มีการเบิกใช้วัสดุในช่วงนี้
                  </td>
                </tr>
              ) : (
                list.map((r) => (
                  <tr key={`${r.item}-${r.location}`} className="hover:bg-slate-50">
                    <td className="px-3.5 py-2.5 font-medium text-slate-900">{r.item}</td>
                    <td className="px-3.5 py-2.5 text-slate-600">{r.location}</td>
                    {months.map((ym, i) => {
                      const c = shown(r, i);
                      return (
                        <td key={ym} className="px-3.5 py-2.5 text-right">
                          {c.qty > 0 ? (
                            <>
                              <div className="font-semibold">
                                {qtyText(c.qty)} {r.unit}
                              </div>
                              <div className="text-[10px] text-slate-400">฿{baht(c.value, 0)}</div>
                            </>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={2} className="px-3.5 py-2.5 text-right">
                    มูลค่ารวม{mode === 'cumulative' ? 'สะสม' : ''}
                  </td>
                  {months.map((ym, i) => (
                    <td key={ym} className="px-3.5 py-2.5 text-right">
                      ฿{baht(mode === 'monthly' ? totals[i] : totals.slice(0, i + 1).reduce((a, b) => a + b, 0), 0)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </GsapReveal>
  );
}

function AllStockTab({
  data,
  onCreateItem,
  onEditItem,
  onHistory,
}: {
  data: StockPageData;
  onCreateItem?: () => void;
  onEditItem?: (item: StockItemDto) => void;
  onHistory: () => void;
}) {
  const [search, setSearch] = useState('');
  const [drill, setDrill] = useState<string | null>(null);
  const q = search.trim().toLowerCase();

  const lastReceive = new Map<string, { date: Date; by: string }>();
  for (const m of data.movements) {
    if (m.type !== 'RECEIVE') continue;
    const k = locKey(m.projectId);
    if (!lastReceive.has(k)) lastReceive.set(k, { date: m.date, by: m.performedByName });
  }
  const locationRows = data.locations.map((l) => {
    const k = locKey(l.projectId);
    let count = 0;
    let qty = 0;
    let value = 0;
    for (const it of data.items) {
      const b = it.balances.find((x) => locKey(x.projectId) === k);
      if (b && b.quantity > 0) {
        count += 1;
        qty += b.quantity;
        value += b.quantity * it.unitCost;
      }
    }
    return { key: k, name: l.name, count, qty, value, last: lastReceive.get(k) };
  });

  const drillLocation = drill ? data.locations.find((l) => locKey(l.projectId) === drill) : null;
  const items = data.items.filter((it) => !q || it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q) || it.category.toLowerCase().includes(q));

  return (
    <GsapReveal className="space-y-3">
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="ค้นหาวัสดุ, SKU, หมวด..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-[#217346]"
          />
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onHistory} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            ประวัติเอกสารปรับยอด
          </button>
          {onCreateItem && (
            <button type="button" onClick={onCreateItem} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#217346] hover:bg-[#1b5e39] text-white text-xs font-semibold shadow-sm">
              <Plus className="w-4 h-4" />
              เพิ่มวัสดุ
            </button>
          )}
          <div className="text-right pl-3 border-l border-slate-200">
            <div className="text-xs font-bold text-slate-800">{locationRows.filter((l) => l.count > 0).length} คลังที่มีของ</div>
            <div className="text-[10px] text-slate-400">{data.items.length} รายการวัสดุ</div>
          </div>
        </div>
      </div>

      {drillLocation ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <button type="button" onClick={() => setDrill(null)} className="p-1 rounded hover:bg-slate-100 text-slate-500" title="ย้อนกลับ">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-bold text-slate-900">{drillLocation.name}</h2>
          </div>
          <ItemTable
            items={items
              .map((it) => ({ it, qty: it.balances.find((b) => locKey(b.projectId) === drill)?.quantity ?? 0 }))
              .filter((r) => r.qty > 0)}
            onEdit={onEditItem}
          />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px] text-xs">
                <thead className="bg-[#102d72] text-white">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">คลัง</th>
                    <th className="px-4 py-2.5 text-right font-medium">จำนวนรายการ</th>
                    <th className="px-4 py-2.5 text-right font-medium">จำนวนรวม</th>
                    <th className="px-4 py-2.5 text-right font-medium">มูลค่า</th>
                    <th className="px-4 py-2.5 text-left font-medium">วันที่รับเข้าล่าสุด</th>
                    <th className="px-4 py-2.5 text-left font-medium">ผู้รับเข้าล่าสุด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {locationRows.map((l) => (
                    <tr key={l.key} onClick={() => setDrill(l.key)} className="hover:bg-slate-50 cursor-pointer">
                      <td className="px-4 py-3 font-semibold text-[#217346]">
                        <span className="inline-flex items-center gap-2">
                          <Package className="w-4 h-4 text-slate-400" />
                          {l.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{l.count} รายการ</td>
                      <td className="px-4 py-3 text-right font-bold">{qtyText(l.qty)}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">฿{baht(l.value)}</td>
                      <td className="px-4 py-3 text-slate-500">{l.last ? dateText(l.last.date) : '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{l.last?.by ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="px-5 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">รายการวัสดุทั้งหมด</div>
            <ItemTable items={items.map((it) => ({ it, qty: it.totalQty }))} onEdit={onEditItem} />
          </div>
        </>
      )}
    </GsapReveal>
  );
}

function ItemTable({ items, onEdit }: { items: { it: StockItemDto; qty: number }[]; onEdit?: (item: StockItemDto) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left">SKU / วัสดุ</th>
            <th className="px-4 py-2 text-left">หมวด</th>
            <th className="px-4 py-2 text-right">คงเหลือ</th>
            <th className="px-4 py-2 text-right">ราคาทุน/หน่วย</th>
            <th className="px-4 py-2 text-right">มูลค่า</th>
            <th className="px-4 py-2 text-right">จุดสั่งซื้อ</th>
            {onEdit && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <tr>
              <td colSpan={onEdit ? 7 : 6} className="py-10 text-center text-slate-400">
                ไม่มีรายการ
              </td>
            </tr>
          ) : (
            items.map(({ it, qty }) => (
              <tr key={it.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-900">{it.name}</div>
                  <div className="font-mono text-[10px] text-slate-400">{it.sku}</div>
                </td>
                <td className="px-4 py-2 text-slate-600">{it.category}</td>
                <td className={`px-4 py-2 text-right font-semibold ${it.isLowStock ? 'text-rose-600' : ''}`}>
                  {qtyText(qty)} {it.unit}
                </td>
                <td className="px-4 py-2 text-right">฿{baht(it.unitCost)}</td>
                <td className="px-4 py-2 text-right">฿{baht(qty * it.unitCost)}</td>
                <td className="px-4 py-2 text-right text-slate-500">{it.reorderPoint > 0 ? qtyText(it.reorderPoint) : '-'}</td>
                {onEdit && (
                  <td className="px-4 py-2 text-right">
                    <button type="button" onClick={() => onEdit(it)} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-[11px]">
                      แก้ไข
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdjustHistoryTab({ data, onBack }: { data: StockPageData; onBack: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const decide = (id: string, approve: boolean) => {
    if (!confirm(approve ? 'อนุมัติปรับยอดสต็อกตามคำขอนี้?' : 'ไม่อนุมัติคำขอนี้?')) return;
    setError(null);
    startTransition(async () => {
      const r = await decideStockAdjustAction(id, approve);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <GsapReveal>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <button type="button" onClick={onBack} className="p-1 rounded hover:bg-slate-100 text-slate-500" title="ย้อนกลับ">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-bold text-slate-900">ประวัติเอกสารปรับยอดสต็อก</h2>
            <p className="text-xs text-slate-500">คำขอปรับยอดจากการตรวจนับ ต้องให้หัวหน้าจัดซื้อหรือผู้บริหารอนุมัติก่อนมีผล</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="px-5 py-2 text-xs text-red-600 font-medium">
            {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-xs">
            <thead className={tableHead}>
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">เลขที่ / วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium">วัสดุ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">คลัง</th>
                <th className="px-3.5 py-2.5 text-right font-medium">ยอดระบบ → ตรวจนับ</th>
                <th className="px-3.5 py-2.5 text-right font-medium">ส่วนต่าง</th>
                <th className="px-3.5 py-2.5 text-left font-medium">เหตุผล</th>
                <th className="px-3.5 py-2.5 text-left font-medium">ผู้ขอ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.adjustRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    ยังไม่มีคำขอปรับยอด
                  </td>
                </tr>
              ) : (
                data.adjustRequests.map((r) => {
                  const canDecide = data.permissions.approveAdjust && r.status === 'PENDING' && r.requestedBy !== data.me;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2.5">
                        <div className="font-mono font-semibold">{r.requestNumber}</div>
                        <div className="text-slate-400">{dateText(r.createdAt)}</div>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium">{r.itemName}</div>
                        <div className="font-mono text-[10px] text-slate-400">{r.sku}</div>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-600">{r.locationName}</td>
                      <td className="px-3.5 py-2.5 text-right">
                        {qtyText(r.currentQty)} → {qtyText(r.adjustedQty)} {r.unit}
                      </td>
                      <td className={`px-3.5 py-2.5 text-right font-bold ${r.differenceQty < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {r.differenceQty > 0 ? '+' : ''}
                        {qtyText(r.differenceQty)}
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-600 max-w-xs">{r.reason}</td>
                      <td className="px-3.5 py-2.5 text-slate-600">{r.requestedByName}</td>
                      <td className="px-3.5 py-2.5">
                        {canDecide ? (
                          <div className="flex gap-1.5">
                            <button type="button" disabled={isPending} onClick={() => decide(r.id, true)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-[11px] disabled:opacity-50">
                              <CheckCircle2 className="w-3 h-3" /> อนุมัติ
                            </button>
                            <button type="button" disabled={isPending} onClick={() => decide(r.id, false)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-red-600 text-[11px] disabled:opacity-50">
                              <XCircle className="w-3 h-3" /> ไม่อนุมัติ
                            </button>
                          </div>
                        ) : (
                          <div>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ADJUST_STATUS[r.status].cls}`}>{ADJUST_STATUS[r.status].label}</span>
                            {r.approvedByName && <div className="text-[10px] text-slate-400 mt-0.5">โดย {r.approvedByName}</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </GsapReveal>
  );
}
