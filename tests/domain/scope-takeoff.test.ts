import { describe, expect, it } from 'vitest';
import { extractScopeItems, parseThaiNumber } from '@/domain/scope-takeoff';
import { extractTextItems } from '@/domain/text-takeoff';
import { torPage21, torPage4 } from '../fixtures/tor-scope-lines';

const lines = [...torPage4.map((text) => ({ page: 4, text })), ...torPage21.map((text) => ({ page: 21, text }))];

describe('scope-of-work list', () => {
  it('reads numbers however OCR wrote the separators', () => {
    expect(parseThaiNumber('9,000.00')).toBe(9000);
    expect(parseThaiNumber('1.800.00')).toBe(1800);
    expect(parseThaiNumber('1,800,00')).toBe(1800);
    expect(parseThaiNumber('5.140.00')).toBe(5140);
    expect(parseThaiNumber('330.00')).toBe(330);
    expect(parseThaiNumber('90')).toBe(90);
    expect(parseThaiNumber('๙๐')).toBe(90);
  });

  it('reads the numbered items with their sections and quantities', () => {
    const items = extractScopeItems(lines);
    const by = new Map(items.map((i) => [i.fixedNo ?? i.no, i]));
    expect(items.map((i) => i.fixedNo ?? i.no)).toEqual(['1.1', '1.2', '2.1', '2.2', '2.3', '2.4', '2.5', '3.1', '3.2', '3.3', '3.4', '3.5', '4', '5.1', '5.2', '5.3']);
    expect(by.get('1.1')).toMatchObject({ qty: 8928, unit: 'ตร.ม.', kind: 'area', sectionNo: '1' });
    expect(by.get('1.1')!.sectionName).toContain('งานร');
    expect(by.get('2.1')).toMatchObject({ qty: 9000, unit: 'ตร.ม.' });
    expect(by.get('2.1')!.description).toContain('ถนนลาดยาง');
    expect(by.get('2.2')).toMatchObject({ qty: 90, unit: 'บ่อ', kind: 'count' });
    expect(by.get('2.3')).toMatchObject({ qty: 1800, unit: 'ม.', kind: 'length' });
    expect(by.get('3.4')).toMatchObject({ qty: 1, unit: 'งาน' });
    expect(by.get('4')).toMatchObject({ qty: 1, unit: 'บ่อ', sectionNo: '4' });
    expect(by.get('5.2')).toMatchObject({ qty: 5, unit: 'ชุด', sectionNo: '5' });
  });

  it('puts right an item number that breaks the order', () => {
    const items = extractScopeItems(lines);
    const misread = items.find((i) => i.no === '5.2' && i.qty === 5140)!;
    expect(misread.fixedNo).toBe('3.2');
    expect(misread.sectionNo).toBe('3');
    expect(items.filter((i) => i.fixedNo)).toHaveLength(1);
  });

  it('checks each item against the quantities written on the sheets', () => {
    const items = extractScopeItems(lines, extractTextItems(lines));
    const by = new Map(items.map((i) => [i.fixedNo ?? i.no, i]));
    expect(by.get('2.1')!.confirmedOn).toEqual([21]);
    expect(by.get('2.2')!.confirmedOn).toEqual([21]);
    expect(by.get('3.2')!.confirmedOn).toEqual([21]);
    expect(by.get('1.1')!.confirmedOn).toEqual([]);
  });

  it('offers the sheets’ quantity when the list’s is one OCR slip away', () => {
    const list = ['1. งานรื้อถอน', '1.1 งานรื้อผิวจราจรเดิม พื้นที่รวมประมาณ 8,928.00 ตารางเมตร', '1.2 งานรื้อท่อ ความยาวประมาณ 1,800.00 เมตร', '2. งานวางท่อ', '2.1 วางท่อระบายน้ำ ความยาวรวมประมาณ 800.00 เมตร', '2.2 งานคันหิน ความยาวรวมประมาณ 1,000 เมตร'];
    const sheet = ['วางท่อระบายน้ำ HDPE ยาวประมาณ 1,800.00 เมตร'];
    const all = [...list.map((text) => ({ page: 2, text })), ...sheet.map((text) => ({ page: 9, text }))];
    const items = extractScopeItems(all, extractTextItems(all));
    expect(items.find((i) => i.no === '2.1')!.sheetQty).toEqual({ qty: 1800, pages: [9] });
    expect(items.find((i) => i.no === '1.2')!.confirmedOn).toEqual([9]);
  });

  it('finds nothing on ordinary drawing sheets', () => {
    expect(extractScopeItems(torPage21.map((text) => ({ page: 21, text })))).toEqual([]);
  });
});
