import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/db/client', () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock('@/server/auth/session', () => ({
  authenticate: vi.fn(async () => null),
  createSessionCookie: vi.fn(async () => undefined),
  destroySession: vi.fn(async () => undefined),
}));

import * as actions from '@/app/login/actions';

describe('login actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose a hardcoded admin quick-login action', () => {
    expect(actions).not.toHaveProperty('quickLoginAdminAction');
  });

  it('returns a generic error without leaking credentials', async () => {
    const formData = new FormData();
    formData.set('email', 'x@example.com');
    formData.set('password', 'wrong');

    const result = await actions.loginAction(null, formData);

    expect(result.error).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    expect(result.error).not.toContain('admin1234');
    expect(result.error).not.toContain('admin@ktec.local');
  });
});
