import { describe, expect, it } from 'vitest';
import { findScannedAsset } from '@/domain/asset';

const assets = [
  { id: '11111111-1111-1111-1111-111111111111', code: 'AST-6911-0003' },
  { id: '22222222-2222-2222-2222-222222222222', code: 'AST-6911-0004' },
];

describe('findScannedAsset', () => {
  it('reads the asset id from a printed label link', () => {
    expect(findScannedAsset('https://ktech-erp.onrender.com/assets?asset=22222222-2222-2222-2222-222222222222', assets)?.code).toBe('AST-6911-0004');
  });
  it('accepts an asset code, ignoring case and spaces', () => {
    expect(findScannedAsset('  ast-6911-0003 ', assets)?.id).toBe(assets[0].id);
  });
  it('accepts a bare id', () => {
    expect(findScannedAsset(assets[1].id, assets)?.code).toBe('AST-6911-0004');
  });
  it('returns nothing for an unknown or unrelated code', () => {
    expect(findScannedAsset('https://example.com/?asset=nope', assets)).toBeUndefined();
    expect(findScannedAsset('hello', assets)).toBeUndefined();
    expect(findScannedAsset('', assets)).toBeUndefined();
  });
});
