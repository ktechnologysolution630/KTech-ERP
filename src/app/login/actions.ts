'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { landingPathFor } from '@/domain/menu';
import { safeReturnPath } from '@/lib/return-path';
import { AuthConfigError, authenticate, createSessionCookie, destroySession } from '@/server/auth/session';

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
  try {
    await createSessionCookie(user.id);
  } catch (err) {
    if (!(err instanceof AuthConfigError)) throw err;
    console.error(err.message);
    return { error: 'ระบบยังไม่ได้ตั้งค่า AUTH_SECRET (อย่างน้อย 32 ตัวอักษร) กรุณาแจ้งผู้ดูแลระบบ' };
  }
  redirect(safeReturnPath(formData.get('next')) ?? landingPathFor(user.hiddenMenus));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
