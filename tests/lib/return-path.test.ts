import { describe, expect, test } from 'vitest';
import { loginUrlFor, safeReturnPath } from '@/lib/return-path';

describe('return path after login', () => {
  test('keeps a path on this site, with its query', () => {
    expect(safeReturnPath('/assets?asset=abc')).toBe('/assets?asset=abc');
    expect(loginUrlFor('/assets?asset=abc')).toBe('/login?next=%2Fassets%3Fasset%3Dabc');
  });

  test('refuses anything that could leave the site', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example', 'assets', '', null, undefined, 42]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });

  test('does not come back to the login page or bother with the home page', () => {
    expect(safeReturnPath('/login?next=/stock')).toBeNull();
    expect(loginUrlFor('/')).toBe('/login');
    expect(loginUrlFor(null)).toBe('/login');
  });
});
