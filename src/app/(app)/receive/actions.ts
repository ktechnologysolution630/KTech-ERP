'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { createReceipt } from '@/server/services/receipt';

export type ReceiptActionResult = { ok: true; receiptId: string } | { ok: false; error: string };

export async function createReceiptAction(input: {
  poId: string;
  receivedAt: string;
  deliveryNoteNo?: string;
  note?: string;
  lines: { poLineId: string; qty: string }[];
}): Promise<ReceiptActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  const filtered = input.lines.filter((l) => Number(l.qty) > 0);
  let created: { id: string };
  try {
    created = await createReceipt(db, actor, {
      ...input,
      lines: filtered,
    });
  } catch (err) {
    // A thrown error loses its message on production and shows as "React error #441"
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/po/${input.poId}`);
  revalidatePath('/receive');
  return { ok: true, receiptId: created.id };
}

export async function finishReceiptRedirectAction(poId: string) {
  redirect(`/po/${poId}`);
}
