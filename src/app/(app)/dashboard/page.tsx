import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ClipboardCheck, FolderKanban, HandCoins, Landmark, Scale } from 'lucide-react';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getDashboardOverview, getOwnerDashboard } from '@/server/services/dashboard';
import { formatMoneyDisplay } from '@/domain/money';
import { PROJECT_STATUS_LABELS } from '@/domain/project';
import { GroupedColumnChart, HorizontalBarChart } from './dashboard-charts';

const CASH_IN = '#2a78d6';
const CASH_OUT = '#eb6834';
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const monthName = (key: string) => TH_MONTHS[Number(key.slice(5, 7)) - 1]!;
const baht = (n: number) => formatMoneyDisplay(n, 0);

function Tile({ label, value, hint, icon, alert }: { label: string; value: string; hint: string; icon: React.ReactNode; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between text-xs text-slate-500">
        {label}
        <span className="text-slate-400">{icon}</span>
      </div>
      <div className="mt-2 font-mono text-xl font-bold text-slate-900 sm:text-2xl">{value}</div>
      <div className={`mt-1 flex items-center gap-1 text-[11px] ${alert ? 'font-medium text-rose-700' : 'text-slate-500'}`}>
        {alert && <AlertTriangle className="h-3 w-3 shrink-0" />}
        {hint}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const actor = await requireUser();
  // The company-wide figures are for finance and management; everyone else works from the portal
  if (!can(actor, 'export.view')) redirect('/inbox');
  const db = await getDb();
  const [dash, overview] = await Promise.all([getOwnerDashboard(db, actor), getDashboardOverview(db, actor)]);
  const pendingTotal = dash.pendingApprovals.po + dash.pendingApprovals.pv + dash.pendingApprovals.closeShort;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          ภาพรวมผู้บริหารและการเงิน (Owner & Finance Dashboard)
        </h1>
        <p className="text-xs text-slate-600">
          เงินเข้า-ออก ลูกหนี้ เจ้าหนี้ และสถานะโครงการของทั้งบริษัท · ตัวเลขสะสมนับตั้งแต่ ม.ค. {overview.year + 543}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="เงินเข้าปีนี้"
          value={baht(overview.cashInYtd)}
          hint={`เดือนนี้ ${baht(overview.thisMonth.cashIn)}`}
          icon={<ArrowDownLeft className="h-4 w-4" />}
        />
        <Tile
          label="เงินออกปีนี้"
          value={baht(overview.cashOutYtd)}
          hint={`เดือนนี้ ${baht(overview.thisMonth.cashOut)}`}
          icon={<ArrowUpRight className="h-4 w-4" />}
        />
        <Tile
          label="ลูกหนี้ค้างรับ"
          value={baht(overview.receivable.total)}
          hint={overview.receivable.overdue > 0 ? `เกินกำหนด ${baht(overview.receivable.overdue)}` : `${overview.receivable.invoices} ใบแจ้งหนี้ · ไม่มีเกินกำหนด`}
          icon={<HandCoins className="h-4 w-4" />}
          alert={overview.receivable.overdue > 0}
        />
        <Tile
          label="เจ้าหนี้ค้างจ่าย"
          value={baht(overview.payable.total)}
          hint={overview.payable.overdue > 0 ? `เกินกำหนด ${baht(overview.payable.overdue)}` : `${overview.payable.items} รายการ · ไม่มีเกินกำหนด`}
          icon={<Landmark className="h-4 w-4" />}
          alert={overview.payable.overdue > 0}
        />
        <Tile
          label="เงินสดสุทธิปีนี้"
          value={baht(overview.netYtd)}
          hint="เงินเข้า − เงินออก"
          icon={<Scale className="h-4 w-4" />}
          alert={overview.netYtd < 0}
        />
        <Tile
          label="โครงการที่เปิดอยู่"
          value={String(overview.projectCounts.open)}
          hint={
            overview.projectCounts.behindPlan + overview.projectCounts.overBudget > 0
              ? `ช้ากว่าแผน ${overview.projectCounts.behindPlan} · เกินงบ ${overview.projectCounts.overBudget}`
              : 'ไม่มีโครงการช้ากว่าแผนหรือเกินงบ'
          }
          icon={<FolderKanban className="h-4 w-4" />}
          alert={overview.projectCounts.behindPlan + overview.projectCounts.overBudget > 0}
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:col-span-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            รออนุมัติ
            <ClipboardCheck className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 grid grid-cols-3 divide-x divide-slate-100">
            <Link href="/purchasing/approve" className="pr-3 hover:opacity-70">
              <div className="font-mono text-xl font-bold text-slate-900 sm:text-2xl">{dash.pendingApprovals.po}</div>
              <div className="mt-1 text-[11px] text-slate-500">PO</div>
            </Link>
            <Link href="/pv" className="px-3 hover:opacity-70">
              <div className="font-mono text-xl font-bold text-slate-900 sm:text-2xl">{dash.pendingApprovals.pv}</div>
              <div className="mt-1 text-[11px] text-slate-500">ใบสำคัญจ่าย (PV)</div>
            </Link>
            <Link href="/inbox" className="pl-3 hover:opacity-70">
              <div className="font-mono text-xl font-bold text-slate-900 sm:text-2xl">{dash.pendingApprovals.closeShort}</div>
              <div className="mt-1 text-[11px] text-slate-500">ปิดยอดค้างรับ</div>
            </Link>
          </div>
          {pendingTotal === 0 && <div className="sr-only">ไม่มีรายการรออนุมัติ</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <GroupedColumnChart
            title="เงินเข้า-ออกรายเดือน"
            subtitle="12 เดือนล่าสุด ทั้งบริษัท (บาท) · เงินเข้าจากใบเสร็จลูกค้า เงินออกจากใบสำคัญจ่ายที่จ่ายแล้ว"
            series={[
              { key: 'cashIn', label: 'เงินเข้า', color: CASH_IN },
              { key: 'cashOut', label: 'เงินออก', color: CASH_OUT },
            ]}
            rows={overview.monthly.map((m) => ({
              key: m.month,
              label: monthName(m.month),
              fullLabel: `${monthName(m.month)} ${Number(m.month.slice(0, 4)) + 543}`,
              values: { cashIn: m.cashIn, cashOut: m.cashOut },
            }))}
            emptyText="ยังไม่มีการรับหรือจ่ายเงินใน 12 เดือนนี้"
          />
        </div>
        <HorizontalBarChart
          title="เงินออกปีนี้แยกตามประเภท"
          subtitle="จากใบสำคัญจ่ายที่จ่ายแล้ว (บาท)"
          rows={overview.expenseMix}
          color={CASH_OUT}
          emptyText="ปีนี้ยังไม่มีการจ่ายเงิน"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <GroupedColumnChart
          title="อายุลูกหนี้และเจ้าหนี้"
          subtitle="ยอดค้างแยกตามจำนวนวันที่เกินกำหนด (บาท)"
          series={[
            { key: 'receivable', label: 'ลูกหนี้ค้างรับ', color: CASH_IN },
            { key: 'payable', label: 'เจ้าหนี้ค้างจ่าย', color: CASH_OUT },
          ]}
          rows={overview.aging.map((a) => ({
            key: a.bucket,
            label: a.bucket === 'NOT_DUE' ? 'ยังไม่ถึง' : a.label.replace(' วัน', '').replace('เกิน ', '>'),
            fullLabel: a.label,
            values: { receivable: a.receivable, payable: a.payable },
          }))}
          emptyText="ไม่มียอดค้างรับหรือค้างจ่าย"
        />

        <section className="rounded-xl border border-slate-200 bg-white shadow-xs xl:col-span-2">
          <div className="flex items-start justify-between gap-3 p-5 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">สถานะโครงการที่เปิดอยู่</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">ความคืบหน้าจริงเทียบแผน และต้นทุนที่ตั้งหนี้แล้ว (ก่อน VAT) เทียบงบ</p>
            </div>
            <Link href="/timeline" className="shrink-0 text-[11px] font-medium text-[#2453d4] hover:underline">
              ดู Timeline
            </Link>
          </div>
          {overview.projects.length === 0 ? (
            <div className="py-14 text-center text-xs text-slate-400">ไม่มีโครงการที่เปิดอยู่</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">โครงการ</th>
                    <th className="w-44 px-3 py-2 text-left font-medium">ความคืบหน้า</th>
                    <th className="px-3 py-2 text-right font-medium">งบประมาณ</th>
                    <th className="px-3 py-2 text-right font-medium">ต้นทุน</th>
                    <th className="px-5 py-2 text-right font-medium">รับเงินแล้ว</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.projects.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="max-w-[260px] px-5 py-3">
                        <Link href={`/projects/${p.id}`} prefetch={false} className="block truncate font-semibold text-slate-900 hover:text-[#2453d4] hover:underline" title={p.name}>
                          {p.name}
                        </Link>
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          <span className="font-mono">{p.code}</span> · {PROJECT_STATUS_LABELS[p.status]}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {/* The tick marks where the plan says the project should be today */}
                        <div className="relative h-2 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${Math.min(100, p.progress)}%` }} />
                          {p.plannedProgress > 0 && (
                            <div className="absolute -bottom-0.5 -top-0.5 w-0.5 rounded bg-slate-900" style={{ left: `${Math.min(100, p.plannedProgress)}%` }} />
                          )}
                        </div>
                        <div className={`mt-1 flex items-center gap-1 text-[10px] ${p.behindPlan ? 'font-medium text-rose-700' : 'text-slate-500'}`}>
                          {p.behindPlan && <AlertTriangle className="h-3 w-3" />}
                          จริง {p.progress}% · แผน {p.plannedProgress}%
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-700">{p.budget > 0 ? baht(p.budget) : '-'}</td>
                      <td className="px-3 py-3 text-right font-mono text-slate-900">
                        {baht(p.cost)}
                        {p.overBudget && (
                          <div className="mt-0.5 flex items-center justify-end gap-1 font-sans text-[10px] font-medium text-rose-700">
                            <AlertTriangle className="h-3 w-3" /> เกินงบ
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-slate-700">{baht(p.received)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-red-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-red-800">
            เกินกำหนดชำระ (Overdue: {dash.overdue.length})
          </h2>
          {dash.overdue.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีรายการเกินกำหนด</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-red-50 text-red-900">
                <tr>
                  <th className="px-2 py-1.5 text-left">ครบกำหนด</th>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">ยอดเงิน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.overdue.map((o) => (
                  <tr key={o.id}>
                    <td className="px-2 py-1.5 font-medium text-red-700">{o.dueDate}</td>
                    <td className="px-2 py-1.5">{o.vendorName}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">
                      ฿{formatMoneyDisplay(o.gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-amber-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-amber-900">
            ครบกำหนดภายใน 7 วัน ({dash.dueSoon.length})
          </h2>
          {dash.dueSoon.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีรายการครบกำหนดใน 7 วัน</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-amber-50 text-amber-900">
                <tr>
                  <th className="px-2 py-1.5 text-left">ครบกำหนด</th>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">ยอดเงิน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.dueSoon.map((d) => (
                  <tr key={d.id}>
                    <td className="px-2 py-1.5 font-medium">{d.dueDate}</td>
                    <td className="px-2 py-1.5">{d.vendorName}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">
                      ฿{formatMoneyDisplay(d.gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">
            จ่ายเงินแล้ว แต่ยังไม่ได้รับของ ({dash.paidNotReceived.length})
          </h2>
          {dash.paidNotReceived.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีรายการค้างรับหลังจ่ายเงิน</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5 text-left">PO</th>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">มูลค่าค้างรับ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.paidNotReceived.map((p) => (
                  <tr key={p.poId}>
                    <td className="px-2 py-1.5 font-medium">
                      <Link
                        href={`/po/${p.poId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {p.number}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">{p.vendor}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-amber-800">
                      ฿{formatMoneyDisplay(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">
            ยอดตั้งหนี้ค้างจ่ายแยกตามผู้ขาย
          </h2>
          {dash.outstandingByVendor.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">ไม่มีหนี้ค้างชำระ</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5 text-left">ผู้ขาย</th>
                  <th className="px-2 py-1.5 text-right">ยอดค้างจ่ายรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.outstandingByVendor.map((v) => (
                  <tr key={v.vendorId}>
                    <td className="px-2 py-1.5">{v.name}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">
                      ฿{formatMoneyDisplay(v.gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          สรุปยอดสั่งซื้อที่อนุมัติแล้ว แยกตามโครงการ
        </h2>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">โครงการ</th>
              <th className="px-3 py-2 text-right">ยอดเดือนนี้</th>
              <th className="px-3 py-2 text-right">ยอดสะสมปีนี้ (YTD)</th>
              <th className="px-3 py-2 text-right">ยอดรวมทั้งหมด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dash.purchasesByProject.map((p) => (
              <tr key={p.projectId ?? '__OFFICE__'} className="hover:bg-blue-50/40 transition">
                <td className="px-3 py-2 font-medium">
                  {p.projectId && p.projectId !== '__OFFICE__' ? (
                    <Link
                      href={`/projects/${p.projectId}`}
                      prefetch={false}
                      className="text-[#2453d4] hover:underline font-semibold"
                    >
                      {p.name}
                    </Link>
                  ) : (
                    <span>{p.name}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  ฿{formatMoneyDisplay(p.monthGross)}
                </td>
                <td className="px-3 py-2 text-right">
                  ฿{formatMoneyDisplay(p.ytdGross)}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  ฿{formatMoneyDisplay(p.gross)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
