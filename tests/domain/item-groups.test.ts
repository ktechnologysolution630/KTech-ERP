import { describe, expect, test } from 'vitest';
import { classifyItem, groupOfItemCode, groupsOfCategory, ITEM_GROUPS } from '@/domain/item-groups';
import { STOCK_CATEGORIES } from '@/domain/stock';
import { prSignatures } from '@/domain/pr-type';

describe('item groups', () => {
  test('every category has groups and every group code is its own', () => {
    for (const c of STOCK_CATEGORIES) expect(groupsOfCategory(c).length).toBeGreaterThan(0);
    expect(new Set(ITEM_GROUPS.map((g) => g.code)).size).toBe(ITEM_GROUPS.length);
    expect(groupsOfCategory('')).toEqual([]);
    expect(groupsOfCategory(null)).toEqual([]);
  });

  test('an item code CC-GG-NNN names its group', () => {
    expect(groupOfItemCode('10-02-004')).toMatchObject({ category: 'งานโครงสร้าง', name: 'เหล็กเสริม' });
    expect(groupOfItemCode(' 40-01-001 ')).toMatchObject({ name: 'สายไฟฟ้า' });
    expect(groupOfItemCode('ITM-001')).toBeUndefined();
    expect(groupOfItemCode('99-99-001')).toBeUndefined();
    expect(groupOfItemCode(null)).toBeUndefined();
  });

  test('a picked item is placed by its code, else by its own category', () => {
    expect(classifyItem({ code: '30-03-002', category: 'อื่น' })).toEqual({ category: 'งานสุขาภิบาล', group: 'สุขภัณฑ์' });
    expect(classifyItem({ code: 'ITM-001', category: 'ครุภัณฑ์' })).toEqual({ category: 'ครุภัณฑ์', group: '' });
    expect(classifyItem({ code: 'ITM-002', category: 'ทั่วไป' })).toEqual({ category: '', group: '' });
    expect(classifyItem({ code: 'ITM-003' })).toEqual({ category: '', group: '' });
  });
});

describe('PR signatures', () => {
  test('on the goods form the requester and the preparer share one box', () => {
    expect(prSignatures('GOODS')).toEqual(['ผู้ขอซื้อ / ผู้จัดทำ', 'ผู้อนุมัติ']);
    expect(prSignatures('LABOR')).toEqual(['ผู้ขอจ้าง', 'ผู้จัดทำ', 'ผู้อนุมัติ']);
    expect(prSignatures('GOODS_AND_LABOR')).toEqual(['ผู้ขอซื้อ', 'ผู้จัดทำ', 'ผู้อนุมัติ']);
  });
});
