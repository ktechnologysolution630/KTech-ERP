import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listInvoices } from '@/server/services/invoice';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/domain/money';
import { can } from '@/server/policy';
import { BulkDeleteBar, BulkDeleteProvider, SelectAllBox, SelectBox } from '@/components/bulk-delete';
import { deleteApInvoicesAction } from '@/app/(app)/accounting/delete-actions';

export default async function InvoicesPage() {
  const actor = await requireUser();
  const db = await getDb();
  const items = await listInvoices(db, actor);
  // Owner and admin: a cancelled bill can be removed for good
  const canDelete = can(actor, 'accounting.delete');

  const page = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            ใบแจ้งหนี้ / ใบกำกับภาษี (Invoices)
          </h1>
          <p className="text-xs text-slate-600">
            บันทึกใบวางบิลสำหรับ PO เครดิต และจับคู่ใบกำกับภาษีสำหรับ PO จ่ายล่วงหน้า/แบ่งงวด
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && <BulkDeleteBar />}
          <Link
            href="/invoices/new"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-medium"
          >
            + บันทึกใบแจ้งหนี้ / ใบกำกับภาษี
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              {canDelete && (
                <th className="w-8 px-4 py-3">
                  <SelectAllBox items={items.map((inv) => ({ id: inv.id, label: `${inv.invoiceNo} · ${inv.vendorName}` }))} />
                </th>
              )}
              <th className="px-4 py-3 text-left">เลขที่ใบแจ้งหนี้</th>
              <th className="px-4 py-3 text-left">วันที่</th>
              <th className="px-4 py-3 text-left">PO</th>
              <th className="px-4 py-3 text-left">ผู้ขาย</th>
              <th className="px-4 py-3 text-right">ก่อน VAT</th>
              <th className="px-4 py-3 text-right">VAT</th>
              <th className="px-4 py-3 text-right">ยอดรวม</th>
              <th className="px-4 py-3 text-left">ครบกำหนด</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={canDelete ? 10 : 9} className="px-4 py-8 text-center text-slate-500">
                  ยังไม่มีรายการใบแจ้งหนี้
                </td>
              </tr>
            ) : (
              items.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  {canDelete && (
                    <td className="px-4 py-3">
                      <SelectBox id={inv.id} label={`${inv.invoiceNo} · ${inv.vendorName}`} />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {inv.invoiceNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs">{inv.invoiceDate}</td>
                  <td className="px-4 py-3 text-xs">
                    <Link
                      href={`/po/${inv.poId}`}
                      className="text-slate-700 hover:underline"
                    >
                      {inv.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{inv.vendorName}</td>
                  <td className="px-4 py-3 text-right">
                    ฿{formatMoneyDisplay(inv.beforeVat)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    ฿{formatMoneyDisplay(inv.vat)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    ฿{formatMoneyDisplay(inv.gross)}
                  </td>
                  <td className="px-4 py-3 text-xs">{inv.dueDate ?? '-'}</td>
                  <td className="px-4 py-3">
                    <DocStatusBadge status={inv.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (!canDelete) return page;
  return (
    <BulkDeleteProvider
      action={deleteApInvoicesAction}
      noun="ใบแจ้งหนี้ผู้ขาย"
      hint="ลบได้เฉพาะใบที่ยกเลิกแล้ว รายการตั้งจ่ายที่เกิดจากใบนั้น (ยกเลิกไปพร้อมกันแล้ว) จะถูกลบด้วย ใบที่เคยอยู่ในใบสำคัญจ่ายต้องลบใบสำคัญจ่ายนั้นก่อน"
    >
      {page}
    </BulkDeleteProvider>
  );
}
