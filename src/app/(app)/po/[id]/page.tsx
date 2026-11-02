import Link from 'next/link';
import { getDb } from '@/db/client';
import { computeDocTotals, D } from '@/domain/money';
import { requiredPoApprover } from '@/domain/po-approval';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listActivity } from '@/server/services/activity';
import { listAttachments, listComments } from '@/server/services/attachments';
import { getPo, type SerializedPoRevisionPayload } from '@/server/services/po';
import { getCloseShortRequestsForPo } from '@/server/services/close-short';
import { getPoSummary } from '@/server/services/invoice';
import { listPoReceipts } from '@/server/services/receipt';
import { getSettings } from '@/server/services/settings';
import { ActivityFeed } from '@/components/activity-feed';
import { ApprovalBar } from '@/components/approval-bar';
import { AttachmentsBox } from '@/components/attachments';
import { CommentBox } from '@/components/comment-box';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/components/money-input';
import { PoSummaryCard } from '@/components/po-summary-card';
import {
  addPoCommentAction,
  approveCloseShortAction,
  approvePoAction,
  cancelPoAction,
  markOrderedAction,
  rejectCloseShortAction,
  rejectPoAction,
  requestCloseShortAction,
  submitPoAction,
} from '../actions';
import {
  requestInstallmentAction,
  requestPrepaidAction,
} from '@/app/(app)/invoices/actions';

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const [po, settings, activities, attachments, comments, receipts, closeShortReqs, summary] =
    await Promise.all([
      getPo(db, actor, id),
      getSettings(db),
      listActivity(db, 'PO', id),
      listAttachments(db, 'PO', id),
      listComments(db, 'PO', id),
      listPoReceipts(db, id),
      getCloseShortRequestsForPo(db, id),
      getPoSummary(db, id),
    ]);
  const pendingCloseShort = closeShortReqs.find((r) => r.request.status === 'PENDING');
  const hasSomeReceipt = receipts.length > 0;
  const hasRemainingQty = po.lines.some((l) => l.remainingQty.gt(0));

  const limitDec = D(settings.poApprovalLimit);
  const pendingPayload = po.pendingRevision as SerializedPoRevisionPayload | null;
  const targetGross = pendingPayload
    ? computeDocTotals({
        vatMode: pendingPayload.vatMode,
        billDiscount: D(pendingPayload.billDiscount || 0),
        shipping: D(pendingPayload.shipping || 0),
        lines: pendingPayload.lines.map((l) => ({
          qty: D(l.qty),
          unitPrice: D(l.unitPrice),
          discount: D(l.discount),
        })),
      }).gross
    : D(po.gross);

  const approverRole = requiredPoApprover(targetGross, limitDec);
  const isWaitingApproval =
    po.status === 'PENDING_APPROVAL' || Boolean(pendingPayload?.submittedForApproval);
  const canApprove =
    isWaitingApproval &&
    can(actor, 'po.approve', {
      gross: targetGross,
      poApprovalLimit: limitDec,
      createdBy: po.createdBy,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{po.number}</h1>
            <DocStatusBadge status={po.status} />
            {po.closedShort && (
              <DocStatusBadge status="CLOSED" customLabel="ปิดยอดค้างรับแล้ว" />
            )}
            {pendingPayload && (
              <DocStatusBadge
                status="PENDING_APPROVAL"
                customLabel={`มีฉบับแก้ไขครั้งที่ ${po.currentRevision}`}
              />
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1">
            โครงการ: {po.projectCode} - {po.projectName} · ผู้ขาย: {po.vendorName} · ผู้เปิด:{' '}
            {po.creatorName} · {formatThaiDate(po.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/pdf/po/${po.id}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            พิมพ์ PDF
          </a>
          {can(actor, 'po.manage') &&
            po.status !== 'CANCELLED' &&
            po.status !== 'COMPLETED' && (
              <Link
                href={`/po/${po.id}/edit`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                แก้ไข PO
              </Link>
            )}
          {(po.status === 'APPROVED' || po.status === 'ORDERED') &&
            can(actor, 'receipt.create', { projectId: po.projectId }) && (
              <Link
                href={`/receive/${po.id}`}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-xs font-medium"
              >
                รับของตาม PO นี้
              </Link>
            )}
        </div>
      </div>

      {po.rejectReason && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          <strong>เหตุผลที่ตีกลับ:</strong> {po.rejectReason}
        </div>
      )}

      {isWaitingApproval && (
        <ApprovalBar
          canApprove={canApprove}
          approverHint={
            approverRole === 'PURCHASING_HEAD'
              ? `ยอดต่ำกว่า ฿${formatMoneyDisplay(settings.poApprovalLimit)}: หัวหน้าจัดซื้อหรือเจ้าของอนุมัติได้ (ผู้เปิดอนุมัติเองไม่ได้)`
              : `ยอดตั้งแต่ ฿${formatMoneyDisplay(settings.poApprovalLimit)} ขึ้นไป: ต้องให้เจ้าของอนุมัติเท่านั้น`
          }
          onApprove={async () => {
            'use server';
            await approvePoAction(id);
          }}
          onReject={async (reason) => {
            'use server';
            await rejectPoAction(id, reason);
          }}
        />
      )}

      {pendingPayload && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <strong className="text-amber-900">
              ฉบับแก้ไขครั้งที่ {po.currentRevision} ({pendingPayload.reason})
            </strong>
            <span>ยอดใหม่: ฿{formatMoneyDisplay(targetGross.toFixed(2))}</span>
          </div>
          <ul className="list-disc pl-5 text-amber-800">
            {pendingPayload.lines.map((nl, idx) => (
              <li key={idx}>
                {nl.description}: จำนวน {Number(nl.qty)} {nl.unitName} × ฿
                {formatMoneyDisplay(nl.unitPrice)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <PoSummaryCard summary={summary} />

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">รายการ</th>
              <th className="px-4 py-3 text-right">จำนวนสั่ง</th>
              <th className="px-4 py-3 text-right">รับแล้ว</th>
              <th className="px-4 py-3 text-right">ค้างรับ</th>
              <th className="px-4 py-3 text-left">หน่วย</th>
              <th className="px-4 py-3 text-right">ราคา/หน่วย</th>
              <th className="px-4 py-3 text-right">ส่วนลด</th>
              <th className="px-4 py-3 text-right">รวม (รวม VAT)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {po.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium">{l.description}</td>
                <td className="px-4 py-3 text-right">{Number(l.qty)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">
                  {l.receivedQty.toNumber()}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {l.remainingQty.toNumber()}
                </td>
                <td className="px-4 py-3">{l.unitName}</td>
                <td className="px-4 py-3 text-right">฿{formatMoneyDisplay(l.unitPrice)}</td>
                <td className="px-4 py-3 text-right">฿{formatMoneyDisplay(l.discount)}</td>
                <td className="px-4 py-3 text-right font-medium">
                  ฿{formatMoneyDisplay(l.gross)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipts.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">ประวัติการรับของ</h3>
          <div className="divide-y divide-slate-100 text-xs">
            {receipts.map((r) => (
              <div key={r.id} className="py-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    ใบส่งของ: {r.deliveryNoteNo || '-'}
                  </span>
                  <span className="text-slate-600">
                    รับเมื่อ {r.receivedAt} · โดย {r.receiverName}
                  </span>
                </div>
                <ul className="list-disc pl-5 text-slate-700">
                  {r.lines.map((rl) => (
                    <li key={rl.id}>
                      {rl.description}: รับ {Number(rl.qty)} {rl.unitName}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {po.installments.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">ตารางงวดการจ่ายเงิน</h3>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">งวด</th>
                <th className="px-3 py-2 text-left">เงื่อนไข</th>
                <th className="px-3 py-2 text-right">สัดส่วน</th>
                <th className="px-3 py-2 text-right">จำนวนเงิน</th>
                <th className="px-3 py-2 text-left">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {po.installments.map((inst) => (
                <tr key={inst.id}>
                  <td className="px-3 py-2 font-medium">{inst.name}</td>
                  <td className="px-3 py-2">{inst.condition}</td>
                  <td className="px-3 py-2 text-right">{inst.percent ? `${inst.percent}%` : '-'}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    ฿{formatMoneyDisplay(inst.amount)}
                  </td>
                  <td className="px-3 py-2 flex items-center gap-2">
                    <DocStatusBadge status={inst.status} />
                    {inst.status === 'PENDING' &&
                      (po.status === 'APPROVED' || po.status === 'ORDERED') &&
                      can(actor, 'payable.request') && (
                        <form
                          action={async () => {
                            'use server';
                            await requestInstallmentAction(po.id, inst.id);
                          }}
                        >
                          <button
                            type="submit"
                            className="rounded bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 text-[11px] font-medium"
                          >
                            ขอเบิกงวดนี้
                          </button>
                        </form>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingCloseShort && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 text-xs">
          <div>
            <strong className="text-amber-900">
              มีคำขอปิดยอดค้างรับ (โดย {pendingCloseShort.requesterName}):
            </strong>{' '}
            {pendingCloseShort.request.reason}
          </div>
          {can(actor, 'closeShort.approve') && (
            <div className="flex items-center gap-2">
              <form
                action={async () => {
                  'use server';
                  await approveCloseShortAction(po.id, pendingCloseShort.request.id);
                }}
              >
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 font-medium"
                >
                  อนุมัติปิดยอดค้างรับ
                </button>
              </form>
              <form
                action={async () => {
                  'use server';
                  await rejectCloseShortAction(
                    po.id,
                    pendingCloseShort.request.id,
                    'ไม่อนุมัติปิดยอด ให้ตามของต่อ',
                  );
                }}
              >
                <button
                  type="submit"
                  className="rounded-lg border border-red-200 bg-white text-red-700 px-3 py-1.5 font-medium"
                >
                  ไม่อนุมัติ
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {po.status === 'ORDERED' &&
        !po.closedShort &&
        !pendingCloseShort &&
        hasSomeReceipt &&
        hasRemainingQty &&
        can(actor, 'po.manage') && (
          <form
            action={async (fd: FormData) => {
              'use server';
              await requestCloseShortAction(
                po.id,
                String(fd.get('closeShortReason') ?? ''),
              );
            }}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs"
          >
            <span className="font-medium text-slate-700">ขอปิดยอดค้างรับ:</span>
            <input
              type="text"
              name="closeShortReason"
              required
              placeholder="ระบุเหตุผล เช่น ร้านค้าส่งของได้ไม่ครบและขอยกเลิกส่วนที่เหลือ"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5"
            />
            <button
              type="submit"
              className="rounded-lg bg-slate-800 text-white px-3 py-1.5 font-medium"
            >
              ส่งคำขอปิดยอดค้างรับ
            </button>
          </form>
        )}

      <div className="flex flex-wrap gap-2">
        {(po.status === 'DRAFT' ||
          po.status === 'REJECTED' ||
          (pendingPayload && !pendingPayload.submittedForApproval)) &&
          can(actor, 'po.manage') && (
            <form
              action={async () => {
                'use server';
                await submitPoAction(id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg bg-blue-600 text-white px-4 py-2 text-xs font-medium"
              >
                ส่งขออนุมัติ PO
              </button>
            </form>
          )}

        {po.paymentType === 'PREPAID' &&
          (po.status === 'APPROVED' || po.status === 'ORDERED') &&
          can(actor, 'payable.request') && (
            <form
              action={async () => {
                'use server';
                await requestPrepaidAction(id);
              }}
            >
              <button
                type="submit"
                className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-xs font-medium"
              >
                ขอเบิกเงินล่วงหน้า (Prepaid)
              </button>
            </form>
          )}

        {(po.status === 'APPROVED' || po.status === 'ORDERED') &&
          can(actor, 'invoice.manage') && (
            <Link
              href={`/invoices/new?poId=${po.id}`}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 text-xs font-medium"
            >
              + บันทึกใบแจ้งหนี้ / ใบกำกับภาษี
            </Link>
          )}

        {po.status === 'APPROVED' && can(actor, 'po.manage') && (
          <form
            action={async () => {
              'use server';
              await markOrderedAction(id);
            }}
          >
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-xs font-medium"
            >
              บันทึกว่าสั่งของกับร้านแล้ว
            </button>
          </form>
        )}

        {po.status !== 'CANCELLED' &&
          po.status !== 'COMPLETED' &&
          can(actor, 'po.manage') && (
            <form
              action={async () => {
                'use server';
                await cancelPoAction(id, 'ยกเลิกโดยฝ่ายจัดซื้อ');
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                ยกเลิก PO
              </button>
            </form>
          )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AttachmentsBox entityType="PO" entityId={po.id} items={attachments} />
        <CommentBox
          comments={comments}
          onAddComment={async (body) => {
            'use server';
            await addPoCommentAction(id, body);
          }}
        />
        <ActivityFeed items={activities} />
      </div>
    </div>
  );
}
