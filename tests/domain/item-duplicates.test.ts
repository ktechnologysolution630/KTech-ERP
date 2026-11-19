import { describe, expect, test } from 'vitest';
import { findDuplicateGroups, normalizeForDuplicate, pickKeeper, type DuplicateCandidate } from '@/domain/item-duplicates';

const item = (id: string, code: string, name: string, unitName = 'เส้น', active = true): DuplicateCandidate => ({
  id,
  code,
  name,
  unitName,
  category: null,
  active,
});

describe('item duplicates', () => {
  test('names compare without spaces, case, punctuation, Thai digits or ×', () => {
    expect(normalizeForDuplicate('เหล็กกล่อง 50x50x2.3 มม.')).toBe(normalizeForDuplicate('เหล็กกล่อง  50 × 50 × 2.3มม'));
    expect(normalizeForDuplicate('Anchor Bolt (M16)')).toBe(normalizeForDuplicate('anchor bolt m16'));
    expect(normalizeForDuplicate('ท่อ ๒ นิ้ว')).toBe(normalizeForDuplicate('ท่อ 2 นิ้ว'));
    expect(normalizeForDuplicate('เหล็กกล่อง 50x50')).not.toBe(normalizeForDuplicate('เหล็กกล่อง 50x100'));
  });

  test('groups look-alike names and codes, and flags mixed units', () => {
    const groups = findDuplicateGroups([
      item('1', '10-03-006', 'เหล็กกล่อง 50x50x2.3 มม.'),
      item('2', '10-03-106', 'เหล็กกล่อง 50 × 50 × 2.3 มม', 'ท่อน'),
      item('3', 'AA01', 'ปูนซีเมนต์'),
      item('4', 'aa-01', 'ปูนถุง'),
      item('5', '10-03-007', 'เหล็กกล่อง 100x50x2.3 มม.'),
    ]);
    expect(groups.map((g) => [g.reason, g.items.map((i) => i.id), g.mixedUnits])).toEqual([
      ['code', ['4', '3'], false],
      ['name', ['1', '2'], true],
    ]);
    // different names (code group) or different units are not offered for automatic ticking
    expect(groups.map((g) => g.sameThing)).toEqual([false, false]);
  });

  test('a pair matching on both code and name is listed once', () => {
    const groups = findDuplicateGroups([item('1', 'A-1', 'ทราย'), item('2', 'a1', 'ทราย ')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reason).toBe('code');
    expect(groups[0]!.sameThing).toBe(true);
  });

  test('the keeper is the most used, then active, then lowest code', () => {
    const [g] = findDuplicateGroups([item('1', 'B', 'หิน'), item('2', 'A', 'หิน', 'เส้น', false), item('3', 'C', 'หิน')]);
    expect(pickKeeper(g!, new Map()).id).toBe('1');
    expect(pickKeeper(g!, new Map([['3', 2]])).id).toBe('3');
  });
});
