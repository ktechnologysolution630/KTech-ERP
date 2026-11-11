import { getDb } from '@/db/client';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { getMySignature } from '@/server/services/signatures';
import { SignatureEditor } from './signature-editor';

/** โปรไฟล์ของฉัน: who is signed in, and the signature put on documents they prepare or approve */
export default async function ProfilePage() {
  const actor = await requireUser();
  const signature = await getMySignature(await getDb(), actor);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">โปรไฟล์ของฉัน</h1>
        <p className="text-xs text-slate-500">ข้อมูลผู้ใช้งานและลายเซ็นดิจิทัลสำหรับลงในเอกสาร</p>
      </div>
      <dl className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">ชื่อ</dt>
          <dd className="text-sm font-semibold text-slate-900">{actor.name}</dd>
        </div>
        <div>
          <dt className="text-slate-500">อีเมล</dt>
          <dd className="text-sm font-semibold text-slate-900">{actor.email}</dd>
        </div>
      </dl>
      <SignatureEditor current={signature?.image ?? null} updatedAt={signature ? formatThaiDate(signature.updatedAt) : null} />
    </div>
  );
}
