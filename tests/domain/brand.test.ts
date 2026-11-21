import { describe, expect, it } from 'vitest';
import { shortCompanyName } from '@/domain/brand';

describe('shortCompanyName', () => {
  it.each([
    ['K TECHNOLOGY SOLUTION CO., LTD.', 'K TECHNOLOGY SOLUTION'],
    ['K Technology Solution Co.,Ltd.', 'K Technology Solution'],
    ['K TECHNOLOGY SOLUTION COMPANY LIMITED', 'K TECHNOLOGY SOLUTION'],
    ['ABC PUBLIC COMPANY LIMITED', 'ABC'],
    ['ABC Co Ltd', 'ABC'],
    ['ABC LTD.', 'ABC'],
    ['ABC Limited', 'ABC'],
    ['  K TECH  ', 'K TECH'],
    ['ACME CONSTRUCTION', 'ACME CONSTRUCTION'],
  ])('%s -> %s', (input, out) => expect(shortCompanyName(input)).toBe(out));

  it('keeps a name that is only a suffix', () => expect(shortCompanyName('Co., Ltd.')).toBe('Co., Ltd.'));
});
