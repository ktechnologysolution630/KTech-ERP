import { describe, expect, test, vi } from 'vitest';
import { DomainError } from '@/domain/errors';

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

const { messageOnRefusal, returnOnRefusal, withErrorParam } = await import('@/lib/action-outcome');

describe('action outcome helpers', () => {
  test('a refusal comes back as its Thai message; success as undefined', async () => {
    expect(await messageOnRefusal(async () => undefined)).toBeUndefined();
    expect(
      await messageOnRefusal(async () => {
        throw new DomainError('PO_HAS_ACTIVITY', 'ไม่สามารถยกเลิก PO ที่มีการรับของแล้วได้', 409);
      }),
    ).toBe('ไม่สามารถยกเลิก PO ที่มีการรับของแล้วได้');
  });

  test('an unexpected error is still thrown', async () => {
    await expect(messageOnRefusal(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  test('a refused form goes back to its page with the message', async () => {
    await expect(
      returnOnRefusal('/po/1', async () => {
        throw new DomainError('X', 'ทำไม่ได้');
      }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/po/1?error=${encodeURIComponent('ทำไม่ได้')}`);
    expect(withErrorParam('/pv/new?vendorId=a', 'x')).toBe('/pv/new?vendorId=a&error=x');
  });
});
