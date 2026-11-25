import { describe, expect, test, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createTakeoff } from '@/server/services/boq-takeoff';
import { claudeConsolidator, claudeReader, consolidateTakeoff, readTakeoffPage, type AiConsolidateRow, type AiConsolidator, type AiReader, type AiTakeoffPageInput } from '@/server/services/boq-ai-takeoff';

const page: AiTakeoffPageInput = { page: 2, imageBase64: 'A'.repeat(200), paperMm: { w: 420, h: 297 }, scaleLabel: '1:100', hint: 'ผนังสูง 3 ม.' };

const fakeReader: AiReader = async () => ({
  drawingTitle: 'A-101 แปลนพื้นชั้น 1',
  scaleSeen: '1:100',
  warnings: ['ไม่พบความสูงผนัง ใช้ 3.00 ม. ตามคำแนะนำ'],
  items: [
    { category: 'งานสถาปัตยกรรม', description: 'ผนังก่ออิฐมวลเบา', kind: 'length', unit: 'ตร.ม.', qty: 123.45678, basis: '41.15 ม. × 3.00 ม.', confidence: 'medium', scope: 'this_sheet', perUnitOf: '' },
    { category: 'งานสถาปัตยกรรม', description: 'ประตู D1', kind: 'count', unit: 'ชุด', qty: 4, basis: 'ตารางประตู', confidence: 'high', scope: 'project_total', perUnitOf: '' },
    { category: 'งานสถาปัตยกรรม', description: 'ไม่มีปริมาณ', kind: 'count', unit: 'ชุด', qty: 0, basis: '', confidence: 'low', scope: 'project_total', perUnitOf: '' },
    { category: '', description: '  ', kind: 'area', unit: 'ตร.ม.', qty: 10, basis: '', confidence: 'low', scope: 'project_total', perUnitOf: '' },
  ],
});

describe('AI take-off', () => {
  test('passes the page to the reader and keeps only items with a quantity', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id } = await createTakeoff(db, f.users.pm, { name: 'อาคาร A', projectId: f.projectA });
    const reader = vi.fn(fakeReader);
    const res = await readTakeoffPage(db, f.users.pm, id, page, reader);
    expect(reader).toHaveBeenCalledWith(expect.objectContaining({ page: 2, scaleLabel: '1:100', hint: 'ผนังสูง 3 ม.' }));
    expect(res.drawingTitle).toBe('A-101 แปลนพื้นชั้น 1');
    expect(res.items.map((i) => i.description)).toEqual(['ผนังก่ออิฐมวลเบา', 'ประตู D1']);
    expect(res.items[0]!.qty).toBe(123.457);
    expect(res.warnings).toHaveLength(1);
  });

  test('someone who cannot see the take-off is refused, and a bad image never reaches the AI', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id } = await createTakeoff(db, f.users.foreman, { name: 'ของฉัน', projectId: null });
    const reader = vi.fn(fakeReader);
    await expect(readTakeoffPage(db, f.users.otherForeman, id, page, reader)).rejects.toMatchObject({ status: 404 });
    await expect(readTakeoffPage(db, f.users.foreman, id, { ...page, imageBase64: 'not base64!' }, reader)).rejects.toMatchObject({ status: 400 });
    expect(reader).not.toHaveBeenCalled();
  });

  test('without an API key it says AI is not set up', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(claudeReader(page)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

const row = (id: string, description: string, qty: number, unit: string, scope: AiConsolidateRow['scope'], pages: number[], perUnitOf = ''): AiConsolidateRow => ({
  id, pages, category: 'งานระบายน้ำ', description, kind: 'count', unit, qty, scope, perUnitOf, basis: '',
});

describe('joining the sheets into one BOQ', () => {
  const rows = [
    row('a', 'บ่อพัก คสล. 0.90×1.50 ม.', 90, 'บ่อ', 'project_total', [15, 16, 27]),
    row('b', 'บ่อพัก คสล. 0.90×1.50 ม.', 4, 'บ่อ', 'this_sheet', [16]),
    row('c', 'ฝาบ่อพักเหล็กหล่อ', 1, 'ชุด', 'per_unit', [60], 'บ่อพัก 1 บ่อ'),
    row('d', 'ห้องปั๊ม', 1, 'หลัง', 'project_total', [14]),
  ];
  const fake: AiConsolidator = async () => ({
    items: [
      { category: 'งานระบายน้ำ', description: 'บ่อพัก คสล. 0.90×1.50 ม.', kind: 'count', unit: 'บ่อ', qty: 90, basis: 'ยอดรวมตามหมายเหตุ', confidence: 'high', sources: ['a', 'b'] },
      { category: 'งานระบายน้ำ', description: 'ฝาบ่อพักเหล็กหล่อ', kind: 'count', unit: 'ชุด', qty: 90, basis: '1 ชุด/บ่อ × 90 บ่อ', confidence: 'medium', sources: ['c', 'zzz'] },
    ],
    dropped: [],
    notes: ['ตรวจจำนวนฝาบ่อ'],
  });

  test('keeps the result, ignores ids it was not given and lists rows left out', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id } = await createTakeoff(db, f.users.pm, { name: 'ถนน', projectId: f.projectA });
    const consolidator = vi.fn(fake);
    const res = await consolidateTakeoff(db, f.users.pm, id, { rows, hint: 'ถนนในสวน' }, consolidator);
    expect(consolidator).toHaveBeenCalledWith(rows, 'ถนนในสวน');
    expect(res.items.map((i) => [i.qty, i.sources])).toEqual([[90, ['a', 'b']], [90, ['c']]]);
    expect(res.unaccounted).toEqual(['d']);
    expect(res.notes).toEqual(['ตรวจจำนวนฝาบ่อ']);
  });

  test('refuses someone who cannot see the take-off, and a single row', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id } = await createTakeoff(db, f.users.foreman, { name: 'ของฉัน', projectId: null });
    const consolidator = vi.fn(fake);
    await expect(consolidateTakeoff(db, f.users.otherForeman, id, { rows }, consolidator)).rejects.toMatchObject({ status: 404 });
    await expect(consolidateTakeoff(db, f.users.foreman, id, { rows: rows.slice(0, 1) }, consolidator)).rejects.toMatchObject({ status: 400 });
    expect(consolidator).not.toHaveBeenCalled();
  });

  test('without an API key it says AI is not set up', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(claudeConsolidator(rows)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
