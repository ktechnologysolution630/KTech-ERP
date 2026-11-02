import Link from 'next/link';
import { getDb } from '@/db/client';
import { type PayMethod } from '@/db/schema';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listActivity } from '@/server/services/activity';
import { listAttachments, listComments } from '@/server/services/attachments';
import { getPv } from '@/server/services/pv';
import { ActivityFeed } from '@/components/activity-feed';
import { ApprovalBar } from '@/components/approval-bar';
import { AttachmentsBox } from '@/components/attachments';
import { CommentBox } from '@/components/comment-box';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/components/money-input';
import {
  addPvCommentAction,
  approvePvAction,
  cancelPvAction,
  markPvPaidAction,
  rejectPvAction,
  submitPvAction,
} from '../actions';

export default async function PvDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const [pv, activities, attachments, comments] = await Promise.all([
    getPv(db, actor, id),
    listActivity(db, 'PV', id),
    listAttachments(db, 'PV', id),
    listComments(db, 'PV', id),
  ]);

  const canApprove = pv.status === 'PENDING_APPROVAL' && can(actor, 'pv.approve');
  const today = bangkokDateString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{pv.number}</h1>
            <DocStatusBadge status={pv.status} />
          </div>
          <p className="text-xs text-slate-600 mt-1">
            ผู้ขาย: {pv.vendorName} · บัญชี: {pv.vendorBankName}{' '}
            {pv.vendorBankAccountNo} ({pv.vendorBankAccountName}) · ผู้จัดทำ:{' '}
            {pv.creatorName} · {formatThaiDate(pv.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/pdf/pv/${pv.id}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            พิมพ์ใบสำคัญจ่าย (PDF)
          </a>
          {pv.whtCertId && (
            <a
              href={`/api/pdf/wht/${pv.whtCertId}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              พิมพ์หนังสือรับรอง 50 ทวิ (PDF)
            </a>
          )}
        </div>
      </div>

      {pv.rejectReason && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          <strong>เหตุผลที่ตีกลับ/ยกเลิก:</strong> {pv.rejectReason}
        </div>
      )}

      {pv.overrideReason && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          <strong>อนุมัติจ่ายเกินยอด PO:</strong> {pv.overrideReason}
        </div>
      )}

      {pv.status === 'PENDING_APPROVAL' && (
        <div className="space-y-2">
          <ApprovalBar
            canApprove={canApprove}
            approverHint="ต้องให้เจ้าของบริษัท (OWNER) เป็นผู้อนุมัติใบสำคัญจ่าย"
            onApprove={async () => {
              'use server';
              await approvePvAction(id);
            }}
            onReject={async (reason) => {
              'use server';
              await rejectPvAction(id, reason);
            }}
          />
          {canApprove && (
            <form
              action={async (fd: FormData) => {
                'use server';
                await approvePvAction(
                  id,
                  String(fd.get('overrideReason') ?? ''),
                );
              }}
              className="flex items-center gap-2 text-xs"
            >
              <input
                type="text"
                name="overrideReason"
                placeholder="กรณีมียอดเกิน PO ระบุเหตุผลที่นี่เพื่ออนุมัติ"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5"
              />
              <button
                type="submit"
                className="rounded-lg bg-amber-600 text-white px-3 py-1.5 font-medium"
              >
                อนุมัติพร้อมเหตุผลเกินวงเงิน
              </button>
            </form>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">รายการ / อ้างอิง</th>
              <th className="px-4 py-3 text-left">PO</th>
              <th className="px-4 py-3 text-left">ใบแจ้งหนี้ / งวด</th>
              <th className="px-4 py-3 text-right">ก่อน VAT</th>
              <th className="px-4 py-3 text-right">VAT</th>
              <th className="px-4 py-3 text-right">ยอดรวม</th>
              <th className="px-4 py-3 text-right">หัก ณ ที่จ่าย</th>
              <th className="px-4 py-3 text-right">จ่ายสุทธิ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pv.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium">{l.payableNote}</td>
                <td className="px-4 py-3 text-xs">
                  {l.poId ? (
                    <Link
                      href={`/po/${l.poId}`}
                      className="text-blue-600 hover:underline"
                    >
                      {l.poNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {l.invoiceNo ?? l.installmentName ?? '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  ฿{formatMoneyDisplay(l.beforeVat)}
                </td>
                <td className="px-4 py-3 text-right">฿{formatMoneyDisplay(l.vat)}</td>
                <td className="px-4 py-3 text-right">
                  ฿{formatMoneyDisplay(l.gross)}
                </td>
                <td className="px-4 py-3 text-right text-amber-700">
                  ฿{formatMoneyDisplay(l.wht)} ({l.whtRate}%)
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  ฿{formatMoneyDisplay(l.net)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold text-xs">
            <tr>
              <td colSpan={3} className="px-4 py-3 text-right">
                รวมทั้งสิ้น
              </td>
              <td className="px-4 py-3 text-right">
                ฿{formatMoneyDisplay(pv.beforeVat)}
              </td>
              <td className="px-4 py-3 text-right">฿{formatMoneyDisplay(pv.vat)}</td>
              <td className="px-4 py-3 text-right">
                ฿{formatMoneyDisplay(pv.gross)}
              </td>
              <td className="px-4 py-3 text-right text-amber-700">
                ฿{formatMoneyDisplay(pv.wht)}
              </td>
              <td className="px-4 py-3 text-right text-base text-emerald-700">
                ฿{formatMoneyDisplay(pv.net)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {pv.status === 'APPROVED' && can(actor, 'pv.pay') && (
        <form
          action={async (fd: FormData) => {
            'use server';
            await markPvPaidAction(id, {
              paidAt: String(fd.get('paidAt') ?? ''),
              payMethod: String(fd.get('payMethod') ?? 'TRANSFER') as PayMethod,
              payFromAccount: String(fd.get('payFromAccount') ?? ''),
              payRef: String(fd.get('payRef') ?? ''),
            });
          }}
          className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-4 text-xs"
        >
          <h3 className="text-sm font-semibold text-emerald-950">
            บันทึกการจ่ายเงิน (โอนแล้ว / จ่ายแล้ว)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                วันที่จ่ายเงิน *
              </label>
              <input
                type="date"
                name="paidAt"
                defaultValue={today}
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                วิธีจ่ายเงิน *
              </label>
              <select
                name="payMethod"
                defaultValue="TRANSFER"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="TRANSFER">โอนเงิน (Transfer)</option>
                <option value="CHEQUE">เช็ค (Cheque)</option>
                <option value="CASH">เงินสด (Cash)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                โอนจากบัญชีบริษัท
              </label>
              <input
                type="text"
                name="payFromAccount"
                placeholder="เช่น KBANK xxx-x-xxxxx-x"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                เลขอ้างอิงสลิป / เลขที่เช็ค
              </label>
              <input
                type="text"
                name="payRef"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </div>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 font-semibold"
          >
            ยืนยันบันทึกจ่ายเงิน ฿{formatMoneyDisplay(pv.net)}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {(pv.status === 'DRAFT' || pv.status === 'REJECTED') &&
          can(actor, 'pv.manage') && (
            <form
              action={async () => {
                'use server';
                await submitPvAction(id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg bg-blue-600 text-white px-4 py-2 text-xs font-medium"
              >
                ส่งขออนุมัติใบสำคัญจ่าย
              </button>
            </form>
          )}

        {pv.status !== 'PAID' &&
          pv.status !== 'CANCELLED' &&
          can(actor, 'pv.manage') && (
            <form
              action={async () => {
                'use server';
                await cancelPvAction(id, 'ยกเลิกโดยฝ่ายการเงิน');
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                ยกเลิก PV (คืนรายการตั้งหนี้)
              </button>
            </form>
          )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AttachmentsBox entityType="PV" entityId={pv.id} items={attachments} />
        <CommentBox
          comments={comments}
          onAddComment={async (body) => {
            'use server';
            await addPvCommentAction(id, body);
          }}
        />
        <ActivityFeed items={activities} />
      </div>
    </div>
  );
}
