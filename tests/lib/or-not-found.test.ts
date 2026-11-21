import { describe, expect, test } from 'vitest';
import { loadOrNotFound } from '@/app/(app)/or-not-found';
import { DomainError } from '@/domain/errors';

const ID = '0b8f6a52-6a0e-4d7c-9a51-0f1d2c3b4a59';
const isNotFound = (err: unknown) => String((err as { digest?: string })?.digest ?? '').includes('404');

describe('loadOrNotFound', () => {
  test('a mistyped id shows "not found" without querying', async () => {
    let called = false;
    const err = await loadOrNotFound('not-a-uuid', async () => { called = true; }).catch((e: unknown) => e);
    expect(isNotFound(err)).toBe(true);
    expect(called).toBe(false);
  });

  test('a deleted document shows "not found"; other refusals still reach the error page', async () => {
    const gone = await loadOrNotFound(ID, async () => { throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404); }).catch((e: unknown) => e);
    expect(isNotFound(gone)).toBe(true);
    const forbidden = await loadOrNotFound(ID, async () => { throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์', 403); }).catch((e: unknown) => e);
    expect(forbidden).toBeInstanceOf(DomainError);
    await expect(loadOrNotFound(ID, async () => 'doc')).resolves.toBe('doc');
  });
});
