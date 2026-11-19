/**
 * Finds items in the register that look like the same thing entered twice: the same code, or the
 * same name once spaces, case, punctuation, Thai digits and "×" against "x" are set aside.
 */

export interface DuplicateCandidate {
  id: string;
  code: string;
  name: string;
  unitName: string;
  category: string | null;
  active: boolean;
}

export type DuplicateReason = 'code' | 'name';

export interface DuplicateGroup<T extends DuplicateCandidate = DuplicateCandidate> {
  /** What the group's items share */
  reason: DuplicateReason;
  /** Normalised key they share, for a stable React key */
  key: string;
  items: T[];
  /** The items do not all use the same unit (could be a real difference, e.g. sold by box and by piece) */
  mixedUnits: boolean;
  /** Same name and same unit throughout: the extra copies can be offered for deletion */
  sameThing: boolean;
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Lower-cased, NFKC, Thai digits to 0-9, "×" to "x", with every space and punctuation mark removed */
export function normalizeForDuplicate(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/[×✕✖*]/g, 'x')
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

function groupBy<T extends DuplicateCandidate>(items: T[], reason: DuplicateReason, field: (i: T) => string): DuplicateGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const it of items) {
    const key = normalizeForDuplicate(field(it));
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(it);
    else byKey.set(key, [it]);
  }
  const groups: DuplicateGroup<T>[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code));
    groups.push({
      reason,
      key: `${reason}:${key}`,
      items: sorted,
      mixedUnits: new Set(sorted.map((i) => normalizeForDuplicate(i.unitName))).size > 1,
      sameThing: false,
    });
  }
  return groups.sort((a, b) => a.items[0]!.code.localeCompare(b.items[0]!.code));
}

const sameMembers = (a: DuplicateCandidate[], b: DuplicateCandidate[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));

/** Groups of two or more look-alike items: code matches first, then name matches not already shown */
export function findDuplicateGroups<T extends DuplicateCandidate>(items: T[]): DuplicateGroup<T>[] {
  const byCode = groupBy(items, 'code', (i) => i.code);
  const byName = groupBy(items, 'name', (i) => i.name).filter((g) => !byCode.some((c) => sameMembers(c.items, g.items)));
  return [...byCode, ...byName].map((g) => ({
    ...g,
    sameThing: !g.mixedUnits && new Set(g.items.map((i) => normalizeForDuplicate(i.name))).size === 1,
  }));
}

/**
 * The item to keep from a group: one still in use (most document lines), then an active one,
 * then the lowest code. Everything else in the group is a suggestion to delete.
 */
export function pickKeeper<T extends DuplicateCandidate>(group: DuplicateGroup<T>, usage: ReadonlyMap<string, number>): T {
  return [...group.items].sort(
    (a, b) =>
      (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) ||
      Number(b.active) - Number(a.active) ||
      a.code.localeCompare(b.code),
  )[0]!;
}
