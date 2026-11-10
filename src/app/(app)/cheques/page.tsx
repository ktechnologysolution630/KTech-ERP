import Link from 'next/link';
import { getDb } from '@/db/client';
import { formatMoneyDisplay } from '@/domain/money';
import { CHEQUE_STATUS_LABEL, PAY_METHOD_LABEL, addDays } from '@/domain/payment-terms';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { getChequeSchedule } from '@/server/services/cheque-schedule';

const RANGES = [
  { days: 14, label: '2 สัปดาห์' },
  { days: 31, label: '1 เดือน' },
  { days: 62, label: '2 เดือน' },
  { days: 93, label: '3 เดือน' },
];

export default async function ChequeSchedulePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const days = RANGES.find((r) => String(r.days) === sp.days)?.days ?? 31;
  const today = bangkokDateString();
  const until = addDays(today, days);
  const data = await getChequeSchedule(db, actor, { today, until });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ตารางจ่ายเช็ค</h1>
          <p className="text-xs text-slate-600">บิลที่ต้องจ่ายตามรอบ (วันครบกำหนดคำนวณจากรอบวางบิลและรอบรับเช็คของผู้ขาย) และเช็คที่ออกแล้วรอผู้ขายรับ</p>
        </div>
        <nav className="flex gap-1 text-xs" aria-label="ช่วงเวลา">
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/cheques?days=${r.days}`}
              className={`rounded-lg border px-3 py-1.5 ${r.days === days ? 'border-[#2453d4] bg-[#2453d4] text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={`ยอดต้องจ่ายถึง ${formatThaiDate(until)}`} value={`฿${formatMoneyDisplay(data.totalDue)}`} />
        <Stat label="เกินกำหนดแล้ว" value={`฿${formatMoneyDisplay(data.totalOverdue)}`} tone={Number(data.totalOverdue) > 0 ? 'red' : undefined} />
        <Stat label="เช็คที่ออกแล้วยังไม่ผ่าน" value={`${data.cheques.length} ใบ`} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">บิลที่ต้องจ่ายตามรอบ</h2>
        {data.due.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400">ไม่มีบิลครบกำหนดในช่วงนี้</p>
        ) : (
          data.due.map((g) => (
            <div key={g.dueDate} className={`overflow-hidden rounded-xl border bg-white ${g.overdue ? 'border-red-200' : 'border-slate-200'}`}>
              <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs ${g.overdue ? 'bg-red-50 text-red-800' : 'bg-slate-50 text-slate-700'}`}>
                <span className="font-bold">
                  {formatThaiDate(g.dueDate)}
                  {g.overdue && ' · เกินกำหนด'}
                  {g.dueDate === today && ' · วันนี้'}
                </span>
                <span>
                  {g.bills.length} บิล · เตรียมเช็ค {g.chequeCount} ใบ · รวม <b>฿{formatMoneyDisplay(g.total)}</b>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    {g.bills.map((b) => (
                      <tr key={b.id}>
                        <td className="px-4 py-2 font-medium text-slate-800">{b.vendorName}</td>
                        <td className="px-4 py-2 text-slate-500">{b.poNumber ?? '-'}</td>
                        <td className="px-4 py-2 text-slate-500">{b.docRef}</td>
                        <td className="px-4 py-2">{PAY_METHOD_LABEL[b.payMethod]}</td>
                        <td className="px-4 py-2">{b.status === 'IN_PV' ? <span className="text-blue-700">อยู่ใน PV แล้ว</span> : <span className="text-amber-700">ยังไม่ทำ PV</span>}</td>
                        <td className="px-4 py-2 text-right font-semibold">฿{formatMoneyDisplay(b.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">เช็คที่ออกแล้ว รอผู้ขายรับ / รอเช็คผ่าน</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left">PV</th>
                <th className="px-4 py-2.5 text-left">ผู้ขาย</th>
                <th className="px-4 py-2.5 text-left">เลขที่เช็ค</th>
                <th className="px-4 py-2.5 text-left">ธนาคาร</th>
                <th className="px-4 py-2.5 text-left">วันที่หน้าเช็ค</th>
                <th className="px-4 py-2.5 text-left">สถานะ</th>
                <th className="px-4 py-2.5 text-right">ยอดสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.cheques.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    ไม่มีเช็คค้าง
                  </td>
                </tr>
              ) : (
                data.cheques.map((c) => (
                  <tr key={c.pvId}>
                    <td className="px-4 py-2">
                      <Link href={`/pv/${c.pvId}`} className="text-blue-600 hover:underline">
                        {c.pvNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{c.vendorName}</td>
                    <td className="px-4 py-2 font-mono">{c.chequeNo}</td>
                    <td className="px-4 py-2">{c.chequeBank}</td>
                    <td className="px-4 py-2">{c.chequeDate ? formatThaiDate(c.chequeDate) : '-'}</td>
                    <td className="px-4 py-2">
                      {CHEQUE_STATUS_LABEL[c.status]}
                      {c.collectedBy && ` (${c.collectedBy})`}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">฿{formatMoneyDisplay(c.net)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${tone === 'red' ? 'border-red-200' : 'border-slate-200'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
