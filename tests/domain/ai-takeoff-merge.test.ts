import { describe, expect, it } from 'vitest';
import { checkAgainstDrawing, findInTakeoff, mergeAcrossPages, type PagedAiItem, type WrittenQty } from '@/domain/ai-takeoff-merge';

const item = (page: number, description: string, qty: number, unit = 'ม.', kind: PagedAiItem['kind'] = 'length', confidence: PagedAiItem['confidence'] = 'high'): PagedAiItem => ({
  page,
  category: 'งานถนน',
  description,
  kind,
  unit,
  qty,
  basis: '',
  confidence,
});

describe('AI items read on several sheets', () => {
  it('counts a note repeated on each plan sheet once', () => {
    const merged = mergeAcrossPages([
      item(14, 'ก่อสร้างถนนลาดยางแอสฟัลท์ติกคอนกรีต', 1800),
      item(14, 'บ่อพัก คสล. 0.90x1.50 ม.', 90, 'บ่อ', 'count'),
      item(16, 'ถนนลาดยางแอสฟัลท์ติกคอนกรีต หนา 5 ซม.', 1800, 'ม'),
      item(16, 'บ่อพัก คสล. ขนาด 0.90x1.50 ม.', 90, 'บ่อ', 'count', 'medium'),
      item(18, 'ก่อสร้างถนนลาดยางแอสฟัลท์ติกคอนกรีต', 1800),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ qty: 1800, pages: [14, 16, 18] });
    expect(merged[1]).toMatchObject({ qty: 90, pages: [14, 16], description: 'บ่อพัก คสล. 0.90x1.50 ม.' });
  });

  it('keeps different work, different quantities and two items on one sheet apart', () => {
    const merged = mergeAcrossPages([
      item(20, 'ท่อระบายน้ำ HDPE 0.40 ม.', 120),
      item(21, 'ท่อระบายน้ำ HDPE 0.40 ม.', 80),
      item(21, 'ทาสีพื้นทางจักรยาน', 120, 'ม.'),
      item(22, 'ทางเท้าพิมพ์ลาย', 5140, 'ตร.ม.', 'area'),
      item(22, 'ทางเท้าพิมพ์ลาย', 5140, 'ตร.ม.', 'area'),
      item(23, 'Kerb', 40),
      item(24, 'kerb', 40),
    ]);
    expect(merged.map((m) => m.pages)).toEqual([[20], [21], [21], [22], [22], [23, 24]]);
  });
});

describe('merging as sheets arrive', () => {
  it('joins a new sheet to a row merged earlier and keeps what the row carries', () => {
    const first = mergeAcrossPages([{ ...item(14, 'ถนนลาดยาง', 1800), key: 'a', picked: false }]);
    first[0]!.description = 'ถนนลาดยาง หนา 5 ซม';
    const next = mergeAcrossPages([...first, { ...item(16, 'ถนนลาดยาง หนา 5 ซม.', 1800), key: 'b', picked: true }]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ key: 'a', picked: false, pages: [14, 16], page: 14, description: 'ถนนลาดยาง หนา 5 ซม' });
  });
});

describe('checking AI rows against what the drawing says', () => {
  const written: WrittenQty[] = [
    { description: 'ก่อสร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต', kind: 'area', unit: 'ตร.ม.', qty: 9000, pages: [14, 15], source: 'พื้นที่ประมาณ 9,000.00 ตารางเมตร' },
    { description: 'ทาลิพืนทางจักรยาน', kind: 'area', unit: 'ตร.ม.', qty: 2700, pages: [38], source: '' },
    { description: 'บ่อพัก คสล.ขนาด', kind: 'count', unit: 'บ่อ', qty: 90, pages: [15, 16], source: '' },
    { description: 'ช่องจอดรถ', kind: 'count', unit: 'ช่อง', qty: 7, pages: [52], source: '' },
  ];
  it('marks agreement, shows the drawing figure where the AI differs, and hands back totals it left out', () => {
    const { checks, missing } = checkAgainstDrawing(
      [
        { description: 'ก่อสร้างปรับปรุงผิวถนนลาดยางแอสฟัลท์ติกคอนกรีต หนา 0.05 ม.', kind: 'area', unit: 'ตร.ม', qty: 9000 },
        { description: 'ทาสีพื้นทางจักรยาน (ช่องกว้าง 1.20 ม.)', kind: 'area', unit: 'ตร.ม.', qty: 2700 },
        { description: 'บ่อพัก คสล. 0.90×1.50 ม.', kind: 'count', unit: 'บ่อ', qty: 4, scope: 'this_sheet' },
        { description: 'พื้นบ่อพัก คสล.', kind: 'count', unit: 'บ่อ', qty: 1, scope: 'per_unit' },
        { description: 'ท่อระบายน้ำ HDPE', kind: 'length', unit: 'ม.', qty: 1800 },
      ],
      written,
    );
    expect(checks.map((c) => c?.status ?? null)).toEqual(['match', 'match', 'part', null, null]);
    expect(checks[2]).toMatchObject({ written: { qty: 90 } });
    expect(missing.map((m) => m.qty)).toEqual([90, 7]);
  });
});

describe('findInTakeoff', () => {
  const existing = [
    { description: 'ก่อสร้างปรับปรุงถนนลาดยางแอสฟัลท์ติกคอนกรีต', kind: 'area' as const, unit: 'ตร.ม.', qty: 9000 },
    { description: 'บ่อพัก คสล.', kind: 'count' as const, unit: 'บ่อ', qty: 90 },
    { description: 'ป้ายชื่อโครงการ', kind: 'count' as const, unit: 'ป้าย', qty: 2 },
  ];
  it('finds the same total read again, even under another name', () => {
    const hits = findInTakeoff(
      [
        { description: 'ผิวทางแอสฟัลต์ หนา 0.05 ม.', kind: 'area', unit: 'ตารางเมตร', qty: 9000 },
        { description: 'บ่อพัก คสล.1 ขนาด 0.90×1.50 ม.', kind: 'count', unit: 'บ่อ', qty: 90 },
        { description: 'คอนกรีตหยาบรองใต้บ่อพัก', kind: 'area', unit: 'ตร.ม.', qty: 121.5 },
      ],
      existing,
    );
    expect(hits.map((h) => h?.qty ?? null)).toEqual([9000, 90, null]);
  });
  it('needs a similar name for small counts', () => {
    const hits = findInTakeoff(
      [
        { description: 'ประตูเหล็ก', kind: 'count', unit: 'ป้าย', qty: 2 },
        { description: 'ป้ายชื่อโครงการ ขนาด 1.2×2.4 ม.', kind: 'count', unit: 'ป้าย', qty: 2 },
      ],
      existing,
    );
    expect(hits.map((h) => h?.qty ?? null)).toEqual([null, 2]);
  });
});

describe('findInTakeoff pairs one row per item', () => {
  it('does not take the pipe for the road length already in the take-off', () => {
    const hits = findInTakeoff(
      [
        { description: 'ความยาวถนนลาดยาง', kind: 'length', unit: 'ม.', qty: 1800 },
        { description: 'ท่อระบายน้ำ HDPE ศก. 0.40 ม.', kind: 'length', unit: 'ม.', qty: 1800 },
      ],
      [{ description: 'ปรับปรุงประตูเหล็กดัดอิตาลี', kind: 'length', unit: 'ม.', qty: 1800 }],
    );
    expect(hits.map((h) => (h ? 'dup' : 'new'))).toEqual(['dup', 'new']);
  });
});

describe('same material, different places', () => {
  const at = (page: number, description: string, qty: number, extra: Partial<PagedAiItem>, unit = 'จุด', kind: PagedAiItem['kind'] = 'count'): PagedAiItem => ({ ...item(page, description, qty, unit, kind), ...extra });

  it('never joins what two sheets each show, even with the same name and count', () => {
    const merged = mergeAcrossPages([
      at(20, 'บ่อพัก คสล. 0.90x1.50 ม.', 4, { scope: 'this_sheet' }, 'บ่อ'),
      at(21, 'บ่อพัก คสล. 0.90x1.50 ม.', 4, { scope: 'this_sheet' }, 'บ่อ'),
    ]);
    expect(merged.map((m) => m.pages)).toEqual([[20], [21]]);
  });

  it('joins one segment drawn twice only when both name the same place', () => {
    const merged = mergeAcrossPages([
      at(30, 'ท่อ HDPE เข้าบ่อ', 2, { scope: 'this_sheet', location: 'ลานจอดรถหน้าอาคาร' }),
      at(31, 'ท่อ HDPE เข้าบ่อ', 2, { scope: 'this_sheet', location: 'ลานจอดรถหน้าอาคาร' }),
      at(32, 'ท่อ HDPE เข้าบ่อ', 2, { scope: 'this_sheet', location: 'ริมคลอง' }),
    ]);
    expect(merged.map((m) => m.pages)).toEqual([[30, 31], [32]]);
  });

  it('keeps totals that name different places apart', () => {
    const merged = mergeAcrossPages([
      at(14, 'ทางเท้าคอนกรีตพิมพ์ลาย', 615, { location: 'โซน A' }, 'ตร.ม.', 'area'),
      at(16, 'ทางเท้าคอนกรีตพิมพ์ลาย', 615, { location: 'โซน B' }, 'ตร.ม.', 'area'),
      at(18, 'ทางเท้าคอนกรีตพิมพ์ลาย', 615, {}, 'ตร.ม.', 'area'),
    ]);
    expect(merged.map((m) => m.pages)).toEqual([[14, 18], [16]]);
  });

  it('keeps different sizes and different typical details apart, joins the same detail', () => {
    const merged = mergeAcrossPages([
      at(40, 'ท่อ HDPE Ø 300 มม.', 120, {}, 'ม.', 'length'),
      at(41, 'ท่อ HDPE Ø 400 มม.', 120, {}, 'ม.', 'length'),
      at(50, 'พื้นบ่อพัก คสล.', 1.35, { scope: 'per_unit', perUnitOf: 'บ่อพัก คสล. 1 1 บ่อ' }, 'ตร.ม.', 'area'),
      at(51, 'พื้นบ่อพัก คสล.', 1.35, { scope: 'per_unit', perUnitOf: 'บ่อพัก คสล. 2 1 บ่อ' }, 'ตร.ม.', 'area'),
      at(58, 'พื้นบ่อพัก คสล.', 1.35, { scope: 'per_unit', perUnitOf: 'บ่อพัก คสล. 1 1 บ่อ' }, 'ตร.ม.', 'area'),
    ]);
    expect(merged.map((m) => m.pages)).toEqual([[40], [41], [50, 58], [51]]);
  });

  it('does not join work that only shares a word', () => {
    const merged = mergeAcrossPages([
      at(60, 'ยาแนวคอนกรีตคาดรอบปากท่อระบายน้ำ HDPE', 2, {}),
      at(61, 'เทคอนกรีตหยาบคาดท้องท่อ (ครึ่งท่อ)', 2, {}),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('splitting a join the user does not agree with', () => {
  it('gives each sheet its own row and keeps them apart as more sheets arrive', async () => {
    const { splitAcrossPages } = await import('@/domain/ai-takeoff-merge');
    const [joined] = mergeAcrossPages([{ ...item(14, 'ท่อ HDPE', 40), key: 'a' }, { ...item(16, 'ท่อ HDPE', 40), key: 'b' }]);
    expect(joined!.pages).toEqual([14, 16]);
    const split = splitAcrossPages(joined!);
    expect(split.map((r) => [r.key, r.pages])).toEqual([['a', [14]], ['a-p16', [16]]]);
    const later = mergeAcrossPages([...split, { ...item(18, 'ท่อ HDPE', 40), key: 'c' }]);
    expect(later.map((r) => r.pages)).toEqual([[14], [16], [18]]);
  });
});

describe('one place worded differently on each sheet', () => {
  it('joins a job total whose place is written a little differently', () => {
    const merged = mergeAcrossPages([
      { ...item(14, 'บ่อพัก คสล. ขนาด 0.90×1.50 ม. ฝั่งเดียว', 90, 'บ่อ', 'count'), location: 'ถนนภายในสวนสมเด็จพระศรีนครินทร์ STA 0+000–0+1,800' },
      { ...item(16, 'บ่อพัก คสล. ขนาด 0.90×1.50 ม. ฝั่งเดียว', 90, 'บ่อ', 'count'), location: 'แนวถนนภายในสวนสมเด็จพระศรีนครินทร์' },
      { ...item(17, 'ท่อ HDPE', 40), location: 'ลานจอดรถหน้าอาคาร' },
      { ...item(18, 'ท่อ HDPE', 40), location: 'ริมคลองด้านทิศเหนือ' },
    ]);
    expect(merged.map((m) => m.pages)).toEqual([[14, 16], [17], [18]]);
  });
});
