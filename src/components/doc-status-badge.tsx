export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'ร่าง', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  SUBMITTED: { label: 'รออนุมัติ', color: 'bg-amber-50 text-amber-800 border-amber-300' },
  PENDING_APPROVAL: { label: 'รออนุมัติ', color: 'bg-amber-50 text-amber-800 border-amber-300' },
  APPROVED: { label: 'อนุมัติแล้ว', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  REJECTED: { label: 'ตีกลับ', color: 'bg-red-50 text-red-700 border-red-300' },
  ORDERED: { label: 'สั่งของแล้ว', color: 'bg-blue-50 text-blue-800 border-blue-300' },
  COMPLETED: { label: 'เสร็จสมบูรณ์', color: 'bg-emerald-100 text-emerald-900 border-emerald-400' },
  CANCELLED: { label: 'ยกเลิก', color: 'bg-slate-200 text-slate-600 border-slate-300' },
  CLOSED: { label: 'ปิดใบขอซื้อ', color: 'bg-slate-200 text-slate-700 border-slate-300' },
  CONFIRMED: { label: 'ยืนยันรับแล้ว', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  ACTIVE: { label: 'ปกติ', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  VOID: { label: 'ยกเลิก', color: 'bg-slate-200 text-slate-600 border-slate-300' },
  OPEN: { label: 'รอทำจ่าย', color: 'bg-amber-50 text-amber-800 border-amber-300' },
  IN_PV: { label: 'อยู่ในใบสำคัญจ่าย', color: 'bg-blue-50 text-blue-800 border-blue-300' },
  PAID: { label: 'จ่ายแล้ว', color: 'bg-emerald-100 text-emerald-900 border-emerald-400' },
  UNPAID: { label: 'ยังไม่จ่าย', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  PENDING: { label: 'ยังไม่ถึงกำหนด', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  REQUESTED: { label: 'ขอเบิกแล้ว', color: 'bg-amber-50 text-amber-800 border-amber-300' },
  NONE: { label: 'รอรับของ', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  PARTIAL: { label: 'บางส่วน', color: 'bg-amber-50 text-amber-800 border-amber-300' },
  FULL: { label: 'ครบแล้ว', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  PAID_NOT_RECEIVED: {
    label: 'จ่ายแล้ว ของยังไม่มา',
    color: 'bg-orange-100 text-orange-900 border-orange-400 font-semibold',
  },
  MISSING_TAX_INVOICE: {
    label: 'ยังไม่ได้ใบกำกับภาษี',
    color: 'bg-purple-50 text-purple-800 border-purple-300',
  },
  REFUND_DUE: {
    label: 'รอคืนเงินจากผู้ขาย',
    color: 'bg-rose-100 text-rose-900 border-rose-400 font-semibold',
  },
};

export function DocStatusBadge({
  status,
  customLabel,
}: {
  status: string;
  customLabel?: string;
}) {
  const entry = STATUS_MAP[status] ?? {
    label: status,
    color: 'bg-slate-100 text-slate-700 border-slate-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${entry.color}`}
    >
      {customLabel ?? entry.label}
    </span>
  );
}
