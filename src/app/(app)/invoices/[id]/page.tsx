import Link from 'next/link';
import { ActionErrorBanner } from '@/components/action-error-banner';
import { ConfirmSubmitButton } from '@/components/confirm-submit-button';
import { returnOnRefusal } from '@/lib/action-outcome';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { getInvoice } from '@/server/services/invoice';
import { apCreditRoom, listApCreditNotes } from '@/server/services/ap-credit-notes';
import { bangkokDateString } from '@/domain/thai';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/domain/money';
import { can } from '@/server/policy';
import { DeleteDocButton } from '@/components/bulk-delete';
import { deleteApInvoicesAction } from '@/app/(app)/accounting/delete-actions';
import { cancelInvoiceAction, issueApCreditNoteAction, matchInvoiceAction, voidApCreditNoteAction } from '../actions';
import { loadOrNotFound } from '@/app/(app)/or-not-found';

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { id } = await params;
  const { error: actionError } = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const inv = await loadOrNotFound(id, () => getInvoice(db, actor, id));

  const matchedMap = new Map(inv.matches.map((m) => [m.payableId, m.gross]));
  const [creditNotes, creditRoom] = await Promise.all([listApCreditNotes(db, actor, { invoiceId: id }), apCreditRoom(db, id)]);
  const canCredit = inv.status === 'ACTIVE' && Number(creditRoom) > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <ActionErrorBanner message={actionError} clearHref={`/invoices/${id}`} />
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              ใบแจ้งหนี้ {inv.invoiceNo}
            </h1>
            <DocStatusBadge status={inv.status} />
          </div>
          <p className="text-xs text-slate-600 mt-1">
            ผู้ขาย: {inv.vendorName} · PO:{' '}
            <Link href={`/po/${inv.poId}`} className="text-blue-600 hover:underline">
              {inv.poNumber}
            </Link>{' '}
            · วันที่เอกสาร: {inv.invoiceDate}
          </p>
        </div>
        {/* Once cancelled, the owner or admin can remove it for good */}
        {inv.status === 'CANCELLED' && can(actor, 'accounting.delete') && (
          <DeleteDocButton
            action={deleteApInvoicesAction}
            id={inv.id}
            label={`${inv.invoiceNo} · ${inv.vendorName}`}
            noun="ใบแจ้งหนี้"
            hint="ใบแจ้งหนี้ผู้ขายที่ยกเลิกแล้วนี้ และรายการตั้งจ่ายที่ยกเลิกไปพร้อมกัน จะถูกลบออกจากระบบ"
            backTo="/invoices"
          />
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-500">ยอดก่อน VAT</div>
          <div className="font-semibold">฿{formatMoneyDisplay(inv.beforeVat)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">VAT</div>
          <div className="font-semibold">฿{formatMoneyDisplay(inv.vat)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ยอดรวมทั้งสิ้น</div>
          <div className="font-bold text-slate-900">฿{formatMoneyDisplay(inv.gross)}</div>
        </div>
      </div>

      {inv.status === 'ACTIVE' && inv.poPaymentType !== 'CREDIT' && (
        <form
          action={async (fd: FormData) => {
            'use server';
            const matches = inv.poPayables.map((p) => ({
              payableId: p.id,
              gross: String(fd.get(`match_${p.id}`) ?? '0'),
            }));
            await matchInvoiceAction(inv.id, matches);
          }}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            จับคู่ใบกำกับภาษีกับรายการขอเบิก (Payables)
          </h3>
          <div className="space-y-2 text-xs">
            {inv.poPayables.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2"
              >
                <div>
                  <div className="font-medium text-slate-800">{p.note}</div>
                  <div className="text-slate-500">
                    ยอดตั้งหนี้: ฿{formatMoneyDisplay(p.gross)} · สถานะ: {p.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span>ยอดที่จับคู่:</span>
                  <input
                    type="number"
                    step="0.01"
                    name={`match_${p.id}`}
                    defaultValue={matchedMap.get(p.id) ?? p.gross}
                    className="w-32 rounded border border-slate-300 px-2 py-1 text-right"
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 text-white px-4 py-2 text-xs font-medium"
          >
            บันทึกการจับคู่ใบกำกับภาษี
          </button>
        </form>
      )}


      {(creditNotes.length > 0 || canCredit) && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">ใบลดหนี้ / ส่งคืนสินค้า</h3>
            <p className="mt-1 text-xs text-slate-500">
              ผู้ขายลดราคาหรือรับคืนสินค้าตามใบแจ้งหนี้นี้ ระบบจะลงบัญชีกลับรายการ (Dr เจ้าหนี้ / Cr ซื้อ-สินค้า, ภาษีซื้อ) และหักยอดในใบสำคัญจ่ายครั้งถัดไปของผู้ขายรายนี้
              ถ้ามีของคืนออกจากคลัง ให้ทำใบเบิกแบบ &quot;คืนผู้ขาย&quot; ที่เมนูคลังสินค้าด้วย
            </p>
          </div>

          {creditNotes.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-1.5 pr-2 font-medium">เลขที่</th>
                  <th className="py-1.5 pr-2 font-medium">วันที่</th>
                  <th className="py-1.5 pr-2 font-medium">เหตุผล</th>
                  <th className="py-1.5 pr-2 text-right font-medium">ยอดรวม VAT</th>
                  <th className="py-1.5 pr-2 font-medium">สถานะ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {creditNotes.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-2 font-medium text-slate-800">
                      {c.number}
                      {c.vendorDocNo && <span className="block text-[10px] text-slate-400">ของผู้ขาย: {c.vendorDocNo}</span>}
                    </td>
                    <td className="py-1.5 pr-2">{c.docDate}</td>
                    <td className="py-1.5 pr-2">{c.reason}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">฿{formatMoneyDisplay(c.gross)}</td>
                    <td className="py-1.5 pr-2">
                      {c.voided ? (
                        <span className="text-red-600">ยกเลิกแล้ว{c.voidReason ? `: ${c.voidReason}` : ''}</span>
                      ) : c.payableStatus === 'OPEN' ? (
                        <span className="text-amber-700">รอหักในใบสำคัญจ่าย</span>
                      ) : (
                        <span className="text-emerald-700">หักในใบสำคัญจ่ายแล้ว</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      {!c.voided && c.payableStatus === 'OPEN' && (
                        <form
                          action={async () => {
                            'use server';
                            await returnOnRefusal(`/invoices/${id}`, () => voidApCreditNoteAction(id, c.id, 'ยกเลิกโดยฝ่ายการเงิน'));
                          }}
                        >
                          <ConfirmSubmitButton message={`ยืนยันยกเลิกใบลดหนี้ ${c.number}?`} className="text-red-600 hover:underline">
                            ยกเลิก
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canCredit && (
            <form
              action={async (fd: FormData) => {
                'use server';
                await returnOnRefusal(`/invoices/${id}`, () =>
                  issueApCreditNoteAction(id, {
                    docDate: String(fd.get('docDate') ?? '') || undefined,
                    vendorDocNo: String(fd.get('vendorDocNo') ?? ''),
                    reason: String(fd.get('reason') ?? ''),
                    gross: Number(fd.get('gross') ?? 0),
                  }),
                );
              }}
              className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-xs sm:grid-cols-2"
            >
              <label className="block">
                <span className="text-slate-600">วันที่ใบลดหนี้</span>
                <input type="date" name="docDate" defaultValue={bangkokDateString()} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-slate-600">เลขที่ใบลดหนี้ของผู้ขาย</span>
                <input name="vendorDocNo" maxLength={60} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-slate-600">เหตุผล (เช่น ส่งคืนสินค้าชำรุด 5 ถุง, ลดราคา)</span>
                <input name="reason" required maxLength={1000} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-slate-600">ยอดลดหนี้รวม VAT (ลดได้ไม่เกิน ฿{formatMoneyDisplay(creditRoom)})</span>
                <input type="number" name="gross" required min="0.01" max={creditRoom} step="0.01" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-right" />
              </label>
              <div className="flex items-end">
                <ConfirmSubmitButton message="ยืนยันออกใบลดหนี้? ระบบจะลงบัญชีกลับรายการให้ทันที" className="rounded-lg bg-slate-800 px-4 py-2 font-medium text-white">
                  ออกใบลดหนี้
                </ConfirmSubmitButton>
              </div>
            </form>
          )}
        </section>
      )}

      {inv.status === 'ACTIVE' && (
        <form
          action={async () => {
            'use server';
            await returnOnRefusal(`/invoices/${id}`, () => cancelInvoiceAction(inv.id, 'ยกเลิกโดยฝ่ายการเงิน'));
          }}
        >
          <ConfirmSubmitButton
            message="ยืนยันยกเลิกใบแจ้งหนี้นี้? ยกเลิกแล้วย้อนกลับไม่ได้"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            ยกเลิกใบแจ้งหนี้
          </ConfirmSubmitButton>
        </form>
      )}
    </div>
  );
}
