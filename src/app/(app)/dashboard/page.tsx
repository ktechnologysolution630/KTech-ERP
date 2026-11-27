import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, CalendarRange, ChevronRight, ClipboardCheck, FolderKanban, HandCoins, Landmark, ShoppingCart, TrendingUp, Wallet } from 'lucide-react';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getDashboardOverview, getOwnerDashboard, getSalesStockSnapshot } from '@/server/services/dashboard';
import { formatMoneyDisplay } from '@/domain/money';
import { PROJECT_STATUS_LABELS } from '@/domain/project';
import { bangkokDateString } from '@/domain/thai';
import { CashNetBars, Sparkline, TabbedPanel, YearAtAGlance } from './dashboard-visuals';

const CASH_IN = '#0071e3';
const CASH_OUT = '#eb6834';
const PROFIT = '#30a46c';
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const monthName = (key: string) => TH_MONTHS[Number(key.slice(5, 7)) - 1]!;
const monthFull = (key: string) => `${monthName(key)} ${Number(key.slice(0, 4)) + 543}`;
const baht = (n: number) => formatMoneyDisplay(n, 0);
const num = (s: string | number) => Number(s) || 0;
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${monthName(iso)}`;

function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-3xl border border-slate-200/70 bg-white p-5 shadow-xs ${className}`}>{children}</section>;
}

function CardHead({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-slate-500">{icon}</span>
        {title}
      </h2>
      {action}
    </div>
  );
}

function PillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200">
      {children}
      <ChevronRight className="h-3 w-3" />
    </Link>
  );
}

/** KPI tile: label, big number, trend line, and a short note. `tone` sets the background. */
function KpiTile({
  label,
  value,
  note,
  icon,
  trend,
  tone = 'plain',
  alert,
  href,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  trend?: { values: number[]; color: string };
  tone?: 'dark' | 'tint' | 'plain';
  alert?: boolean;
  href?: string;
}) {
  const surface =
    tone === 'dark' ? 'bg-ink text-white border-transparent' : tone === 'tint' ? 'bg-[#e8f1fd] border-transparent text-slate-900' : 'bg-white border-slate-200/70 text-slate-900';
  const sub = tone === 'dark' ? 'text-white/60' : 'text-slate-500';
  const body = (
    <>
      <div className={`flex items-center gap-2 text-xs ${sub}`}>
        <span className={`grid h-7 w-7 place-items-center rounded-full ${tone === 'dark' ? 'bg-white/10 text-white' : tone === 'tint' ? 'bg-white/70 text-brand' : 'bg-slate-100 text-slate-500'}`}>{icon}</span>
        {label}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0 font-mono text-2xl font-semibold tracking-tight">{value}</div>
        {trend && <Sparkline values={trend.values} color={tone === 'dark' ? '#fff' : trend.color} className="mb-1 h-7 w-16 shrink-0 sm:w-20 xl:w-14 2xl:w-20" />}
      </div>
      <div className={`mt-2 flex items-center gap-1 text-[11px] ${alert ? 'font-medium text-rose-600' : sub}`}>
        {alert && <AlertTriangle className="h-3 w-3 shrink-0" />}
        <span className="truncate">{note}</span>
      </div>
    </>
  );
  const cls = `block rounded-3xl border p-5 shadow-xs ${surface}`;
  return href ? (
    <Link href={href} prefetch={false} className={`${cls} transition-transform hover:-translate-y-0.5`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function MiniTable({ head, rows, empty }: { head: { label: string; right?: boolean }[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-xs text-slate-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead className="text-slate-500">
          <tr className="border-b border-slate-100">
            {head.map((h) => (
              <th key={h.label} className={`px-3 py-2 font-medium ${h.right ? 'text-right' : 'text-left'}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50/70">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2.5 ${head[j]?.right ? 'text-right font-mono' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DashboardPage() {
  const actor = await requireUser();
  // The company-wide figures are for finance and management; everyone else works from the portal
  if (!can(actor, 'export.view')) redirect('/inbox');
  const db = await getDb();
  const [dash, overview, sales] = await Promise.all([getOwnerDashboard(db, actor), getDashboardOverview(db, actor), getSalesStockSnapshot(db, actor)]);

  const now = new Date();
  const todayIso = bangkokDateString(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Bangkok' }).format(now));
  const greeting = hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const todayLabel = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(now);
  const firstName = actor.name.trim().split(/\s+/)[0] ?? actor.name;

  const salesChange = sales.sales.lastMonth > 0 ? ((sales.sales.thisMonth - sales.sales.lastMonth) / sales.sales.lastMonth) * 100 : null;
  const pendingTotal = dash.pendingApprovals.po + dash.pendingApprovals.pv + dash.pendingApprovals.closeShort;
  const overdueTotal = dash.overdue.reduce((a, o) => a + num(o.gross), 0);
  const dueSoonTotal = dash.dueSoon.reduce((a, o) => a + num(o.gross), 0);
  const marginPct = sales.sales.ytd > 0 ? (sales.grossProfitYtd / sales.sales.ytd) * 100 : null;
  const troubled = overview.projects.filter((p) => p.behindPlan || p.overBudget).length;
  const onTrack = Math.max(0, overview.projectCounts.open - troubled);

  // Payments on a 30-day strip: overdue to the left of today, due within 7 days to the right
  const dayDiff = (iso: string) => Math.round((Date.parse(iso) - Date.parse(todayIso)) / 86_400_000);
  const stripDots = [
    ...dash.overdue.map((o) => ({ id: o.id, d: Math.max(-21, dayDiff(o.dueDate)), late: true, label: `${o.vendorName} · ${shortDate(o.dueDate)} · ${baht(num(o.gross))}` })),
    ...dash.dueSoon.map((o) => ({ id: o.id, d: Math.min(8, dayDiff(o.dueDate)), late: false, label: `${o.vendorName} · ${shortDate(o.dueDate)} · ${baht(num(o.gross))}` })),
  ];
  const stripPos = (d: number) => ((d + 21) / 30) * 100;

  const months = overview.monthly.map((m) => ({ label: monthName(m.month), fullLabel: monthFull(m.month) }));
  const salesByMonth = new Map(sales.sales.months.map((m) => [m.month, m.amount]));
  const agingMax = Math.max(1, ...overview.aging.map((a) => Math.max(a.receivable, a.payable)));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-slate-500">ภาพรวมบริษัท · ผู้บริหารและการเงิน</div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">แดชบอร์ด</h1>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-slate-200/70 bg-white py-1.5 pl-3 pr-4 text-[11px] shadow-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <span className={`h-2 w-2 rounded-full ${troubled > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            โครงการเปิด {overview.projectCounts.open}
          </span>
          <span className="text-slate-500">
            ตามแผน {onTrack} · มีปัญหา {troubled}
          </span>
          <span className="flex h-1.5 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <span className="bg-emerald-500" style={{ width: `${overview.projectCounts.open ? (onTrack / overview.projectCounts.open) * 100 : 0}%` }} />
            <span className="bg-amber-500" style={{ width: `${overview.projectCounts.open ? (troubled / overview.projectCounts.open) * 100 : 0}%` }} />
          </span>
        </div>
      </div>

      {/* Greeting + cash */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="flex flex-col xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide text-[#eb6834]">{todayLabel}</div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {greeting}, {firstName}
              </h2>
              <p className="mt-2 max-w-xl text-sm text-slate-600">
                มีเอกสาร <b className="text-slate-900">{pendingTotal} รายการ</b> รออนุมัติ,{' '}
                <b className={dash.overdue.length > 0 ? 'text-rose-600' : 'text-slate-900'}>{dash.overdue.length} รายการ</b> เกินกำหนดจ่าย และ{' '}
                <b className={sales.lowStock.length > 0 ? 'text-amber-700' : 'text-slate-900'}>{sales.lowStock.length} สินค้า</b> ใกล้หมด
                {troubled > 0 && (
                  <>
                    {' '}· <span className="text-rose-600">{troubled} โครงการต้องดูแล</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href="/approvals" prefetch={false} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-medium text-white hover:bg-black">
                <ClipboardCheck className="h-3.5 w-3.5" /> รออนุมัติ
              </Link>
              <Link href="/timeline" prefetch={false} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <CalendarRange className="h-3.5 w-3.5" /> Timeline
              </Link>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
            {[
              { label: 'PO', n: dash.pendingApprovals.po, href: '/purchasing/approve' },
              { label: 'ใบสำคัญจ่าย', n: dash.pendingApprovals.pv, href: '/pv' },
              { label: 'ปิดยอดค้างรับ', n: dash.pendingApprovals.closeShort, href: '/inbox' },
            ].map((p) => (
              <Link key={p.label} href={p.href} prefetch={false} className="rounded-2xl bg-slate-50 px-3 py-2 transition-colors hover:bg-slate-100">
                <div className="font-mono text-lg font-semibold text-slate-900">{p.n}</div>
                <div className="text-[10px] text-slate-500">รออนุมัติ · {p.label}</div>
              </Link>
            ))}
          </div>

          {/* Payment strip */}
          <div className="mt-auto pt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <span>กำหนดจ่ายเจ้าหนี้ · 3 สัปดาห์ก่อน ถึง 7 วันข้างหน้า</span>
              <span className="flex gap-3">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />เกินกำหนด {baht(overdueTotal)}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />ภายใน 7 วัน {baht(dueSoonTotal)}</span>
              </span>
            </div>
            <div className="relative h-6">
              <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-slate-200" />
              <div className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-slate-900" style={{ left: 0, width: `${stripPos(0)}%` }} />
              {stripDots.map((s, i) => (
                <span
                  key={`${s.id}-${i}`}
                  title={s.label}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${s.late ? 'bg-rose-500' : 'bg-amber-400'}`}
                  style={{ left: `${stripPos(s.d)}%` }}
                />
              ))}
              <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${stripPos(0)}%` }}>
                <span className="block h-4 w-4 rounded-full border-[3px] border-white bg-[#eb6834] shadow" />
              </span>
            </div>
            <div className="relative mt-1 h-3 text-[9px] text-slate-400">
              {[
                { d: -21, label: '3 สัปดาห์ก่อน', wide: false },
                { d: -14, label: '2 สัปดาห์', wide: true },
                { d: -7, label: '1 สัปดาห์', wide: false },
                { d: 0, label: 'วันนี้', wide: false },
                { d: 8, label: '+7 วัน', wide: false },
              ].map((t) => (
                <span key={t.d} className={`absolute whitespace-nowrap ${t.wide ? 'hidden sm:inline ' : ''}${t.d === 0 ? 'font-semibold text-[#eb6834] ' : ''}${t.d === -21 ? '' : t.d === 8 ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: `${stripPos(t.d)}%` }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Wallet className="h-3.5 w-3.5" />} title="เงินสดสุทธิปีนี้" action={<PillLink href="/cash-bank">เงินสด/ธนาคาร</PillLink>} />
          <div className="mt-4 flex flex-wrap items-baseline gap-2">
            <span className={`font-mono text-3xl font-semibold tracking-tight ${overview.netYtd < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{baht(overview.netYtd)}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${overview.thisMonth.cashIn - overview.thisMonth.cashOut >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
            >
              {overview.thisMonth.cashIn - overview.thisMonth.cashOut >= 0 ? '+' : '−'}
              {baht(Math.abs(overview.thisMonth.cashIn - overview.thisMonth.cashOut))} เดือนนี้
            </span>
          </div>
          <div className="mt-4">
            <CashNetBars
              inColor={PROFIT}
              outColor={CASH_OUT}
              rows={overview.monthly.map((m) => ({ label: monthName(m.month), fullLabel: monthFull(m.month), net: m.cashIn - m.cashOut }))}
            />
          </div>
          <div className="mt-3 flex gap-4 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: PROFIT }} />เงินเข้ามากกว่า</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CASH_OUT }} />เงินออกมากกว่า</span>
          </div>
        </Card>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          tone="dark"
          label="ยอดขายเดือนนี้"
          value={baht(sales.sales.thisMonth)}
          note={salesChange === null ? `เดือนก่อน ${baht(sales.sales.lastMonth)}` : `${salesChange >= 0 ? '+' : ''}${salesChange.toFixed(1)}% จากเดือนก่อน`}
          icon={<ShoppingCart className="h-3.5 w-3.5" />}
          trend={{ values: sales.sales.months.map((m) => m.amount), color: CASH_IN }}
        />
        <KpiTile
          tone="tint"
          label="เงินเข้าปีนี้"
          value={baht(overview.cashInYtd)}
          note={`เดือนนี้ ${baht(overview.thisMonth.cashIn)}`}
          icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
          trend={{ values: overview.monthly.map((m) => m.cashIn), color: CASH_IN }}
        />
        <KpiTile
          label="เงินออกปีนี้"
          value={baht(overview.cashOutYtd)}
          note={`เดือนนี้ ${baht(overview.thisMonth.cashOut)}`}
          icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          trend={{ values: overview.monthly.map((m) => m.cashOut), color: CASH_OUT }}
        />
        <KpiTile
          label="กำไรขั้นต้นปีนี้"
          value={baht(sales.grossProfitYtd)}
          note={marginPct === null ? 'ยอดขาย − ต้นทุนขาย' : `${marginPct.toFixed(1)}% ของยอดขาย ${baht(sales.sales.ytd)}`}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          alert={sales.grossProfitYtd < 0}
        />
      </div>

      {/* Year at a glance + receivables/payables */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead icon={<CalendarRange className="h-3.5 w-3.5" />} title="ภาพรวม 12 เดือน" />
          <div className="mt-4">
            <YearAtAGlance
              months={months}
              views={[
                {
                  key: 'cash',
                  label: 'เงินเข้า-ออก',
                  emptyText: 'ยังไม่มีการรับหรือจ่ายเงินใน 12 เดือนนี้',
                  series: [
                    { key: 'in', label: 'เงินเข้า', color: CASH_IN, values: overview.monthly.map((m) => m.cashIn) },
                    { key: 'out', label: 'เงินออก', color: CASH_OUT, dashed: true, values: overview.monthly.map((m) => m.cashOut) },
                  ],
                },
                {
                  key: 'sales',
                  label: 'ยอดขาย',
                  emptyText: 'ยังไม่มียอดขายที่ลงบัญชีใน 12 เดือนนี้',
                  series: [{ key: 'sales', label: 'ยอดขาย (ก่อน VAT)', color: CASH_IN, values: overview.monthly.map((m) => salesByMonth.get(m.month) ?? 0) }],
                },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHead icon={<HandCoins className="h-3.5 w-3.5" />} title="ลูกหนี้ / เจ้าหนี้" action={<PillLink href="/ar/receivables">ดูลูกหนี้</PillLink>} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#e8f1fd] p-3">
              <div className="text-[10px] text-slate-600">ลูกหนี้ค้างรับ</div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-900">{baht(overview.receivable.total)}</div>
              <div className={`text-[10px] ${overview.receivable.overdue > 0 ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
                {overview.receivable.overdue > 0 ? `เกินกำหนด ${baht(overview.receivable.overdue)}` : `${overview.receivable.invoices} ใบ · ไม่มีเกินกำหนด`}
              </div>
            </div>
            <div className="rounded-2xl bg-[#fdefe8] p-3">
              <div className="text-[10px] text-slate-600">เจ้าหนี้ค้างจ่าย</div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-900">{baht(overview.payable.total)}</div>
              <div className={`text-[10px] ${overview.payable.overdue > 0 ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
                {overview.payable.overdue > 0 ? `เกินกำหนด ${baht(overview.payable.overdue)}` : `${overview.payable.items} รายการ · ไม่มีเกินกำหนด`}
              </div>
            </div>
          </div>
          <div className="mt-5 text-[10px] font-medium text-slate-500">อายุยอดค้าง</div>
          <ul className="mt-2 space-y-3">
            {overview.aging.map((a) => (
              <li key={a.bucket}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="text-slate-700">{a.label}</span>
                  <span className="font-mono text-slate-500">
                    <span style={{ color: CASH_IN }}>{baht(a.receivable)}</span> / <span style={{ color: CASH_OUT }}>{baht(a.payable)}</span>
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ background: CASH_IN, width: `${(a.receivable / agingMax) * 100}%` }} />
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ background: CASH_OUT, width: `${(a.payable / agingMax) * 100}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Projects + stock */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead icon={<FolderKanban className="h-3.5 w-3.5" />} title="โครงการที่เปิดอยู่" action={<PillLink href="/timeline">ดู Timeline</PillLink>} />
          {overview.projects.length === 0 ? (
            <p className="py-12 text-center text-xs text-slate-400">ไม่มีโครงการที่เปิดอยู่</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {overview.projects.map((p) => {
                const used = p.budget > 0 ? (p.cost / p.budget) * 100 : 0;
                return (
                  <li key={p.id} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-5">
                    <div className="min-w-0">
                      <Link href={`/projects/${p.id}`} prefetch={false} className="block truncate text-sm font-medium text-slate-900 hover:text-brand" title={p.name}>
                        {p.name}
                      </Link>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        <span className="font-mono">{p.code}</span> · {PROJECT_STATUS_LABELS[p.status]}
                        {p.budget > 0 && <> · งบ {baht(p.budget)}</>}
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>ความคืบหน้า</span>
                        <span className={p.behindPlan ? 'font-medium text-rose-600' : ''}>
                          {p.progress}% <span className="text-slate-400">/ แผน {p.plannedProgress}%</span>
                        </span>
                      </div>
                      {/* The tick marks where the plan says the project should be today */}
                      <div className="relative mt-1 h-1.5 rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${p.behindPlan ? 'bg-rose-500' : 'bg-brand'}`} style={{ width: `${Math.min(100, p.progress)}%` }} />
                        {p.plannedProgress > 0 && <div className="absolute -bottom-1 -top-1 w-0.5 rounded bg-slate-900" style={{ left: `${Math.min(100, p.plannedProgress)}%` }} />}
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>ต้นทุน {baht(p.cost)}</span>
                        <span className={p.overBudget ? 'font-medium text-rose-600' : ''}>{p.budget > 0 ? `${used.toFixed(0)}% ของงบ` : 'ไม่มีงบ'}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${p.overBudget ? 'bg-rose-500' : 'bg-slate-400'}`} style={{ width: `${Math.min(100, used)}%` }} />
                      </div>
                      <div className="mt-0.5 text-right text-[10px] text-slate-400">รับเงินแล้ว {baht(p.received)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead
            icon={<Boxes className="h-3.5 w-3.5" />}
            title={`สินค้าใกล้หมด (${sales.lowStock.length})`}
            action={<PillLink href="/stock?tab=low-stock">ดูทั้งหมด</PillLink>}
          />
          <div className="mt-4 rounded-2xl bg-slate-50 p-3">
            <div className="text-[10px] text-slate-500">มูลค่าสินค้าคงเหลือ</div>
            <div className="font-mono text-lg font-semibold text-slate-900">{baht(sales.stockValue)}</div>
          </div>
          {sales.lowStock.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">ไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ</p>
          ) : (
            <>
              <ul className="mt-3 space-y-3">
                {sales.lowStock.slice(0, 6).map((i) => {
                  const pct = i.reorderPoint > 0 ? Math.max(0, Math.min(100, (i.onHand / i.reorderPoint) * 100)) : 0;
                  return (
                    <li key={i.id}>
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="min-w-0 truncate text-slate-800" title={`${i.sku} ${i.name}`}>
                          {i.name}
                        </span>
                        <span className={`shrink-0 font-mono ${i.onHand <= 0 ? 'font-semibold text-rose-600' : 'text-amber-700'}`}>
                          {i.onHand.toLocaleString('th-TH')}
                          <span className="text-slate-400"> / {i.reorderPoint.toLocaleString('th-TH')} {i.unit}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${i.onHand <= 0 ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <a href={`/api/csv/low-stock?n=${sales.lowStock.length}`} download className="mt-4 inline-block text-[11px] font-medium text-emerald-700 hover:underline">
                ดาวน์โหลด CSV
              </a>
            </>
          )}
        </Card>
      </div>

      {/* Payables follow-up, in tabs */}
      <Card>
        <CardHead icon={<Landmark className="h-3.5 w-3.5" />} title="ติดตามการจ่ายเงินและจัดซื้อ" />
        <div className="mt-4">
          <TabbedPanel
            tabs={[
              {
                key: 'overdue',
                label: 'เกินกำหนดชำระ',
                count: dash.overdue.length,
                tone: 'red',
                content: (
                  <MiniTable
                    empty="ไม่มีรายการเกินกำหนด"
                    head={[{ label: 'ครบกำหนด' }, { label: 'ผู้ขาย' }, { label: 'ยอดเงิน', right: true }]}
                    rows={dash.overdue.map((o) => [<span key="d" className="font-medium text-rose-600">{shortDate(o.dueDate)}</span>, o.vendorName, `฿${formatMoneyDisplay(o.gross)}`])}
                  />
                ),
              },
              {
                key: 'soon',
                label: 'ครบใน 7 วัน',
                count: dash.dueSoon.length,
                tone: 'amber',
                content: (
                  <MiniTable
                    empty="ไม่มีรายการครบกำหนดใน 7 วัน"
                    head={[{ label: 'ครบกำหนด' }, { label: 'ผู้ขาย' }, { label: 'ยอดเงิน', right: true }]}
                    rows={dash.dueSoon.map((o) => [shortDate(o.dueDate), o.vendorName, `฿${formatMoneyDisplay(o.gross)}`])}
                  />
                ),
              },
              {
                key: 'paid',
                label: 'จ่ายแล้วยังไม่ได้ของ',
                count: dash.paidNotReceived.length,
                tone: 'amber',
                content: (
                  <MiniTable
                    empty="ไม่มีรายการค้างรับหลังจ่ายเงิน"
                    head={[{ label: 'PO' }, { label: 'ผู้ขาย' }, { label: 'มูลค่าค้างรับ', right: true }]}
                    rows={dash.paidNotReceived.map((p) => [
                      <Link key="po" href={`/po/${p.poId}`} prefetch={false} className="font-medium text-brand hover:underline">
                        {p.number}
                      </Link>,
                      p.vendor,
                      `฿${formatMoneyDisplay(p.amount)}`,
                    ])}
                  />
                ),
              },
              {
                key: 'vendor',
                label: 'ค้างจ่ายตามผู้ขาย',
                count: dash.outstandingByVendor.length,
                content: (
                  <MiniTable
                    empty="ไม่มีหนี้ค้างชำระ"
                    head={[{ label: 'ผู้ขาย' }, { label: 'ยอดค้างจ่ายรวม', right: true }]}
                    rows={dash.outstandingByVendor.map((v) => [v.name, `฿${formatMoneyDisplay(v.gross)}`])}
                  />
                ),
              },
              {
                key: 'project',
                label: 'ยอดสั่งซื้อตามโครงการ',
                content: (
                  <MiniTable
                    empty="ยังไม่มีใบสั่งซื้อที่อนุมัติแล้ว"
                    head={[{ label: 'โครงการ' }, { label: 'เดือนนี้', right: true }, { label: 'ปีนี้ (YTD)', right: true }, { label: 'ทั้งหมด', right: true }]}
                    rows={dash.purchasesByProject.map((p) => [
                      p.projectId && p.projectId !== '__OFFICE__' ? (
                        <Link key="p" href={`/projects/${p.projectId}`} prefetch={false} className="font-medium text-brand hover:underline">
                          {p.name}
                        </Link>
                      ) : (
                        p.name
                      ),
                      `฿${formatMoneyDisplay(p.monthGross)}`,
                      `฿${formatMoneyDisplay(p.ytdGross)}`,
                      <b key="g">฿{formatMoneyDisplay(p.gross)}</b>,
                    ])}
                  />
                ),
              },
              {
                key: 'mix',
                label: 'เงินออกตามประเภท',
                content:
                  overview.expenseMix.length === 0 ? (
                    <p className="py-10 text-center text-xs text-slate-400">ปีนี้ยังไม่มีการจ่ายเงิน</p>
                  ) : (
                    <ul className="space-y-3">
                      {(() => {
                        const total = overview.expenseMix.reduce((a, r) => a + r.amount, 0) || 1;
                        const top = Math.max(1, ...overview.expenseMix.map((r) => r.amount));
                        return overview.expenseMix.map((r) => (
                          <li key={r.label}>
                            <div className="flex items-baseline justify-between gap-3 text-xs">
                              <span className="truncate text-slate-700">{r.label}</span>
                              <span className="shrink-0 font-mono text-slate-900">
                                {baht(r.amount)} <span className="text-[10px] text-slate-500">({((r.amount / total) * 100).toFixed(0)}%)</span>
                              </span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-slate-100">
                              <div className="h-full rounded-full" style={{ background: CASH_OUT, width: `${(r.amount / top) * 100}%` }} />
                            </div>
                          </li>
                        ));
                      })()}
                    </ul>
                  ),
              },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
