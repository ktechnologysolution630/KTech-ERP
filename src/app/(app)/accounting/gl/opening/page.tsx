import Link from 'next/link';
import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listCustomers } from '@/server/services/ar';
import { listGlAccounts } from '@/server/services/gl';
import { listVendors } from '@/server/services/master';
import { getOpeningOverview } from '@/server/services/opening';
import { money } from '../../shared';
import { ApOpeningForm, ArOpeningForm, OpeningEntryEditor, RemoveOpeningButton } from './opening-client';

function Check({ label, detail, ledger }: { label: string; detail: number; ledger: number }) {
  const ok = Math.abs(detail - ledger) < 0.005;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
      {label}: รายตัว {money(detail)} · ในยอดยกมา {money(ledger)} {ok ? '✓ ตรงกัน' : `· ต่าง ${money(Math.abs(detail - ledger))}`}
    </div>
  );
}

export default async function OpeningPage() {
  const actor = await requireUser();
  const db = await getDb();
  const canManage = can(actor, 'gl.manage');
  const today = bangkokDateString();
  const [o, accounts, customers, vendors] = await Promise.all([
    getOpeningOverview(db, actor),
    listGlAccounts(db, actor),
    canManage ? listCustomers(db, actor) : Promise.resolve([]),
    canManage ? listVendors(db) : Promise.resolve([]),
  ]);
  const date = o.entry?.date ?? `${today.slice(0, 4)}-01-01`;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link href="/accounting/gl" className="text-xs text-[#2453d4] hover:underline">
          ← สมุดรายวันและบัญชีแยกประเภท
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">บันทึกยอดยกมา</h1>
        <p className="text-xs text-slate-500">
          ใช้ครั้งแรกตอนเริ่มใช้ระบบ: ยอดคงเหลือของทุกบัญชี ณ วันเริ่มต้น แล้วแจกรายตัวลูกหนี้และเจ้าหนี้ที่ยังค้าง เพื่อรับชำระหรือจ่ายต่อในระบบได้ ส่วนสินค้ายกมาให้บันทึกที่เมนูคลังสินค้า
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">1. ยอดบัญชียกมา {o.entry && <span className="font-normal text-slate-500">({o.entry.number})</span>}</h2>
        <OpeningEntryEditor
          accounts={accounts.filter((a) => a.active).map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          initial={{ date, lines: o.entry?.lines ?? [] }}
          canManage={canManage}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">2. ลูกหนี้คงค้างยกมา</h2>
        <Check label="ลูกหนี้การค้า" detail={o.check.arDetail} ledger={o.check.arLedger} />
        {o.ar.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1.5 pr-2 font-medium">ลูกค้า</th>
                <th className="py-1.5 pr-2 font-medium">เลขที่</th>
                <th className="py-1.5 pr-2 font-medium">ครบกำหนด</th>
                <th className="py-1.5 pr-2 text-right font-medium">ยอดค้าง</th>
                <th className="py-1.5 pr-2 font-medium">สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {o.ar.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">{r.customerName}</td>
                  <td className="py-1.5 pr-2">
                    <Link href={`/ar/invoices/${r.id}`} className="text-[#2453d4] hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2">{r.dueDate}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{money(r.gross)}</td>
                  <td className="py-1.5 pr-2">{r.status === 'ISSUED' ? 'ค้างรับ' : r.status === 'PARTIAL' ? 'รับบางส่วน' : 'รับครบ'}</td>
                  <td className="py-1.5 text-right">{canManage && r.status === 'ISSUED' && <RemoveOpeningButton id={r.id} kind="AR" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canManage && <ArOpeningForm customers={customers} defaultDate={date} />}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">3. เจ้าหนี้คงค้างยกมา</h2>
        <Check label="เจ้าหนี้การค้า" detail={o.check.apDetail} ledger={o.check.apLedger} />
        {o.ap.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1.5 pr-2 font-medium">ผู้ขาย</th>
                <th className="py-1.5 pr-2 font-medium">เลขที่บิลเดิม</th>
                <th className="py-1.5 pr-2 font-medium">ครบกำหนด</th>
                <th className="py-1.5 pr-2 text-right font-medium">ยอดค้าง</th>
                <th className="py-1.5 pr-2 font-medium">สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {o.ap.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">{r.vendorName}</td>
                  <td className="py-1.5 pr-2">{r.docNo}</td>
                  <td className="py-1.5 pr-2">{r.dueDate}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{money(r.gross)}</td>
                  <td className="py-1.5 pr-2">{r.status === 'OPEN' ? 'รอตั้งจ่าย' : r.status === 'IN_PV' ? 'อยู่ในใบสำคัญจ่าย' : 'จ่ายแล้ว'}</td>
                  <td className="py-1.5 text-right">{canManage && r.status === 'OPEN' && <RemoveOpeningButton id={r.id} kind="AP" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canManage && <ApOpeningForm vendors={vendors} defaultDate={date} />}
      </section>
    </div>
  );
}
