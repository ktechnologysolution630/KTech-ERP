import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';

/** AR pages are for finance, owner and admin; others are sent back to their inbox. */
export async function requireArUser() {
  const actor = await requireUser();
  if (!can(actor, 'ar.manage')) redirect('/inbox');
  return { actor, db: await getDb() };
}

export const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
