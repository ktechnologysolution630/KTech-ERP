import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listOpenPayables } from '@/server/services/payable';
import { getPv } from '@/server/services/pv';
import { updatePvAction } from '../../actions';
import { PvPayablesTable, readPvPayables, type PvPayableRow } from '../../pv-payables-table';

export default async function EditPvPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireUser();
  const db = await getDb();
  const pv = await getPv(db, actor, id);

  const back = (
    <Link href={`/pv/${pv.id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
      <ArrowLeft className="h-4 w-4" /> กลับไปหน้า {pv.number}
    </Link>
  );

  const editable = pv.status === 'DRAFT' || pv.status === 'REJECTED';
  if (!editable || !can(actor, 'pv.manage')) {
    return (
      <div className="max-w-3xl space-y-4">
        {back}
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          {editable ? 'แก้ไขใบสำคัญจ่ายได้เฉพาะฝ่ายการเงิน เจ้าของ หรือผู้ดูแลระบบ' : 'แก้ไขใบสำคัญจ่ายได้เฉพาะใบร่างหรือใบที่ถูกตีกลับ'}
        </div>
      </div>
    );
  }

  // The bills on this voucher first, then the vendor's other open bills that can be added
  const open = await listOpenPayables(db, actor, { vendorId: pv.vendorId });
  const onVoucher = new Set(pv.lines.map((l) => l.payableId));
  const rows: PvPayableRow[] = [
    ...pv.lines.map((l) => ({
      id: l.payableId,
      note: l.payableNote,
      poNumber: l.poNumber,
      invoiceNo: l.invoiceNo,
      dueDate: l.dueDate,
      beforeVat: l.beforeVat,
      gross: l.gross,
      whtRate: l.whtRate,
      checked: true,
    })),
    ...open
      .filter((p) => !onVoucher.has(p.id))
      .map((p) => ({
        id: p.id,
        note: p.note,
        poNumber: p.poNumber,
        invoiceNo: p.invoiceNo,
        dueDate: p.dueDate,
        beforeVat: p.beforeVat,
        gross: p.gross,
        whtRate: p.defaultWhtRate,
        checked: false,
      })),
  ];

  return (
    <div className="max-w-3xl space-y-6">
      {back}
      <div>
        <h1 className="text-xl font-bold text-slate-900">แก้ไขใบสำคัญจ่าย {pv.number}</h1>
        <p className="text-xs text-slate-600">
          ผู้ขาย: {pv.vendorName} · ติ๊กรายการตั้งหนี้ที่จะจ่ายในใบนี้ และกำหนดอัตราภาษีหัก ณ ที่จ่าย ยอดรวมคำนวณใหม่เมื่อบันทึก
        </p>
      </div>

      {sp.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {sp.error}
        </p>
      )}

      <form
        action={async (fd: FormData) => {
          'use server';
          let error: string | null = null;
          try {
            await updatePvAction(id, readPvPayables(fd));
          } catch (err) {
            if (!(err instanceof DomainError)) throw err;
            error = err.message;
          }
          redirect(error ? `/pv/${id}/edit?error=${encodeURIComponent(error)}` : `/pv/${id}`);
        }}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <PvPayablesTable rows={rows} />

        <div>
          <label htmlFor="pv-note" className="block text-xs font-medium text-slate-700 mb-1">
            หมายเหตุ
          </label>
          <input id="pv-note" type="text" name="note" defaultValue={pv.note} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>

        <div className="flex justify-end gap-2">
          <Link href={`/pv/${pv.id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </Link>
          <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-xs font-semibold">
            บันทึกการแก้ไข
          </button>
        </div>
      </form>
    </div>
  );
}
