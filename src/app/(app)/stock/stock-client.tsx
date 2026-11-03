'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Package,
  Layers,
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  Scale,
  Plus,
  Printer,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  FileText,
  Building2,
  Calendar,
  X,
  ChevronDown,
} from 'lucide-react';
import { GsapReveal } from '@/components/gsap-animator';
import {
  createStockItemAction,
  recordStockMovementAction,
  createStockAdjustRequestAction,
  approveStockAdjustAction,
} from './actions';
import type { StockOverviewData } from '@/server/services/stock';

interface StockClientProps {
  overview: StockOverviewData;
  allItems: Array<{
    id: string;
    sku: string;
    name: string;
    category: string;
    unit: string;
    unitCost: number;
    reorderPoint: number;
    totalQty: number;
    totalValue: number;
    isLowStock: boolean;
    balances: Array<{
      id: string;
      projectId: string | null;
      projectName: string;
      warehouseName: string;
      location: string;
      quantity: number;
    }>;
  }>;
  projects: Array<{ id: string; name: string }>;
  adjustRequests: Array<{
    id: string;
    requestNumber: string;
    sku: string;
    itemName: string;
    projectName: string;
    currentQty: number;
    adjustedQty: number;
    differenceQty: number;
    reason: string;
    status: string;
    requestedByName: string;
    createdAt: Date;
  }>;
  userRoles: string[];
}

const CATEGORY_COLORS = ['#4f8df7', '#32b8eb', '#8b5cf6', '#2563eb', '#0ea5a4', '#7c3aed'];

function cn(s: Array<{ color: string; percent: number }>) {
  if (s.length === 0) return 'conic-gradient(#e2e8f0 0deg 360deg)';
  let a = 0;
  const l = s.map((i) => {
    const b = a;
    const x = Math.max(6, (i.percent / 100) * 360);
    a += x;
    return `${i.color} ${b}deg ${Math.min(360, a)}deg`;
  });
  if (a < 360) l.push(`#e2e8f0 ${a}deg 360deg`);
  return `conic-gradient(${l.join(', ')})`;
}

export function StockClient({
  overview,
  allItems,
  projects,
  adjustRequests,
  userRoles,
}: StockClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterWarehouse, setFilterWarehouse] = useState('All');
  const [chartMonths, setChartMonths] = useState<6 | 12>(6);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSubTab, setCreateSubTab] = useState<'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'ADJUST'>('RECEIVE');
  const [showItemModal, setShowItemModal] = useState(false);
  const [selectedWarehouseForDrilldown, setSelectedWarehouseForDrilldown] = useState<string | null>(null);

  // Form states
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const [warehouseName, setWarehouseName] = useState('คลังหน้างาน พระราม 9');
  const [targetWarehouseName, setTargetWarehouseName] = useState('คลังกลาง (HQ)');
  const [movementQty, setMovementQty] = useState('');
  const [movementUnitCost, setMovementUnitCost] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [locationUsed, setLocationUsed] = useState('');
  const [movementNotes, setMovementNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New Item states
  const [newItemSku, setNewItemSku] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('วัสดุโครงสร้าง');
  const [newItemUnit, setNewItemUnit] = useState('ถุง');
  const [newItemUnitCost, setNewItemUnitCost] = useState('');
  const [newItemReorderPoint, setNewItemReorderPoint] = useState('');

  const setTab = (tab: string) => {
    router.push(`/stock?tab=${tab}`);
  };

  // Warehouses list
  const warehouseSet = new Set<string>();
  allItems.forEach((it) => {
    it.balances.forEach((b) => {
      if (b.warehouseName) warehouseSet.add(b.warehouseName);
    });
  });
  if (warehouseSet.size === 0) warehouseSet.add('คลังหน้างาน พระราม 9');
  const warehouses = Array.from(warehouseSet);

  // Categories with colors
  const totalCategoryVal = overview.categoryStats.reduce((sum, c) => sum + c.totalValue, 0);
  const categoryChartData = overview.categoryStats.map((c, i) => ({
    label: c.category,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    count: c.itemCount,
    value: c.totalValue,
    percent: totalCategoryVal > 0 ? (c.totalValue / totalCategoryVal) * 100 : 0,
  }));

  // Filtered movements for Movements Tab
  const filteredMovements = overview.recentMovements.filter((m) => {
    if (filterType !== 'All' && m.type !== filterType) return false;
    if (filterWarehouse !== 'All' && !m.projectName.includes(filterWarehouse)) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchItem = m.itemName.toLowerCase().includes(q);
      const matchNum = m.movementNumber.toLowerCase().includes(q);
      const matchProj = m.projectName.toLowerCase().includes(q);
      if (!matchItem && !matchNum && !matchProj) return false;
    }
    return true;
  });

  const monthLabels = chartMonths === 6
    ? ['มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.']
    : ['ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.'];

  return (
    <div className="space-y-4 font-sans text-slate-800">
      {/* Top Search & Filter Bar (reference layout: Image 4 & 5) */}
      {currentTab !== 'issues' &&
        currentTab !== 'material-usage' &&
        currentTab !== 'all-stock' &&
        currentTab !== 'low-stock' &&
        currentTab !== 'document-history' && (
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
            {/* Search Input with Q icon */}
            <div className="flex-1 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="ค้นหาวัสดุ, SKU, ต้นทาง, ปลายทาง..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-[#2453d4]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* ประเภท Dropdown */}
              <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-xs">
                <span className="text-slate-400 text-[11px]">ประเภท:</span>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="bg-transparent font-medium text-slate-800 text-xs focus:outline-none cursor-pointer"
                >
                  <option value="All">ทั้งหมด</option>
                  <option value="RECEIVE">รับเข้า</option>
                  <option value="ISSUE">จ่ายออก</option>
                  <option value="TRANSFER">โอนย้าย</option>
                  <option value="BORROW">ยืม</option>
                </select>
              </div>

              {/* คลัง/สาขา Dropdown */}
              <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-xs">
                <span className="text-slate-400 text-[11px]">คลัง/สาขา:</span>
                <select
                  value={filterWarehouse}
                  onChange={(e) => setFilterWarehouse(e.target.value)}
                  className="bg-transparent font-medium text-slate-800 text-xs focus:outline-none cursor-pointer"
                >
                  <option value="All">ทั้งหมด</option>
                  {warehouses.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>

              {/* + สร้างรายการ Button (#2453d4) */}
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                <span>สร้างรายการ</span>
              </button>
            </div>
          </div>
        )}

      {/* ================= TAB 1: OVERVIEW (Image 4) ================= */}
      {currentTab === 'overview' && (
        <GsapReveal className="space-y-4">
          {/* Card 1: รับเข้า - จ่ายออกย้อนหลัง 6 เดือน (Image 4) */}
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.3)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  รับเข้า - จ่ายออกย้อนหลัง {chartMonths === 6 ? '6 เดือน' : '1 ปี'}
                </h2>
                <p className="text-xs text-slate-500">แสดงจำนวนรายการและมูลค่า (บาท)</p>
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

            {/* Baseline 0 and month axis */}
            <div className="pt-10 pb-4">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <span>0</span>
                <div className="flex-1 border-b border-slate-200" />
              </div>

              <div
                className="grid gap-2 text-center text-xs text-slate-500 pt-2"
                style={{ gridTemplateColumns: `repeat(${monthLabels.length}, minmax(0, 1fr))` }}
              >
                {monthLabels.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>

              {/* Empty state caption from Image 4 */}
              <div className="mt-8 text-center text-xs text-slate-400">
                ยังไม่มีข้อมูลมูลค่าการเคลื่อนไหวในช่วงเวลานี้
              </div>
            </div>
          </section>

          {/* Cards 2 & 3: หมวดวัสดุ & ตามโครงการ (Image 4) */}
          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            {/* Card 2: สต็อกตามหมวดวัสดุ */}
            <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.3)]">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">สต็อกตามหมวดวัสดุ</h3>
                  <p className="text-xs text-slate-500">แสดงทั้งจำนวนรายการและมูลค่าตามราคาทุน</p>
                </div>
                <div className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">
                  จำนวนและราคาต้นทุน
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[240px_1fr] lg:items-center">
                {/* Conic Donut Chart */}
                <div
                  className="mx-auto grid h-[200px] w-[200px] place-items-center rounded-full shadow-inner"
                  style={{ background: cn(categoryChartData) }}
                >
                  <div className="grid h-[120px] w-[120px] place-items-center rounded-full bg-white text-center shadow-xs">
                    <div>
                      <div className="text-[11px] text-slate-400">รวมทั้งสิ้น</div>
                      <div className="text-base font-bold text-slate-950">
                        {overview.totalItems.toLocaleString('th-TH')} รายการ
                      </div>
                      <div className="text-xs font-semibold text-[#2453d4]">
                        ฿{overview.totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Legend list */}
                <div className="space-y-2.5">
                  {categoryChartData.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-4">ไม่มีข้อมูลหมวดหมู่</div>
                  ) : (
                    categoryChartData.map((t) => (
                      <div key={t.label} className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{ backgroundColor: t.color }}
                          />
                          <span className="truncate text-slate-700 font-medium">{t.label}</span>
                        </div>
                        <div className="flex items-center gap-2 text-right shrink-0">
                          <span className="text-slate-400 text-[11px]">{t.percent.toFixed(1)}%</span>
                          <span className="text-slate-600">{t.count} รายการ</span>
                          <span className="font-semibold text-slate-900">
                            ฿{t.value.toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Card 3: สต็อกตามโครงการ */}
            <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.3)]">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">สต็อกตามโครงการ</h3>
                  <p className="text-xs text-slate-500">แสดงทั้งจำนวนรายการและมูลค่าตามราคาทุน</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('all-stock')}
                  className="text-xs font-medium text-[#2453d4] hover:underline"
                >
                  ดูทั้งหมด
                </button>
              </div>

              <div className="space-y-4">
                {overview.projectStats.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-8">ไม่มีข้อมูลสต็อกในโครงการ</div>
                ) : (
                  overview.projectStats.map((p) => (
                    <div key={p.projectName} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">{p.projectName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">{p.itemCount} รายการ</span>
                          <span className="font-bold text-slate-900">
                            ฿{p.totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#2453d4] transition-all duration-700"
                          style={{ width: `${Math.max(6, p.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </GsapReveal>
      )}

      {/* ================= TAB 2: MOVEMENTS (Image 5) ================= */}
      {currentTab === 'movements' && (
        <GsapReveal>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            {/* Header: รายการเคลื่อนไหวล่าสุด | 0 รายการ (Image 5) */}
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">รายการเคลื่อนไหวล่าสุด</h2>
              <span className="text-xs text-slate-500">{filteredMovements.length} รายการ</span>
            </div>

            {/* Navy Header Table (Image 5) */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-xs">
                <thead className="bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0">
                  <tr>
                    <th className="px-3.5 py-2.5 text-left font-medium">วันที่</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ประเภท</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">วัสดุ</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ต้นทาง</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ปลายทาง</th>
                    <th className="px-3.5 py-2.5 text-right font-medium">จำนวน</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ผู้ทำรายการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                        ยังไม่มีรายการเคลื่อนไหวของบริษัทนี้
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition">
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">
                          {new Date(m.date).toLocaleDateString('th-TH', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              m.type === 'RECEIVE'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : m.type === 'ISSUE'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : m.type === 'TRANSFER'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-purple-50 text-purple-700 border border-purple-200'
                            }`}
                          >
                            {m.type === 'RECEIVE'
                              ? 'รับเข้า'
                              : m.type === 'ISSUE'
                              ? 'จ่ายออก'
                              : m.type === 'TRANSFER'
                              ? 'โอนย้าย'
                              : 'ปรับยอด'}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 font-medium text-slate-900">{m.itemName}</td>
                        <td className="px-3.5 py-2.5 text-slate-600">
                          {m.type === 'RECEIVE' ? 'ผู้ขาย / ใบสั่งซื้อ' : m.projectName}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600">
                          {m.type === 'RECEIVE' ? m.projectName : m.locationUsed || 'หน้างาน'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-slate-900">
                          {m.type === 'ISSUE' ? `-${m.quantity}` : `+${m.quantity}`} {m.unit}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-500">{m.performedByName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </GsapReveal>
      )}

      {/* ================= TAB 3: LOW STOCK (Image 2) ================= */}
      {currentTab === 'low-stock' && (
        <GsapReveal>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            {/* Header (Image 2) */}
            <div className="px-5 py-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">แจ้งเตือนวัสดุใกล้หมด</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  แสดงรายการที่ตั้งจุดสั่งซื้อไว้ โดยตัวเลขสีแดงคือรายการที่คงเหลือไม่เกินจุดสั่งซื้อ
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{overview.lowStockAlerts.length} รายการ</span>
                <button
                  type="button"
                  onClick={() => setShowItemModal(true)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition shadow-2xs"
                >
                  ตั้งค่าจุดสั่งซื้อ
                </button>
              </div>
            </div>

            {/* Navy Header Table (Image 2) */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px] text-xs">
                <thead className="bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0">
                  <tr>
                    <th className="px-3.5 py-2.5 text-left font-medium">วัสดุ</th>
                    <th className="px-3.5 py-2.5 text-right font-medium">คงเหลือ</th>
                    <th className="px-3.5 py-2.5 text-right font-medium">จุดสั่งซื้อ</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ที่มา / คลัง</th>
                    <th className="px-3.5 py-2.5 text-center font-medium w-24">ตั้งค่า</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.lowStockAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                        ยังไม่มีรายการที่ตั้งจุดสั่งซื้อของบริษัทนี้
                      </td>
                    </tr>
                  ) : (
                    overview.lowStockAlerts.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50 transition">
                        <td className="px-3.5 py-2.5">
                          <div className="font-semibold text-slate-900">{it.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{it.sku} · {it.category}</div>
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-rose-600">
                          {it.remaining} {it.unit}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-600">
                          {it.reorderPoint} {it.unit}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-500">คลังหน้างาน พระราม 9</td>
                        <td className="px-3.5 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => setShowItemModal(true)}
                            className="px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-medium transition"
                          >
                            แก้ไข
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </GsapReveal>
      )}

      {/* ================= TAB 4: ISSUES (Image 3) ================= */}
      {currentTab === 'issues' && (
        <GsapReveal>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            {/* Header (Image 3) */}
            <div className="px-5 py-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">รายงานความเคลื่อนไหวสินค้า</h2>
                <span className="text-xs text-slate-400">
                  {filteredMovements.filter((m) => m.type === 'ISSUE').length} รายการ
                </span>
              </div>

              <div className="flex items-center gap-2 flex-1 max-w-lg justify-end">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="ค้นหาสินค้า, SKU, เอกสาร, ต้นทาง, ปลายทาง..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-none border border-slate-200 focus:outline-none focus:border-[#2453d4]"
                  />
                </div>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="py-1.5 px-3 text-xs border border-slate-200 rounded-none bg-white text-slate-700 focus:outline-none"
                >
                  <option value="">เลือกสินค้า</option>
                  {allItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Navy Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-xs">
                <thead className="bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0">
                  <tr>
                    <th className="px-3.5 py-2.5 text-left font-medium">วันที่</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ประเภท</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">สินค้า/วัสดุ</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">เอกสารอ้างอิง</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ต้นทาง</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ปลายทาง</th>
                    <th className="px-3.5 py-2.5 text-right font-medium">จำนวน</th>
                    <th className="px-3.5 py-2.5 text-left font-medium">ผู้บันทึก</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMovements.filter((m) => m.type === 'ISSUE').length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                        ยังไม่มีข้อมูลความเคลื่อนไหวสินค้า
                      </td>
                    </tr>
                  ) : (
                    filteredMovements
                      .filter((m) => m.type === 'ISSUE')
                      .map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50 transition">
                          <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">
                            {new Date(m.date).toLocaleDateString('th-TH', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              เบิกใช้
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 font-medium text-slate-900">{m.itemName}</td>
                          <td className="px-3.5 py-2.5 font-mono text-[#2453d4]">{m.movementNumber}</td>
                          <td className="px-3.5 py-2.5 text-slate-600">{m.projectName}</td>
                          <td className="px-3.5 py-2.5 text-slate-600">{m.locationUsed || 'หน้างาน'}</td>
                          <td className="px-3.5 py-2.5 text-right font-bold text-slate-900">
                            -{m.quantity} {m.unit}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-500">{m.performedByName}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </GsapReveal>
      )}

      {/* ================= TAB 5: MATERIAL USAGE (Image 4) ================= */}
      {currentTab === 'material-usage' && (
        <GsapReveal className="space-y-4">
          {/* Top Title & Button (Image 4) */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">บันทึกการใช้วัสดุ</h1>
            <button
              type="button"
              onClick={() => {
                setCreateSubTab('ISSUE');
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2453d4] hover:bg-[#1c43ab] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>บันทึกการใช้วัสดุ</span>
            </button>
          </div>

          {/* Card: ภาพรวมการใช้วัสดุ (Image 4) */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900">ภาพรวมการใช้วัสดุ</h2>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-medium transition shadow-2xs"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  <span>รายงานการเบิกใช้วัสดุ</span>
                </button>

                <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
                  <button
                    type="button"
                    className="px-3 py-1 rounded-md font-semibold bg-white text-[#2453d4] shadow-xs"
                  >
                    รายเดือน
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded-md font-medium text-slate-600 hover:text-slate-900"
                  >
                    สะสม
                  </button>
                </div>

                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="text-xs rounded-lg border border-slate-200 px-3 py-1.5 bg-white text-slate-700 focus:outline-none"
                >
                  <option value="">ทุกโครงการ</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-16 text-center text-xs text-slate-400">
              <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <span>กำลังโหลดข้อมูล</span>
            </div>
          </div>
        </GsapReveal>
      )}

      {/* ================= TAB 6: ALL STOCK (Image 5) ================= */}
      {currentTab === 'all-stock' && (
        <GsapReveal className="space-y-3">
          {/* Top Ribbon Tabs (Image 5) */}
          <div className="border-b border-[#cbd5ce] bg-[#f6f8f6] px-3 pt-2">
            <button
              type="button"
              className="inline-block px-4 py-1.5 text-xs font-semibold text-[#217346] border-b-2 border-[#217346] bg-white rounded-t"
            >
              หน้าแรก
            </button>
          </div>

          {/* Ribbon Toolbar (Image 5) */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ค้นหาวัสดุ, SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-[#217346]"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/stock?tab=document-history"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-2xs transition"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>ประวัติเอกสารที่บันทึก</span>
              </Link>

              <button
                type="button"
                onClick={() => setShowItemModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#217346] hover:bg-[#1b5e39] text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                <span>สร้างรายการ</span>
              </button>

              <div className="text-right pl-3 border-l border-slate-200">
                <div className="text-xs font-bold text-slate-800">{warehouses.length} คลัง</div>
                <div className="text-[10px] text-slate-400">
                  {allItems.length.toFixed(2)} รายการ
                </div>
              </div>
            </div>
          </div>

          {/* Navy Table (Image 5) */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px] text-xs">
                <thead className="bg-[#102d72] text-xs text-white">
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
                  {warehouses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                        ยังไม่มีสต็อกของบริษัทนี้
                      </td>
                    </tr>
                  ) : (
                    warehouses.map((w) => (
                      <tr
                        key={w}
                        onClick={() => setSelectedWarehouseForDrilldown(w)}
                        className="hover:bg-slate-50 cursor-pointer transition"
                      >
                        <td className="px-4 py-3 font-semibold text-[#217346] flex items-center gap-2">
                          <Package className="w-4 h-4 text-slate-400" />
                          <span>{w}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-700">
                          {allItems.length} รายการ
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          {allItems.reduce((sum, it) => sum + it.totalQty, 0).toLocaleString('th-TH')}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">
                          ฿{overview.totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {new Date().toLocaleDateString('th-TH', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 text-slate-600">ผู้ดูแลระบบ / เจ้าของ</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </GsapReveal>
      )}

      {/* Unified Create Modal: รับเข้า, จ่ายออก, โอนย้าย, ปรับยอด */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-[#2453d4]" />
                บันทึกรายการสต็อกสินค้า
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sub-tabs: รับเข้า, จ่ายออก, โอนย้าย, ปรับยอด */}
            <div className="grid grid-cols-4 border-b border-slate-200 text-xs text-center font-medium bg-slate-50/50">
              <button
                type="button"
                onClick={() => setCreateSubTab('RECEIVE')}
                className={`py-2.5 border-b-2 transition ${
                  createSubTab === 'RECEIVE'
                    ? 'border-[#2453d4] text-[#2453d4] font-bold bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                รับเข้า
              </button>
              <button
                type="button"
                onClick={() => setCreateSubTab('ISSUE')}
                className={`py-2.5 border-b-2 transition ${
                  createSubTab === 'ISSUE'
                    ? 'border-[#2453d4] text-[#2453d4] font-bold bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                จ่ายออก
              </button>
              <button
                type="button"
                onClick={() => setCreateSubTab('TRANSFER')}
                className={`py-2.5 border-b-2 transition ${
                  createSubTab === 'TRANSFER'
                    ? 'border-[#2453d4] text-[#2453d4] font-bold bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                โอนย้าย
              </button>
              <button
                type="button"
                onClick={() => setCreateSubTab('ADJUST')}
                className={`py-2.5 border-b-2 transition ${
                  createSubTab === 'ADJUST'
                    ? 'border-[#2453d4] text-[#2453d4] font-bold bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                ปรับยอด
              </button>
            </div>

            {/* Modal Form */}
            <form
              action={async (formData) => {
                setIsSubmitting(true);
                formData.set('type', createSubTab);
                formData.set('stockItemId', selectedItemId);
                formData.set('projectId', selectedProjectId);
                formData.set('warehouseName', warehouseName);
                if (createSubTab === 'TRANSFER') {
                  formData.set('targetWarehouseName', targetWarehouseName);
                }
                formData.set('quantity', movementQty);
                formData.set('unitCost', movementUnitCost || '0');
                formData.set('supplierName', supplierName);
                formData.set('locationUsed', locationUsed);
                formData.set('notes', movementNotes);

                await recordStockMovementAction(formData);
                setShowCreateModal(false);
                setIsSubmitting(false);
                window.location.reload();
              }}
              className="p-5 space-y-3.5 text-xs"
            >
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  เลือกสินค้า / วัสดุ <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => {
                    setSelectedItemId(e.target.value);
                    const it = allItems.find((x) => x.id === e.target.value);
                    if (it) setMovementUnitCost(String(it.unitCost));
                  }}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                >
                  <option value="">-- กรุณาเลือกวัสดุ --</option>
                  {allItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      [{it.sku}] {it.name} (คงเหลือ: {it.totalQty} {it.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    จำนวน <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="เช่น 50"
                    value={movementQty}
                    onChange={(e) => setMovementQty(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    ราคาทุนต่อหน่วย (บาท)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="เช่น 150.00"
                    value={movementUnitCost}
                    onChange={(e) => setMovementUnitCost(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    คลังต้นทาง / จัดเก็บ
                  </label>
                  <input
                    value={warehouseName}
                    onChange={(e) => setWarehouseName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>

                {createSubTab === 'TRANSFER' ? (
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      คลังปลายทาง
                    </label>
                    <input
                      value={targetWarehouseName}
                      onChange={(e) => setTargetWarehouseName(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      {createSubTab === 'RECEIVE' ? 'ผู้ขาย / แหล่งที่มา' : 'ตำแหน่งหน้างานที่ใช้'}
                    </label>
                    <input
                      value={createSubTab === 'RECEIVE' ? supplierName : locationUsed}
                      onChange={(e) =>
                        createSubTab === 'RECEIVE'
                          ? setSupplierName(e.target.value)
                          : setLocationUsed(e.target.value)
                      }
                      placeholder={createSubTab === 'RECEIVE' ? 'เช่น ดูโฮม, ไทวัสดุ' : 'เช่น ชั้น 3 โซน A'}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">หมายเหตุ / เหตุผล</label>
                <textarea
                  rows={2}
                  value={movementNotes}
                  onChange={(e) => setMovementNotes(e.target.value)}
                  placeholder="ระบุรายละเอียดเพิ่มเติม..."
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !selectedItemId || !movementQty}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#2453d4] hover:bg-[#1c43ab] shadow-sm transition disabled:opacity-60"
                >
                  {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกรายการ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: เพิ่มวัสดุใหม่ */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#2453d4]" />
                เพิ่มข้อมูลวัสดุใหม่
              </h3>
              <button
                type="button"
                onClick={() => setShowItemModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              action={async (formData) => {
                setIsSubmitting(true);
                formData.set('sku', newItemSku);
                formData.set('name', newItemName);
                formData.set('category', newItemCategory);
                formData.set('unit', newItemUnit);
                formData.set('unitCost', newItemUnitCost || '0');
                formData.set('reorderPoint', newItemReorderPoint || '0');

                await createStockItemAction(formData);
                setShowItemModal(false);
                setIsSubmitting(false);
                window.location.reload();
              }}
              className="p-5 space-y-3.5 text-xs"
            >
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  รหัสวัสดุ (SKU) <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  placeholder="เช่น MAT-6906"
                  value={newItemSku}
                  onChange={(e) => setNewItemSku(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  ชื่อวัสดุ / สินค้า <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  placeholder="เช่น สีทาภายนอก TOA SuperShield (ถัง 5 แกลลอน)"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">หมวดหมู่วัสดุ</label>
                  <input
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">หน่วยนับ</label>
                  <input
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">ราคาทุนเฉลี่ย (บาท)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="เช่น 1850.00"
                    value={newItemUnitCost}
                    onChange={(e) => setNewItemUnitCost(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">จุดสั่งซื้อ (Reorder)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="เช่น 10"
                    value={newItemReorderPoint}
                    onChange={(e) => setNewItemReorderPoint(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#2453d4] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newItemSku || !newItemName}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#2453d4] hover:bg-[#1d44b8] shadow-sm transition disabled:opacity-60"
                >
                  {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกวัสดุ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}