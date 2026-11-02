'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { createReceipt } from '@/server/services/receipt';

export async function createReceiptAction(input: {
  poId: string;
  receivedAt: string;
  deliveryNoteNo?: string;
  note?: string;
  lines: { poLineId: string; qty: string }[];
}): Promise<{ receiptId: string }> {
  const actor = await requireUser();
  const db = await getDb();
  const filtered = input.lines.filter((l) => Number(l.qty) > 0);
  const created = await createReceipt(db, actor, {
    ...input,
    lines: filtered,
  });
  revalidatePath(`/po/${input.poId}`);
  revalidatePath('/receive');
  return { receiptId: created.id };
}

export async function finishReceiptRedirectAction(poId: string) {
  redirect(`/po/${poId}`);
}
