import Link from 'next/link';
import { getDb } from '@/db/client';
import { GL_ACCOUNT_TYPE_LABEL, GL_BOOK_LABEL, JOURNAL_SOURCE_LABEL, type GlBook, type JournalSource } from '@/domain/gl';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { accountLedger, listGlAccounts, listJournal, trialBalance } from '@/server/services/gl';
import { getSettings } from '@/server/services/settings';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { PrintButton } from '../print-button';
import { money, selectCls } from '../shared';
import { AccountsClient, RepostButton } from './gl-client';

type Tab = 'journal' | 'trial' | 'ledger' | 'accounts';
const TABS: { key: Tab; label: string }[] = [
  { key: 'journal', label: 'สมุดรายวัน' },
  { key: 'trial', label: 'งบทดลอง' },
  { key: 'ledger', label: 'บัญชีแยกประเภท' },
  { key: 'accounts', label: 'ผังบัญชี' },
];

type Sp = { tab?: string; from?: string; to?: string; book?: string; source?: string; q?: string; void?: string; page?: string; account?: string };

const input = 'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs';
const qs = (sp: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1]))).toString();
const amt = (v: number) => (v === 0 ? '' : money(v));

export default async function GlPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const today = bangkokDateString();
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'journal';
  const from = sp.from || `${today.slice(0, 4)}-01-01`;
  const to = sp.to || today;
  const canManage = can(actor, 'gl.manage');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">สมุดรายวันและบัญชีแยกประเภท</h1>
          <p className="text-xs text-slate-500">ระบบลงบัญชีอัตโนมัติเมื่อบันทึกซื้อเชื่อ (RR), จ่ายชำระ (PV), วางบิลขาย (IV), รับชำระ (RE) และเอกสารขาย/รับ-จ่าย</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/accounting/gl/opening" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            บันทึกยอดยกมา
          </Link>
          <Link href="/accounting/gl/close" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            ปิดงวด / ปิดบัญชี
          </Link>
          {canManage && <RepostButton />}
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/accounting/gl?${qs({ tab: t.key, from: sp.from, to: sp.to })}`}
            className={`rounded-t-lg px-4 py-2 text-sm ${tab === t.key ? 'border border-b-white border-slate-200 bg-white font-semibold text-[#2453d4]' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'journal' && <JournalTab sp={sp} from={from} to={to} />}
      {tab === 'trial' && <TrialTab from={from} to={to} />}
      {tab === 'ledger' && <LedgerTab from={from} to={to} accountId={sp.account} />}
      {tab === 'accounts' && <AccountsClient accounts={await listGlAccounts(db, actor)} canManage={canManage} />}
    </div>
  );
}

function RangeFields({ from, to, tab, children }: { from: string; to: string; tab: Tab; children?: React.ReactNode }) {
  return (
    <form className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tab" value={tab} />
      <label className="text-[11px] text-slate-500">
        ตั้งแต่
        <input type="date" name="from" defaultValue={from} className={`${input} ml-1`} />
      </label>
      <label className="text-[11px] text-slate-500">
        ถึง
        <input type="date" name="to" defaultValue={to} className={`${input} ml-1`} />
      </label>
      {children}
      <button className="rounded-lg bg-[#2453d4] px-3 py-2 text-xs font-semibold text-white">แสดง</button>
    </form>
  );
}

async function JournalTab({ sp, from, to }: { sp: Sp; from: string; to: string }) {
  const actor = await requireUser();
  const db = await getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const filter = { from, to, book: sp.book || undefined, source: sp.source || undefined, q: sp.q || undefined, includeVoid: sp.void === '1' };
  const j = await listJournal(db, actor, { ...filter, page, pageSize: 20 });
  const pages = Math.max(1, Math.ceil(j.total / j.pageSize));
  const base = { tab: 'journal', from, to, book: sp.book, source: sp.source, q: sp.q, void: sp.void };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <RangeFields from={from} to={to} tab="journal">
          <select name="book" defaultValue={sp.book ?? ''} aria-label="สมุด" className={selectCls}>
            <option value="">ทุกสมุด</option>
            {(Object.keys(GL_BOOK_LABEL) as GlBook[]).map((b) => (
              <option key={b} value={b}>
                {GL_BOOK_LABEL[b]}
              </option>
            ))}
          </select>
          <select name="source" defaultValue={sp.source ?? ''} aria-label="ประเภทเอกสาร" className={selectCls}>
            <option value="">ทุกเอกสาร</option>
            {(Object.keys(JOURNAL_SOURCE_LABEL) as JournalSource[]).map((s) => (
              <option key={s} value={s}>
                {JOURNAL_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={sp.q ?? ''} placeholder="ค้นหาเลขที่ / คู่ค้า" className={`${input} w-44`} />
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            <input type="checkbox" name="void" value="1" defaultChecked={sp.void === '1'} /> รวมรายการยกเลิก
          </label>
        </RangeFields>
        <a href={`/api/csv/gl-journal?${qs(base)}`} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          Export CSV
        </a>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-xs">
          <thead className="bg-[#102d72] text-white">
            <tr>
              {['วันที่', 'เลขที่ JV', 'สมุด', 'เอกสารอ้างอิง', 'คู่ค้า / คำอธิบาย', 'รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต'].map((h) => (
                <th key={h} className={`px-3 py-2.5 font-medium ${h === 'เดบิต' || h === 'เครดิต' ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {j.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-slate-400">
                  ไม่มีรายการบัญชีในช่วงนี้ (ถ้ามีเอกสารเก่าก่อนเปิดใช้ ให้กด &quot;ลงบัญชีย้อนหลัง&quot;)
                </td>
              </tr>
            ) : (
              j.rows.map((e) =>
                e.lines.map((l, i) => (
                  <tr key={`${e.id}-${i}`} className={`${i === e.lines.length - 1 ? 'border-b border-slate-200' : ''} ${e.status === 'VOID' ? 'text-slate-400 line-through' : ''}`}>
                    {i === 0 ? (
                      <>
                        <td rowSpan={e.lines.length} className="px-3 py-1.5 align-top whitespace-nowrap">
                          {formatThaiDate(e.date)}
                        </td>
                        <td rowSpan={e.lines.length} className="px-3 py-1.5 align-top font-mono">
                          {e.number}
                        </td>
                        <td rowSpan={e.lines.length} className="px-3 py-1.5 align-top">
                          {e.book}
                        </td>
                        <td rowSpan={e.lines.length} className="px-3 py-1.5 align-top">
                          <span className="font-mono">{e.sourceNumber}</span>
                          <span className="block text-[10px] text-slate-400">{JOURNAL_SOURCE_LABEL[e.sourceType]}</span>
                        </td>
                        <td rowSpan={e.lines.length} className="px-3 py-1.5 align-top">
                          {e.partyName}
                          <span className="block text-[10px] text-slate-400">{e.status === 'VOID' ? `ยกเลิก: ${e.voidReason ?? ''}` : e.description}</span>
                        </td>
                      </>
                    ) : null}
                    <td className={`px-3 py-1.5 font-mono ${l.credit > 0 ? 'pl-6' : ''}`}>{l.code}</td>
                    <td className={`px-3 py-1.5 ${l.credit > 0 ? 'pl-6' : ''}`}>{l.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{amt(l.debit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{amt(l.credit)}</td>
                  </tr>
                )),
              )
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {j.total} รายการ · หน้า {page}/{pages}
        </span>
        <div className="flex gap-1">
          {page > 1 && (
            <Link href={`/accounting/gl?${qs({ ...base, page: String(page - 1) })}`} className="rounded border border-slate-300 bg-white px-3 py-1.5">
              ก่อนหน้า
            </Link>
          )}
          {page < pages && (
            <Link href={`/accounting/gl?${qs({ ...base, page: String(page + 1) })}`} className="rounded border border-slate-300 bg-white px-3 py-1.5">
              ถัดไป
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

async function TrialTab({ from, to }: { from: string; to: string }) {
  const actor = await requireUser();
  const db = await getDb();
  const [tb, settings] = await Promise.all([trialBalance(db, actor, { from, to }), getSettings(db)]);
  const balanced = tb.totals.closingDebit === tb.totals.closingCredit;
  const table = (
    <table className="w-full min-w-[900px] text-xs">
      <thead className="bg-[#102d72] text-white">
        <tr>
          <th rowSpan={2} className="px-3 py-2 text-left font-medium">รหัส</th>
          <th rowSpan={2} className="px-3 py-2 text-left font-medium">ชื่อบัญชี</th>
          <th colSpan={2} className="px-3 py-1 text-center font-medium">ยอดยกมา</th>
          <th colSpan={2} className="px-3 py-1 text-center font-medium">ระหว่างงวด</th>
          <th colSpan={2} className="px-3 py-1 text-center font-medium">ยอดคงเหลือ</th>
        </tr>
        <tr>
          {['เดบิต', 'เครดิต', 'เดบิต', 'เครดิต', 'เดบิต', 'เครดิต'].map((h, i) => (
            <th key={i} className="px-3 py-1 text-right font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {tb.rows.length === 0 ? (
          <tr>
            <td colSpan={8} className="py-10 text-center text-slate-400">
              ยังไม่มีรายการบัญชี
            </td>
          </tr>
        ) : (
          tb.rows.map((r) => (
            <tr key={r.accountId}>
              <td className="px-3 py-1.5 font-mono">
                <Link href={`/accounting/gl?${qs({ tab: 'ledger', account: r.accountId, from, to })}`} className="text-[#2453d4] hover:underline">
                  {r.code}
                </Link>
              </td>
              <td className="px-3 py-1.5">
                {r.name} <span className="text-[10px] text-slate-400">{GL_ACCOUNT_TYPE_LABEL[r.type]}</span>
              </td>
              {[r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit, r.closingDebit, r.closingCredit].map((v, i) => (
                <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                  {amt(v)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
      <tfoot className="bg-slate-50 font-semibold">
        <tr>
          <td colSpan={2} className="px-3 py-2 text-right">
            รวม
          </td>
          {[tb.totals.openingDebit, tb.totals.openingCredit, tb.totals.periodDebit, tb.totals.periodCredit, tb.totals.closingDebit, tb.totals.closingCredit].map((v, i) => (
            <td key={i} className="px-3 py-2 text-right tabular-nums">
              {money(v)}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <RangeFields from={from} to={to} tab="trial" />
        <div className="flex gap-2">
          <a href={`/api/csv/gl-trial-balance?${qs({ from, to })}`} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            Export CSV
          </a>
          <PrintButton />
        </div>
      </div>
      <p className={`text-xs ${balanced ? 'text-emerald-700' : 'text-rose-600'}`}>{balanced ? '✓ ยอดเดบิตเท่ากับเครดิต' : '✗ ยอดเดบิตไม่เท่ากับเครดิต กรุณากด "ลงบัญชีย้อนหลัง" เพื่อตรวจสอบ'}</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">{table}</div>
      <PrintRoot>
        <div className="a4-page p-6 text-xs">
          <p className="text-base font-bold">งบทดลอง</p>
          <p>
            {settings.companyName} · ตั้งแต่ {formatThaiDate(from)} ถึง {formatThaiDate(to)}
          </p>
          <div className="mt-3">{table}</div>
        </div>
      </PrintRoot>
    </div>
  );
}

async function LedgerTab({ from, to, accountId }: { from: string; to: string; accountId?: string }) {
  const actor = await requireUser();
  const db = await getDb();
  const accounts = await listGlAccounts(db, actor);
  const picked = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.used) ?? accounts[0];
  const l = picked ? await accountLedger(db, actor, picked.id, { from, to }) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <RangeFields from={from} to={to} tab="ledger">
          <select name="account" defaultValue={picked?.id} aria-label="บัญชี" className={selectCls}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </RangeFields>
        {picked && (
          <a href={`/api/csv/gl-ledger?${qs({ account: picked.id, from, to })}`} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            Export CSV
          </a>
        )}
      </div>
      {l && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-[#102d72] text-white">
              <tr>
                {['วันที่', 'เลขที่ JV', 'เอกสาร', 'คู่ค้า / คำอธิบาย', 'เดบิต', 'เครดิต', 'คงเหลือ'].map((h) => (
                  <th key={h} className={`px-3 py-2.5 font-medium ${['เดบิต', 'เครดิต', 'คงเหลือ'].includes(h) ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50">
                <td colSpan={6} className="px-3 py-1.5 text-slate-500">
                  ยอดยกมา {l.account.code} {l.account.name}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(l.opening)}</td>
              </tr>
              {l.rows.map((r, i) => (
                <tr key={`${r.id}-${i}`}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{formatThaiDate(r.date)}</td>
                  <td className="px-3 py-1.5 font-mono">{r.number}</td>
                  <td className="px-3 py-1.5 font-mono">{r.sourceNumber}</td>
                  <td className="px-3 py-1.5">
                    {r.partyName} <span className="text-slate-400">{r.description}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{amt(r.debit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{amt(r.credit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold">
              <tr>
                <td colSpan={6} className="px-3 py-2 text-right">
                  ยอดคงเหลือ (เดบิต + / เครดิต −)
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
