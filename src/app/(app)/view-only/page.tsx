import Link from 'next/link';
import { Eye } from 'lucide-react';
import { VIEW_ONLY_MESSAGE } from '@/domain/view-only-device';
import { BackButton } from './back-button';

/** Where an iPhone or iPad lands when it tries to write something: nothing was saved, and why */
export default function ViewOnlyPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs">
        <Eye className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-bold text-slate-900">อุปกรณ์นี้ดูเอกสารได้อย่างเดียว</h1>
        <p className="text-sm text-slate-600">{VIEW_ONLY_MESSAGE}</p>
        <p className="text-sm font-medium text-slate-800">รายการที่ทำเมื่อครู่ยังไม่ถูกบันทึก กรุณาทำรายการบนคอมพิวเตอร์</p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <BackButton />
          <Link href="/inbox" prefetch={false} className="inline-block rounded-lg bg-[#2453d4] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            กลับไปพอร์ทัลของฉัน
          </Link>
        </div>
      </div>
    </div>
  );
}
