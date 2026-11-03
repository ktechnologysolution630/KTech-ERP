'use client';

import React from 'react';
import Link from 'next/link';
import { Info, Printer } from 'lucide-react';
import { loadCostPerformanceAction } from '@/app/(app)/projects/[id]/site-actions';
import { formatMoneyDisplay } from '@/domain/money';
import { useSiteLoader } from './project-site/use-site-loader';

interface ProjectCostPerformanceViewProps {
  projectId: string;
  projectName: string;
  location: string;
  startDate: string;
  endDate: string;
  projectManager: string;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const monthLabel = (key: string) => `${TH_MONTHS[Number(key.slice(5, 7)) - 1]} ${String(Number(key.slice(0, 4)) + 543).slice(2)}`;
const thaiDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
};
const baht = (n: number) => formatMoneyDisplay(n);
const signed = (n: number) => `${n > 0 ? '+' : ''}${baht(n)}`;
const ratio = (n: number | null) => (n === null ? '-' : n.toFixed(2));

const BUDGET_SOURCE: Record<'BOQ' | 'PROJECT' | 'NONE', string> = {
  BOQ: 'ต้นทุนทางตรงจาก BOQ หลัก (ค่าวัสดุ + ค่าแรง)',
  PROJECT: 'งบประมาณที่ตั้งไว้ในโครงการ (ยังไม่มี BOQ)',
  NONE: 'ยังไม่มี BOQ และยังไม่ได้ตั้งงบประมาณโครงการ',
};

function Metric({ label, value, hint, tone = 'text-slate-900' }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="p-4 sm:p-5 space-y-1">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold font-mono ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{hint}</div>
    </div>
  );
}

function Gauge({ value }: { value: number | null }) {
  const v = Math.min(2, Math.max(0, value ?? 0));
  const angle = Math.PI - (v / 2) * Math.PI;
  return (
    <svg className="w-36 h-20 overflow-visible" viewBox="0 0 100 55">
      <path d="M 10 50 A 40 40 0 0 1 30 15.4" fill="none" stroke="#ef4444" strokeWidth="8" />
      <path d="M 30 15.4 A 40 40 0 0 1 50 10" fill="none" stroke="#f59e0b" strokeWidth="8" />
      <path d="M 50 10 A 40 40 0 0 1 70 15.4" fill="none" stroke="#10b981" strokeWidth="8" />
      <path d="M 70 15.4 A 40 40 0 0 1 90 50" fill="none" stroke="#3b82f6" strokeWidth="8" />
      {value !== null && (
        <line x1="50" y1="50" x2={50 + 32 * Math.cos(angle)} y2={50 - 32 * Math.sin(angle)} stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      )}
      <circle cx="50" cy="50" r="4" fill="#0f172a" />
    </svg>
  );
}

export function ProjectCostPerformanceView({
  projectId,
  projectName,
  location,
  startDate,
  endDate,
  projectManager,
}: ProjectCostPerformanceViewProps) {
  const { data, error } = useSiteLoader(() => loadCostPerformanceAction(projectId), [projectId]);

  if (error) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-600">{error}</div>;
  }
  if (!data) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-400">กำลังคำนวณประสิทธิภาพต้นทุน…</div>;
  }

  const { evm } = data;
  const pct = (n: number) => (evm.bac > 0 ? `${((n / evm.bac) * 100).toFixed(1)}%` : '-');
  const totalBudget = data.categories.reduce((a, c) => a + c.budget, 0);
  const totalCommitted = data.categories.reduce((a, c) => a + c.committed, 0);

  // S-curve geometry (x across months, y 0–100%)
  const n = data.curve.length;
  const x = (i: number) => 50 + (n <= 1 ? 0 : (i / (n - 1)) * 420);
  const y = (p: number) => 160 - (Math.min(110, Math.max(0, p)) / 100) * 140;
  const plannedPath = data.curve.map((c, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(c.planned)}`).join(' ');
  const costPoints = data.curve.map((c, i) => ({ i, v: c.actualCost })).filter((p): p is { i: number; v: number } => p.v !== null);
  const costPath = costPoints.map((p, k) => `${k === 0 ? 'M' : 'L'} ${x(p.i)} ${y(p.v)}`).join(' ');
  const todayIndex = data.curve.findIndex((c) => c.month === data.asOf.slice(0, 7));
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  const cpiTone = evm.cpi === null ? 'text-slate-400' : evm.cpi >= 1 ? 'text-emerald-600' : 'text-rose-600';
  const spiTone = evm.spi === null ? 'text-slate-400' : evm.spi >= 1 ? 'text-emerald-600' : 'text-amber-600';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> คำนวณอัตโนมัติจาก BOQ แผนงาน (Gantt) และต้นทุนที่ตั้งหนี้แล้ว
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Printer className="w-3.5 h-3.5 text-slate-500" /> พิมพ์รายงาน
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 max-w-6xl mx-auto space-y-6">
        <div className="text-center pt-2">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">แบบรายงานประสิทธิภาพต้นทุนโครงการ</h2>
          <div className="w-16 h-1 bg-[#2453d4] rounded-full mx-auto mt-2" />
        </div>

        <div className="bg-slate-50/70 border border-slate-200/90 rounded-xl p-4 sm:p-5 text-xs text-slate-700 grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-8">
          <div className="flex gap-2"><span className="text-slate-400 w-28">โครงการ:</span><span className="font-semibold text-slate-900">{projectName}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-28">สถานที่ก่อสร้าง:</span><span>{location || '-'}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-28">ผู้จัดการโครงการ:</span><span>{projectManager || '-'}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-28">ณ วันที่:</span><span className="font-mono">{thaiDate(data.asOf)}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-28">ระยะเวลา:</span><span className="font-mono">{startDate === '-' && endDate === '-' ? 'ยังไม่กำหนด' : `${startDate} - ${endDate}`}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-28">งบประมาณ (BAC):</span><span className="font-mono font-bold text-slate-900">{baht(evm.bac)} บาท</span></div>
          <div className="md:col-span-2 text-[11px] text-slate-400">ที่มาของงบประมาณ: {BUDGET_SOURCE[data.budgetSource]}</div>
        </div>

        {data.budgetSource === 'NONE' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            ยังคำนวณไม่ได้ — กรุณาทำ BOQ ในแท็บ BOQ หรือระบุงบประมาณในแท็บตั้งค่าโครงการก่อน
          </div>
        )}
        {!data.hasSchedule && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            ยังไม่มีงานที่กำหนดวันเริ่ม-วันเสร็จ จึงยังไม่มีแผน (PV/SPI) — เพิ่มงานพร้อมวันที่ในแท็บ{' '}
            <Link href={`/projects/${projectId}?tab=tasks`} className="text-[#2453d4] underline">
              งาน
            </Link>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <span className="inline-block px-2.5 py-1 rounded bg-blue-50 text-[#2453d4] border border-blue-200 text-xs font-bold">
              สรุปค่าดัชนีมูลค่างานที่ทำได้ (EVM)
            </span>
            <span className="text-[11px] text-slate-400">หน่วย: บาท</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 border border-slate-200 rounded-xl overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <Metric label="งานตามแผน (PV)" value={baht(evm.pv)} hint={`แผนสะสม ${data.plannedPercent}% ของ BAC`} />
            <Metric label="มูลค่างานที่ทำได้ (EV)" value={baht(evm.ev)} hint={`ความคืบหน้าจริง ${data.actualPercent}%`} />
            <Metric label="ต้นทุนจริง (AC)" value={baht(evm.ac)} hint={`${pct(evm.ac)} ของงบ · ยอดตั้งหนี้ก่อน VAT`} />
            <div className="p-4 sm:p-5 flex flex-col items-center">
              <div className="text-xs font-semibold text-slate-500 self-start">ดัชนีต้นทุน (CPI)</div>
              <Gauge value={evm.cpi} />
              <div className={`font-mono font-bold text-lg ${cpiTone}`}>{ratio(evm.cpi)}</div>
              <span className="text-[10px] text-slate-500">
                {evm.cpi === null
                  ? evm.ac === 0
                    ? 'ยังไม่มีต้นทุนจริง'
                    : 'มีต้นทุนแล้วแต่ยังไม่มีผลงาน'
                  : evm.cpi >= 1
                    ? 'ใช้เงินน้อยกว่ามูลค่างาน'
                    : 'ใช้เงินเกินมูลค่างาน'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 border border-slate-200 rounded-xl overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <Metric label="ผลต่างต้นทุน (CV)" value={signed(evm.cv)} hint="EV − AC (บวก = ประหยัด)" tone={evm.cv >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
            <Metric label="ผลต่างแผนงาน (SV)" value={signed(evm.sv)} hint="EV − PV (ลบ = ช้ากว่าแผน)" tone={evm.sv >= 0 ? 'text-emerald-600' : 'text-amber-600'} />
            <Metric label="ดัชนีแผนงาน (SPI)" value={ratio(evm.spi)} hint="EV ÷ PV (≥ 1 = ตามแผน)" tone={spiTone} />
            <Metric label="ประมาณการเมื่อแล้วเสร็จ (EAC)" value={baht(evm.eac)} hint={`BAC ÷ CPI · ส่วนต่าง ${signed(evm.vac)}`} />
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900">S-Curve: แผนงานสะสม เทียบต้นทุนจริงสะสม</h4>
            <p className="text-[11px] text-slate-400">เป็น % ของงบประมาณ (BAC) ณ สิ้นแต่ละเดือน · จุดเขียว = ผลงานจริงวันนี้</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-blue-600 font-medium"><span className="w-3 h-0.5 bg-blue-600" /> ตามแผน (PV)</span>
            <span className="flex items-center gap-1.5 text-amber-600 font-medium"><span className="w-3 h-0.5 bg-amber-500" /> ต้นทุนจริง (AC)</span>
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium"><span className="w-2 h-2 rounded-full bg-emerald-500" /> ผลงานจริง (EV)</span>
          </div>
          {n === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">ยังไม่มีข้อมูลพอสำหรับวาดกราฟ (ต้องมีงบประมาณและวันที่ของโครงการหรืองาน)</div>
          ) : (
            <div className="h-56 w-full">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 500 185">
                {[0, 25, 50, 75, 100].map((v) => (
                  <g key={v}>
                    <line x1="40" y1={y(v)} x2="480" y2={y(v)} stroke="#f1f5f9" strokeDasharray="3 3" />
                    <text x="32" y={y(v) + 3} fontSize="9" textAnchor="end" fill="#94a3b8">{v}%</text>
                  </g>
                ))}
                {data.hasSchedule && <path d={plannedPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />}
                {costPath && <path d={costPath} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" />}
                {todayIndex >= 0 && (
                  <>
                    <line x1={x(todayIndex)} x2={x(todayIndex)} y1="20" y2="160" stroke="#cbd5e1" strokeDasharray="2 2" />
                    <circle cx={x(todayIndex)} cy={y(data.actualPercent)} r="4.5" fill="#10b981" />
                  </>
                )}
                {data.curve.map((c, i) =>
                  i % labelEvery === 0 || i === n - 1 ? (
                    <text key={c.month} x={x(i)} y="178" fontSize="8" textAnchor="middle" fill="#94a3b8">
                      {monthLabel(c.month)}
                    </text>
                  ) : null,
                )}
              </svg>
            </div>
          )}
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">งบประมาณตามหมวดงาน BOQ เทียบยอดสั่งซื้อ</h3>
              <p className="text-[11px] text-slate-400">ยอดสั่งซื้อ = รายการ PO ที่อนุมัติแล้วซึ่งผูกกับบรรทัด BOQ (ก่อน VAT)</p>
            </div>
            <span className="text-xs text-slate-500">{data.categories.length} หมวด</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="py-3 px-4 min-w-[200px]">หมวดงาน</th>
                  <th className="py-3 px-3 text-right">งบประมาณ</th>
                  <th className="py-3 px-3 text-right">สั่งซื้อแล้ว</th>
                  <th className="py-3 px-3 text-right">คงเหลือ</th>
                  <th className="py-3 px-3 w-40">ใช้ไป</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {data.categories.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center font-sans text-slate-400">
                      ยังไม่มี BOQ —{' '}
                      <Link href={`/projects/${projectId}?tab=boq`} className="text-[#2453d4] underline">
                        ไปที่แท็บ BOQ
                      </Link>
                    </td>
                  </tr>
                )}
                {data.categories.map((c) => (
                  <tr key={c.key} className="hover:bg-blue-50/30">
                    <td className="py-3 px-4 font-sans font-medium text-slate-900">{c.name}</td>
                    <td className="py-3 px-3 text-right">{baht(c.budget)}</td>
                    <td className="py-3 px-3 text-right">{baht(c.committed)}</td>
                    <td className={`py-3 px-3 text-right ${c.remaining < 0 ? 'text-rose-600 font-semibold' : ''}`}>{baht(c.remaining)}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full ${c.usedPercent > 100 ? 'bg-rose-500' : c.usedPercent > 85 ? 'bg-amber-500' : 'bg-[#2453d4]'}`}
                            style={{ width: `${Math.min(100, c.usedPercent)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right">{c.usedPercent}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.unlinkedCommitted > 0 && (
                  <tr className="text-slate-500">
                    <td className="py-3 px-4 font-sans">สั่งซื้อที่ไม่ได้ผูกกับ BOQ</td>
                    <td className="py-3 px-3 text-right">-</td>
                    <td className="py-3 px-3 text-right">{baht(data.unlinkedCommitted)}</td>
                    <td className="py-3 px-3" colSpan={2} />
                  </tr>
                )}
              </tbody>
              {data.categories.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-slate-900 border-t-2 border-slate-200 font-mono">
                    <td className="py-3 px-4 font-sans">รวม</td>
                    <td className="py-3 px-3 text-right">{baht(totalBudget)}</td>
                    <td className="py-3 px-3 text-right">{baht(totalCommitted + data.unlinkedCommitted)}</td>
                    <td className="py-3 px-3 text-right">{baht(totalBudget - totalCommitted - data.unlinkedCommitted)}</td>
                    <td className="py-3 px-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
