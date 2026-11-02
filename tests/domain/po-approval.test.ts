import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { requiredPoApprover } from '@/domain/po-approval';

describe('po approval routing', () => {
  test('routing', () => {
    expect(requiredPoApprover(D('49999.99'), D(50000))).toBe('PURCHASING_HEAD');
    expect(requiredPoApprover(D(50000), D(50000))).toBe('OWNER');
  });
});
