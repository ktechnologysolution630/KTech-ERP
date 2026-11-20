'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { closePeriod, closeYear, reopenLatest } from '@/server/services/gl-period';

type Result = { ok: true; message: string } | { ok: false; error: string };

async function run(fn: () => Promise<string>): Promise<Result> {
  try {
    const message = await fn();
    revalidatePath('/accounting/gl/close');
    revalidatePath('/accounting/gl');
    return { ok: true, message };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function closePeriodAction(through: string) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(async () => `ปิดงวดถึง ${await closePeriod(db, actor, { through })} แล้ว`);
}

export async function closeYearAction(year: number) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(async () => {
    const r = await closeYear(db, actor, year);
    return `ปิดบัญชีปี ${year} แล้ว ${r.netProfit >= 0 ? 'กำไร' : 'ขาดทุน'}สุทธิ ${Math.abs(r.netProfit).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
  });
}

export async function reopenLatestAction(reason: string) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(async () => {
    await reopenLatest(db, actor, reason);
    return 'เปิดงวดล่าสุดแล้ว';
  });
}
