import Link from 'next/link';
import { getDb } from '@/db/client';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { formatMoneyDisplay } from '@/domain/money';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listActivity } from '@/server/services/activity';
import { listAttachments, listComments } from '@/server/services/attachments';
import { listItems, listProjects, listVendors } from '@/server/services/master';
import { getSettings } from '@/server/services/settings';
import { companyHeaderFrom, vendorRefsFrom } from '@/components/doc-paper-data';
import { VAT_MODE_LABEL } from '@/components/doc-paper';
import { getPr } from '@/server/services/pr';
import { ActivityFeed } from '@/components/activity-feed';
import { ApprovalBar } from '@/components/approval-bar';
import { AttachmentsBox } from '@/components/attachments';
import { CommentBox } from '@/components/comment-box';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { PrForm } from '@/components/pr-form';
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const [pr, activities, attachments, comments, projects, items, vendors, settings] = await Promise.all([
    getPr(db, actor, id),
    listActivity(db, 'PR', id),
    listAttachments(db, 'PR', id),
    listComments(db, 'PR', id),
    listProjects(db, actor),
    listItems(db),
    listVendors(db),
    getSettings(db),
  ]);

  const canApprove =
    pr.status === 'SUBMITTED' && can(actor, 'pr.approve', { projectId: pr.projectId });
  const canEdit =
    (pr.status === 'DRAFT' || pr.status === 'REJECTED') &&
    (pr.requestedBy === actor.id || actor.roles.includes('OWNER') || actor.roles.includes('ADMIN'));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{pr.number}</h1>
            <DocStatusBadge status={pr.status} />
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

      {pr.status === 'SUBMITTED' && (
        <ApprovalBar
          canApprove={canApprove}
          approverHint="ต้องอนุมัติโดย PM ของโครงการนี้ หรือเจ้าของบริษัท"
          onApprove={async () => {
            'use server';
            await approvePrAction(id);
          }}
          onReject={async (reason) => {
            'use server';
            await rejectPrAction(id, reason);
          }}
        />
      )}

      {canEdit ? (
        <PrForm
          projects={projects}
          items={items}
          vendors={vendorRefsFrom(vendors)}
          company={companyHeaderFrom(settings)}
          currentUserName={pr.requesterName}
          today={bangkokDateString()}
          existing={{
            id: pr.id,
            number: pr.number,
            projectId: pr.projectId,
            note: pr.note,
            docDate: pr.docDate,
            needBy: pr.needBy,
            vendorId: pr.vendorId,
            department: pr.department,
            requesterText: pr.requesterText,
            deliveryPlace: pr.deliveryPlace,
            paymentTerms: pr.paymentTerms,
            vatMode: pr.vatMode,
            billDiscount: pr.billDiscount,
            lines: pr.lines,
          }}
        />
      ) : (
        <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-4">
          {[
            ['วันที่เอกสาร', pr.docDate ? formatThaiDate(pr.docDate) : formatThaiDate(pr.createdAt)],
            ['กำหนดใช้/รับของ', pr.needBy ? formatThaiDate(pr.needBy) : '-'],
            ['ซัพพลายเออร์อ้างอิง', pr.vendorName ?? '-'],
            ['แผนก / ฝ่าย', pr.department || '-'],
            ['ผู้ขอซื้อ', pr.requesterText || pr.requesterName],
            ['สถานที่จัดส่ง', pr.deliveryPlace || '-'],
            ['เงื่อนไขการชำระเงิน', pr.paymentTerms || '-'],
            ['รูปแบบ VAT', VAT_MODE_LABEL[pr.vatMode]],
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
                <th className="px-4 py-3 text-left">รายการ</th>
                <th className="px-4 py-3 text-left">หมวดหมู่</th>
                <th className="px-4 py-3 text-right">จำนวนขอซื้อ</th>
                <th className="px-4 py-3 text-right">สั่งซื้อแล้ว</th>
                <th className="px-4 py-3 text-right">คงเหลือสั่ง</th>
                <th className="px-4 py-3 text-left">หน่วย</th>
                <th className="px-4 py-3 text-right">ราคาต่อหน่วย</th>
                <th className="px-4 py-3 text-right">ส่วนลด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pr.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3 font-medium">
                    {l.description}
                    {l.detail && <span className="block text-xs font-normal text-slate-500">{l.detail}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{l.category ?? '-'}</td>
                  <td className="px-4 py-3 text-right">{Number(l.qty)}</td>
                  <td className="px-4 py-3 text-right text-blue-700">
                    {l.orderedQty.toNumber()}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {l.remainingQty.toNumber()}
                  </td>
                  <td className="px-4 py-3">{l.unitName}</td>
                  <td className="px-4 py-3 text-right">{l.estUnitPrice ? formatMoneyDisplay(l.estUnitPrice) : '-'}</td>
                  <td className="px-4 py-3 text-right">{Number(l.discount) ? formatMoneyDisplay(l.discount) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {pr.status === 'DRAFT' && (
          <form
            action={async () => {
              'use server';
              await submitPrAction(id);
            }}
          >
            <button
              type="submit"
              className="rounded-lg bg-blue-600 text-white px-4 py-2 text-xs font-medium"
            >
              ส่งขออนุมัติ
            </button>
          </form>
        )}
        {pr.status === 'APPROVED' && (
          <form
            action={async () => {
              'use server';
              await closePrAction(id);
            }}
          >
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
            >
              ปิดใบขอซื้อ
            </button>
          </form>
        )}
        {pr.status !== 'CANCELLED' && pr.status !== 'CLOSED' && (
          <form
            action={async () => {
              'use server';
              await cancelPrAction(id);
            }}
          >
            <button
              type="submit"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              ยกเลิกใบขอซื้อ
            </button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AttachmentsBox entityType="PR" entityId={pr.id} items={attachments} />
        <CommentBox
          comments={comments}
          onAddComment={async (body) => {
            'use server';
            await addPrCommentAction(id, body);
          }}
        />
        <ActivityFeed items={activities} />
      </div>
    </div>
  );
}
