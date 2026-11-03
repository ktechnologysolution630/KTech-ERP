'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { authenticate, createSessionCookie, destroySession } from '@/server/auth/session';

export async function loginAction(
  _prevState: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const db = await getDb();
  const user = await authenticate(db, email, password);
  if (!user) {
    return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
  }
  await createSessionCookie(user.id);
  redirect('/stock');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
