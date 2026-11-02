import { formatThaiDate } from '@/domain/thai';

const ACTION_LABELS: Record<string, string> = {
  create: 'สร้างเอกสาร',
  update: 'แก้ไขเอกสาร',
  submit: 'ส่งขออนุมัติ',
  approve: 'อนุมัติ',
  reject: 'ตีกลับ',
  order: 'สั่งซื้อแล้ว',
  cancel: 'ยกเลิก',
  close: 'ปิดเอกสาร',
  pay: 'บันทึกจ่ายเงินแล้ว',
  'attachment.add': 'แนบไฟล์',
  comment: 'แสดงความคิดเห็น',
  'close_short.request': 'ขอปิดยอดค้างรับ',
  'close_short.approve': 'อนุมัติปิดยอดค้างรับ',
  'close_short.reject': 'ปฏิเสธปิดยอดค้างรับ',
};

export function ActivityFeed({
  items,
}: {
  items: {
    id: string;
    action: string;
    userName: string;
    note: string | null;
    createdAt: Date;
  }[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">ประวัติการดำเนินการ</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">ยังไม่มีประวัติ</p>
      ) : (
        <ul className="space-y-2.5 text-xs">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <div>
                <span className="font-medium text-slate-800">
                  {ACTION_LABELS[item.action] ?? item.action}
                </span>{' '}
                <span className="text-slate-500">โดย {item.userName}</span>
                {item.note && (
                  <p className="mt-0.5 text-slate-600 bg-slate-50 rounded px-2 py-1">
                    {item.note}
                  </p>
                )}
              </div>
              <span className="text-slate-400 whitespace-nowrap">
                {formatThaiDate(item.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
