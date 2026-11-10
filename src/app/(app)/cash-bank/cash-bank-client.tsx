'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Landmark, Pencil, Plus, Wallet, X } from 'lucide-react';
import { DateInput } from '@/components/date-input';
import { formatMoneyDisplay } from '@/domain/money';
import { SALES_DOC_META, type SalesDocKind } from '@/domain/sales-doc';
import { formatThaiDate } from '@/domain/thai';
import { THAI_BANKS } from '@/domain/vendor-profile';
import type { AccountSummary } from '@/server/services/sales-docs';
import { saveCompanyAccountAction } from '../sales/actions';

const TYPE_LABEL: Record<string, string> = { SAVINGS: 'ออมทรัพย์', CURRENT: 'กระแสรายวัน', FIXED: 'ฝากประจำ', CASH: 'เงินสด', OTHER: 'อื่น ๆ' };
const field = 'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-normal focus:border-[#2453d4] focus:outline-none';

/** Company bank and cash accounts with balance from opening, receipts and payment vouchers */
export function CashBankClient({ accounts }: { accounts: AccountSummary[] }) {
  const [editing, setEditing] = useState<AccountSummary | 'new' | null>(null);
  const total = accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">เงินสด / ธนาคาร</h1>
          <p className="text-xs text-slate-500">จัดการบัญชีธนาคาร เงินสด และยอดยกมาสำหรับงานบัญชี</p>
        </div>
        <div className="flex items-center gap-3">
          {accounts.length > 0 && (
            <span className="text-xs text-slate-500">
              ยอดรวมทุกบัญชีที่ใช้งาน <b className="text-base text-slate-900">฿{formatMoneyDisplay(total.toFixed(2))}</b>
            </span>
          )}
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1c43ab]">
            <Plus className="h-4 w-4" /> เพิ่มบัญชีธนาคาร
          </button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Landmark className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 font-semibold text-slate-700">ยังไม่มีบัญชีธนาคาร</p>
          <p className="text-xs text-slate-500">กดเพิ่มบัญชีธนาคารเพื่อเริ่มบันทึกข้อมูล</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.map((a) => (
            <section key={a.id} className={`rounded-xl border bg-white p-4 shadow-xs ${a.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-blue-50 p-2 text-[#2453d4]">{a.type === 'CASH' ? <Wallet className="h-5 w-5" /> : <Landmark className="h-5 w-5" />}</div>
                  <div>
                    <p className="font-semibold text-slate-900">{a.bank}</p>
                    <p className="text-xs text-slate-600">
                      {a.accountNo} · {a.accountName} · {TYPE_LABEL[a.type] ?? a.type}
                      {a.branch && ` · สาขา ${a.branch}`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                      {a.isDefaultReceive && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">บัญชีรับเงินหลัก</span>}
                      {a.isDefaultPay && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">บัญชีจ่ายเงินหลัก</span>}
                      {!a.active && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">ไม่ใช้งาน</span>}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => setEditing(a)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title={`แก้ไข ${a.bank} ${a.accountNo}`}>
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
                <div>
                  <dt className="text-slate-500">ยอดยกมา</dt>
                  <dd className="font-semibold">{formatMoneyDisplay(a.openingBalance.toFixed(2))}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">รับเข้า</dt>
                  <dd className="font-semibold text-emerald-700">+{formatMoneyDisplay(a.moneyIn.toFixed(2))}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">จ่ายออก</dt>
                  <dd className="font-semibold text-rose-600">-{formatMoneyDisplay(a.moneyOut.toFixed(2))}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">คงเหลือ</dt>
                  <dd className="text-sm font-bold text-slate-900">
                    {formatMoneyDisplay(a.balance.toFixed(2))} {a.currency !== 'THB' && a.currency}
                  </dd>
                </div>
              </dl>
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-slate-600">รายการล่าสุด</p>
                {a.recent.length === 0 ? (
                  <p className="text-xs text-slate-400">ยังไม่มีรายการรับ-จ่ายผ่านบัญชีนี้</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-xs">
                    {a.recent.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                        <Link href={`/sales/${SALES_DOC_META[r.kind as SalesDocKind].slug}/${r.id}`} className="font-mono text-[#2453d4] hover:underline">
                          {r.number}
                        </Link>
                        <span className="flex-1 truncate text-slate-600">
                          {formatThaiDate(r.docDate)} · {r.party || '-'}
                        </span>
                        <span className={r.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}>
                          {r.amount < 0 ? '-' : '+'}
                          {formatMoneyDisplay(Math.abs(r.amount).toFixed(2))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400">ยอดคงเหลือ = ยอดยกมา + ใบเสร็จรับเงินและใบสำคัญรับที่ระบุบัญชีนี้ − ใบสำคัญจ่ายที่ระบุบัญชีนี้ (ไม่รวม PV จากใบสั่งซื้อ)</p>
      {editing && <AccountDialog account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountDialog({ account, onClose }: { account: AccountSummary | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({
    bank: account?.bank ?? '',
    accountName: account?.accountName ?? '',
    accountNo: account?.accountNo ?? '',
    branch: account?.branch ?? '',
    type: (account?.type ?? 'SAVINGS') as 'SAVINGS',
    currency: account?.currency ?? 'THB',
    openingBalance: account ? String(account.openingBalance) : '',
    openingDate: account?.openingDate ?? '',
    ownerName: account?.ownerName ?? '',
    isDefaultReceive: account?.isDefaultReceive ?? false,
    isDefaultPay: account?.isDefaultPay ?? false,
    active: account?.active ?? true,
    notes: account?.notes ?? '',
  });
  const set = (patch: Partial<typeof v>) => setV((p) => ({ ...p, ...patch }));
  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveCompanyAccountAction({ ...v, id: account?.id, openingBalance: Number(v.openingBalance || 0), openingDate: v.openingDate || null });
      if (!r.ok) setError(r.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label={account ? 'แก้ไขบัญชีธนาคาร' : 'เพิ่มบัญชีธนาคาร'}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">{account ? 'แก้ไขบัญชีธนาคาร' : 'เพิ่มบัญชีธนาคาร'}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" title="ปิด">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 text-xs sm:grid-cols-2">
          <label className="block font-semibold text-slate-700">
            ธนาคาร <span className="text-red-500">*</span>
            <select value={v.bank} onChange={(e) => set({ bank: e.target.value })} className={field}>
              <option value="">เลือกธนาคาร</option>
              {v.bank && !(THAI_BANKS as readonly string[]).includes(v.bank) && v.bank !== 'เงินสด' && <option>{v.bank}</option>}
              <option value="เงินสด">เงินสด (ไม่ใช่บัญชีธนาคาร)</option>
              {THAI_BANKS.map((b) => (
                <option key={b}>{b}</option>
              ))}
              <option value="อื่น ๆ">อื่น ๆ</option>
            </select>
          </label>
          <label className="block font-semibold text-slate-700">
            ชื่อบัญชี <span className="text-red-500">*</span>
            <input value={v.accountName} onChange={(e) => set({ accountName: e.target.value })} className={field} />
          </label>
          <label className="block font-semibold text-slate-700">
            เลขที่บัญชี <span className="text-red-500">*</span>
            <input value={v.accountNo} onChange={(e) => set({ accountNo: e.target.value })} className={field} />
          </label>
          <label className="block font-semibold text-slate-700">
            สาขา
            <input value={v.branch} onChange={(e) => set({ branch: e.target.value })} className={field} />
          </label>
          <label className="block font-semibold text-slate-700">
            ประเภทบัญชี
            <select value={v.type} onChange={(e) => set({ type: e.target.value as 'SAVINGS' })} className={field}>
              {Object.entries(TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block font-semibold text-slate-700">
            สกุลเงิน
            <select value={v.currency} onChange={(e) => set({ currency: e.target.value })} className={field}>
              {['THB', 'USD', 'EUR', 'JPY', 'CNY'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block font-semibold text-slate-700">
            ยอดยกมา
            <input type="number" step="0.01" value={v.openingBalance} onChange={(e) => set({ openingBalance: e.target.value })} placeholder="0.00" className={field} />
          </label>
          <label className="block font-semibold text-slate-700">
            วันที่เริ่มต้นยอดยกมา
            <DateInput value={v.openingDate} onChange={(e) => set({ openingDate: e.target.value })} className={field} />
          </label>
          <label className="block font-semibold text-slate-700 sm:col-span-2">
            ชื่อบริษัทเจ้าของบัญชี
            <input value={v.ownerName} onChange={(e) => set({ ownerName: e.target.value })} className={field} />
          </label>
          <div className="flex flex-wrap gap-4 font-semibold text-slate-700 sm:col-span-2">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={v.isDefaultReceive} onChange={(e) => set({ isDefaultReceive: e.target.checked })} /> บัญชีสำหรับรับเงินหลัก
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={v.isDefaultPay} onChange={(e) => set({ isDefaultPay: e.target.checked })} /> บัญชีสำหรับจ่ายเงินหลัก
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> สถานะใช้งาน
            </label>
          </div>
          <label className="block font-semibold text-slate-700 sm:col-span-2">
            หมายเหตุ
            <textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className={field} />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 text-sm">
          {error && (
            <p role="alert" className="mr-auto text-xs font-medium text-red-600">
              {error}
            </p>
          )}
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" disabled={pending} onClick={save} className="rounded-md bg-[#2453d4] px-5 py-2 font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
            {pending ? 'กำลังบันทึก...' : 'บันทึกบัญชี'}
          </button>
        </div>
      </div>
    </div>
  );
}
