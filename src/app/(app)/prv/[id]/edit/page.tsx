import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { PRV_BANK_ACCOUNTS, PRV_NEW_CATEGORIES, PRV_PAY_METHODS, type PrvBankAccount, type PrvPayMethod } from '@/domain/prv';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listProjectOptions, listVendorOptions } from '@/server/services/lookups';
import { getPrvById } from '@/server/services/prv';
import { PrvFormClient } from '../../new/prv-form-client';

type NewCategory = (typeof PRV_NEW_CATEGORIES)[number];

export default async function EditPrvPage({ params }: { params: Promise<{ id: string }> }) {
  const [actor, { id }] = await Promise.all([requireUser(), params]);
  const db = await getDb();
  const prv = await getPrvById(db, actor, id);
  if (!prv) notFound();

  const legacy = !PRV_NEW_CATEGORIES.includes(prv.category as NewCategory);
  if (!prv.allowed.edit || legacy) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Link href={`/prv/${prv.id}`} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
          ← กลับไปหน้า {prv.prvNumber}
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          {legacy
            ? 'ใบขอเบิกประเภทเดิม (ค่าของตาม PO) แก้ไขในหน้านี้ไม่ได้ ค่าของตาม PO ให้เบิกผ่านใบแจ้งหนี้/PO'
            : prv.status === 'DRAFT' || prv.status === 'REJECTED'
            ? 'แก้ไขได้เฉพาะผู้ขอเบิก หรือผู้มีสิทธิ์เปิดใบขอเบิกในโครงการนี้'
            : 'ใบขอเบิกนี้ส่งตรวจแล้ว แก้ไขได้เฉพาะใบร่างหรือใบที่ถูกตีกลับ'}
        </div>
      </div>
    );
  }

  const [allProjects, allVendors] = await Promise.all([listProjectOptions(db), listVendorOptions(db)]);
  // The claim's own project stays listed even if the person may not open new claims there
  const projects = allProjects.filter((p) => p.id === prv.projectId || can(actor, 'prv.create', { projectId: p.id }));
  const total = Number(prv.totalAmount);
  // Only the VAT amount is stored; its rate is worked back from the claim's total
  const vatRate = total > 0 ? Math.round((Number(prv.vatAmount) / total) * 10000) / 100 : 0;

  return (
    <PrvFormClient
      projects={projects}
      vendors={allVendors.sort((a, b) => a.name.localeCompare(b.name, 'th'))}
      existing={{
        id: prv.id,
        number: prv.prvNumber,
        date: prv.date,
        projectId: prv.projectId,
        vendorId: prv.vendorId ?? '',
        category: prv.category as NewCategory,
        installmentNo: prv.installmentNo,
        retentionPercent: Number(prv.retentionPercent),
        whtRate: Number(prv.whtRate),
        vatRate,
        payMethod: PRV_PAY_METHODS.includes(prv.payMethod as PrvPayMethod) ? (prv.payMethod as PrvPayMethod) : null,
        payBank: PRV_BANK_ACCOUNTS.includes(prv.payBank as PrvBankAccount) ? (prv.payBank as PrvBankAccount) : null,
        notes: prv.notes ?? '',
        items: prv.items.map((it) => ({
          description: it.description,
          documentNo: it.documentNo,
          poNumber: it.poNumber,
          quantity: Number(it.quantity),
          unit: it.unit,
          unitPrice: Number(it.unitPrice),
          progressPercent: Number(it.progressPercent),
        })),
      }}
    />
  );
}
