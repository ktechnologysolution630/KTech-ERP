import Link from 'next/link';
import { ActionErrorBanner } from '@/components/action-error-banner';
import { ConfirmSubmitButton } from '@/components/confirm-submit-button';
import { messageOnRefusal, returnOnRefusal } from '@/lib/action-outcome';
import { getDb } from '@/db/client';
import { formatThaiDate } from '@/domain/thai';
import { formatMoneyDisplay } from '@/domain/money';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listActivity } from '@/server/services/activity';
import { listAttachments, listComments } from '@/server/services/attachments';
import { VAT_MODE_LABEL } from '@/components/doc-paper';
import { getPr, projectIdsWithPm } from '@/server/services/pr';
import { LINE_KIND_LABEL, PR_TYPE_META } from '@/domain/pr-type';
import { formatQty } from '@/domain/pr-outstanding';
import { ActivityFeed } from '@/components/activity-feed';
import { ApprovalBar } from '@/components/approval-bar';
import { AttachmentsBox } from '@/components/attachments';
import { SignedRow } from '@/components/signed-row';
import { prPdfSigners } from '@/server/services/doc-signers';
import { getFormTemplates } from '@/server/services/form-templates';
import { labelSigners, prFormKind } from '@/domain/form-templates';
import { CommentBox } from '@/components/comment-box';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { canEditPr } from '../edit-rule';
import { loadOrNotFound } from '@/app/(app)/or-not-found';
import {
  addPrCommentAction,
  approvePrAction,
  cancelPrAction,
  closePrAction,
  rejectPrAction,
  submitPrAction,
} from '../actions';

export default async function PrDetailPage({
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
  const [pr, activities, attachments, comments] = await Promise.all([
    loadOrNotFound(id, () => getPr(db, actor, id)),
    listActivity(db, 'PR', id),
    listAttachments(db, 'PR', id),
    listComments(db, 'PR', id),
  ]);

  // The goods form shows no prices, also on PRs written before the forms existed
  const showPrices = PR_TYPE_META[pr.prType].priced;
  const goods = pr.prType === 'GOODS';
  // PRs written while the date sat in the header carry it there
  const neededOf = (l: { neededDate: string | null }) => {
    const d = l.neededDate ?? pr.needBy;
    return d ? formatThaiDate(d) : '-';
  };
  const lineAmount = (l: { qty: string; estUnitPrice: string | null; discount: string }) => Number(l.qty) * Number(l.estUnitPrice ?? 0) - Number(l.discount);

  const [boxes, forms] = await Promise.all([prPdfSigners(db, pr), getFormTemplates(db)]);
  const signers = labelSigners(boxes, forms.texts[prFormKind(pr.prType)].signatureLabels);

  const projectHasPm = pr.status === 'SUBMITTED' ? (await projectIdsWithPm(db, [pr.projectId])).has(pr.projectId) : true;
  const canApprove =
    (pr.status === 'SUBMITTED' && can(actor, 'pr.approve', { projectId: pr.projectId, projectHasPm })) ||
    (pr.status === 'OWNER_REVIEW' && can(actor, 'pr.approveOverBoq', { projectId: pr.projectId }));
  // Over the BOQ (or outside it): the owner approves after the PM
  const { boqCheck } = pr;
  const showBoqCheck =
    boqCheck.needsOwner &&
    (pr.status === 'SUBMITTED' || pr.status === 'OWNER_REVIEW' || ((pr.status === 'APPROVED' || pr.status === 'CLOSED') && !!pr.pmApprovedBy));
  const boqHeading =
    pr.status === 'SUBMITTED'
      ? 'ใบนี้ขอเกิน BOQ: เมื่อ PM อนุมัติแล้ว จะส่งต่อให้เจ้าของอนุมัติอีกขั้น'
      : pr.status === 'OWNER_REVIEW'
      ? 'PM อนุมัติแล้ว รอเจ้าของอนุมัติ เพราะขอเกิน BOQ'
      : 'เจ้าของอนุมัติให้ซื้อเกิน BOQ แล้ว';
  const canEdit = canEditPr(actor, pr);

  return (
    <div className="space-y-6">
      <ActionErrorBanner message={actionError} clearHref={`/pr/${id}`} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{pr.number}</h1>
            <DocStatusBadge status={pr.status} />
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-[#2453d4]">{PR_TYPE_META[pr.prType].label}</span>
            {pr.status === 'APPROVED' && (
              <DocStatusBadge
                status={pr.orderProgress}
                customLabel={
                  pr.orderProgress === 'FULL'
                    ? 'สั่งครบแล้ว'
                    : pr.orderProgress === 'PARTIAL'
                    ? 'สั่งบางส่วน'
                    : 'ยังไม่สั่ง'
                }
              />
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1">
            โครงการ: {pr.projectCode} - {pr.projectName} · ผู้ขอซื้อ: {pr.requesterName} ·{' '}
            {formatThaiDate(pr.createdAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/pdf/pr/${pr.id}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            พิมพ์ PDF
          </a>
          {canEdit && (
            <Link
              href={`/pr/${pr.id}/edit`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              แก้ไข
            </Link>
          )}
          {pr.status === 'APPROVED' && can(actor, 'po.manage') && (
            <Link
              href={`/po/new?projectId=${pr.projectId}&prId=${pr.id}`}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-xs font-medium"
            >
              + เปิด PO จากใบขอซื้อนี้
            </Link>
          )}
        </div>
      </div>

      {pr.rejectReason && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          <strong>เหตุผลที่ตีกลับ:</strong> {pr.rejectReason}
        </div>
      )}

      {showBoqCheck && (
        <div role="status" className="rounded-xl border border-orange-300 bg-orange-50 p-4 text-xs text-orange-900">
          <p className="font-semibold">{boqHeading}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {boqCheck.over.map((o) => (
              <li key={o.boqLineId}>
                {[o.boqNo, o.description].filter(Boolean).join(' ')}: ใบนี้ขอ {formatQty(Number(o.thisPr))} · BOQ{' '}
                {formatQty(Number(o.boqQty))} · PR อื่นที่อนุมัติแล้ว {formatQty(Number(o.requestedElsewhere))} ·{' '}
                <strong>
                  เกิน {formatQty(Number(o.over))} {o.unit}
                </strong>
              </li>
            ))}
            {boqCheck.outside.map((o, i) => (
              <li key={`outside-${i}`}>
                นอก BOQ: {o.description} {formatQty(Number(o.qty))} {o.unit}
              </li>
            ))}
          </ul>
          {pr.pmApprovedByName && pr.pmApprovedAt && (
            <p className="mt-2 text-orange-800">
              PM อนุมัติแล้ว: {pr.pmApprovedByName} · {formatThaiDate(pr.pmApprovedAt)}
            </p>
          )}
        </div>
      )}

      {(pr.status === 'SUBMITTED' || pr.status === 'OWNER_REVIEW') && (
        <ApprovalBar
          canApprove={canApprove}
          approverHint={
            pr.status === 'OWNER_REVIEW'
              ? 'PM อนุมัติแล้ว ใบนี้ขอเกิน BOQ จึงต้องให้เจ้าของบริษัทอนุมัติ'
              : projectHasPm
              ? 'ต้องอนุมัติโดย PM ของโครงการนี้ก่อน ถ้าขอเกิน BOQ จึงส่งต่อให้เจ้าของบริษัท'
              : 'โครงการนี้ไม่มี PM เจ้าของบริษัทอนุมัติแทน'
          }
          onApprove={async () => {
            'use server';
            return messageOnRefusal(() => approvePrAction(id));
          }}
          onReject={async (reason) => {
            'use server';
            return messageOnRefusal(() => rejectPrAction(id, reason));
          }}
        />
      )}

      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-4">
          {[
            ['วันที่เอกสาร', pr.docDate ? formatThaiDate(pr.docDate) : formatThaiDate(pr.createdAt)],
            // The goods form shows the date on each line
            ...(goods ? [] : [[pr.prType === 'LABOR' ? 'กำหนดเริ่มงาน' : 'กำหนดรับของ/เริ่มงาน', pr.needBy ? formatThaiDate(pr.needBy) : '-']]),
            ...(pr.prType === 'GOODS' ? [] : [['กำหนดแล้วเสร็จ', pr.workEnd ? formatThaiDate(pr.workEnd) : '-']]),
            [pr.prType === 'LABOR' ? 'ช่าง / ผู้รับเหมา' : 'ซัพพลายเออร์อ้างอิง', pr.vendorName ?? '-'],
            ['แผนก / ฝ่าย', pr.department || '-'],
            ['ผู้ขอซื้อ', pr.requesterText || pr.requesterName],
            [pr.prType === 'LABOR' ? 'สถานที่ทำงาน' : 'สถานที่จัดส่ง', pr.deliveryPlace || '-'],
            ...(showPrices
              ? [
                  ['เงื่อนไขการชำระเงิน', pr.paymentTerms || '-'],
                  ['รูปแบบ VAT', VAT_MODE_LABEL[pr.vatMode]],
                ]
              : []),
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                {goods && (
                  <>
                    <th className="px-4 py-3 text-left">หมวด</th>
                    <th className="px-4 py-3 text-left">กลุ่ม</th>
                  </>
                )}
                <th className="px-4 py-3 text-left">รายการ</th>
                {pr.prType === 'GOODS_AND_LABOR' && <th className="px-4 py-3 text-left">ประเภท</th>}
                {!goods && <th className="px-4 py-3 text-left">หมวดหมู่</th>}
                <th className="px-4 py-3 text-right">จำนวนขอซื้อ</th>
                {goods && <th className="px-4 py-3 text-left">หน่วย</th>}
                {goods && <th className="px-4 py-3 text-left">กำหนดใช้/รับของ</th>}
                <th className="px-4 py-3 text-right">สั่งซื้อแล้ว</th>
                <th className="px-4 py-3 text-right">คงเหลือสั่ง</th>
                {!goods && <th className="px-4 py-3 text-left">หน่วย</th>}
                {showPrices && (
                  <>
                    <th className="px-4 py-3 text-right">ราคาต่อหน่วย</th>
                    <th className="px-4 py-3 text-right">ส่วนลด</th>
                    <th className="px-4 py-3 text-right">จำนวนเงิน</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pr.lines.map((l) => (
                <tr key={l.id}>
                  {goods && (
                    <>
                      <td className="px-4 py-3 text-xs text-slate-600">{l.category ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{l.itemGroup ?? '-'}</td>
                    </>
                  )}
                  <td className="px-4 py-3 font-medium">
                    {l.description}
                    {l.detail && <span className="block text-xs font-normal text-slate-500">{l.detail}</span>}
                    {l.lineKind === 'GOODS' && (l.boq || l.outsideBoq) && (
                      <span className={`block text-[11px] font-normal ${l.boq ? 'text-blue-700' : 'text-orange-700'}`}>
                        {l.boq ? `BOQ: ${[l.boq.no, l.boq.description].filter(Boolean).join(' ')}` : 'นอก BOQ'}
                      </span>
                    )}
                  </td>
                  {pr.prType === 'GOODS_AND_LABOR' && <td className="px-4 py-3 text-xs">{LINE_KIND_LABEL[l.lineKind]}</td>}
                  {!goods && (
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {l.category ?? '-'}
                      {l.itemGroup && <span className="block text-slate-500">{l.itemGroup}</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">{Number(l.qty)}</td>
                  {goods && <td className="px-4 py-3">{l.unitName}</td>}
                  {goods && <td className="whitespace-nowrap px-4 py-3">{neededOf(l)}</td>}
                  <td className="px-4 py-3 text-right text-blue-700">
                    {l.orderedQty.toNumber()}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {l.remainingQty.toNumber()}
                  </td>
                  {!goods && <td className="px-4 py-3">{l.unitName}</td>}
                  {showPrices && (
                    <>
                      <td className="px-4 py-3 text-right">{l.estUnitPrice ? formatMoneyDisplay(l.estUnitPrice) : '-'}</td>
                      <td className="px-4 py-3 text-right">{Number(l.discount) ? formatMoneyDisplay(l.discount) : '-'}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatMoneyDisplay(lineAmount(l).toFixed(2))}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {showPrices && (
              <tfoot className="bg-slate-50 text-sm font-semibold">
                <tr>
                  <td colSpan={pr.prType === 'GOODS_AND_LABOR' ? 9 : 8} className="px-4 py-2.5 text-right">
                    รวมก่อนส่วนลดท้ายบิลและ VAT
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatMoneyDisplay(pr.lines.reduce((s, l) => s + lineAmount(l), 0).toFixed(2))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 print:break-inside-avoid">
        <h2 className="text-xs font-semibold text-slate-600">การลงนาม</h2>
        <SignedRow signers={signers} className="pt-3" />
      </section>

      <div className="flex flex-wrap gap-2">
        {/* A PR sent back can go again as it is, or after แก้ไข */}
        {(pr.status === 'DRAFT' || (pr.status === 'REJECTED' && canEdit)) && (
          <form
            action={async () => {
              'use server';
              await returnOnRefusal(`/pr/${id}`, () => submitPrAction(id));
            }}
          >
            <button
              type="submit"
              className="rounded-lg bg-blue-600 text-white px-4 py-2 text-xs font-medium"
            >
              {pr.status === 'REJECTED' ? 'ส่งขออนุมัติอีกครั้ง' : 'ส่งขออนุมัติ'}
            </button>
          </form>
        )}
        {pr.status === 'APPROVED' && (
          <form
            action={async () => {
              'use server';
              await returnOnRefusal(`/pr/${id}`, () => closePrAction(id));
            }}
          >
            <ConfirmSubmitButton
              message="ยืนยันปิดใบขอซื้อนี้?"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
            >
              ปิดใบขอซื้อ
            </ConfirmSubmitButton>
          </form>
        )}
        {pr.status !== 'CANCELLED' && pr.status !== 'CLOSED' && (
          <form
            action={async () => {
              'use server';
              await returnOnRefusal(`/pr/${id}`, () => cancelPrAction(id));
            }}
          >
            <ConfirmSubmitButton
              message="ยืนยันยกเลิกใบขอซื้อนี้? ยกเลิกแล้วย้อนกลับไม่ได้"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              ยกเลิกใบขอซื้อ
            </ConfirmSubmitButton>
          </form>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AttachmentsBox entityType="PR" entityId={pr.id} items={attachments} />
        <CommentBox
          comments={comments}
          onAddComment={async (body) => {
            'use server';
            return messageOnRefusal(() => addPrCommentAction(id, body));
          }}
        />
        <ActivityFeed items={activities} />
      </div>
    </div>
  );
}
