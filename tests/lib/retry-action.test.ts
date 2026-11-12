import { describe, expect, test, vi } from 'vitest';
import { withRetry } from '@/lib/retry-action';
import { GET } from '@/app/api/ping/route';

describe('sending again when the server does not answer', () => {
  test('a call that fails while the server wakes up is tried again until it answers', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('An unexpected response was received from the server.')).mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue({ ok: true });
    const onRetry = vi.fn();
    await expect(withRetry(fn, { waitMs: 1, onRetry })).resolves.toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls).toEqual([[1], [2]]);
  });

  test('a refusal from the app is an answer, not a failure, and is not sent again', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: 'เลขไมล์ต้องไม่เกิน 9,999,999 กม.' });
    await expect(withRetry(fn, { waitMs: 1 })).resolves.toEqual({ ok: false, error: 'เลขไมล์ต้องไม่เกิน 9,999,999 กม.' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('it gives up after the last try and passes the failure on', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(fn, { tries: 3, waitMs: 1 })).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('the keep-awake ping answers without a body and is never cached', () => {
    const res = GET();
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
