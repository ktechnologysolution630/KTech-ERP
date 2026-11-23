/**
 * Text matching shared by every search box: case-insensitive, Thai-safe (Unicode NFC), and
 * word-by-word, so "ปูน 50" finds "ปูนซีเมนต์ ตราช้าง 50 กก." and "aa01" finds "AA-01".
 */

/** Lower-case, NFC-normalised, single-spaced text */
export function normalizeSearch(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('th-TH').replace(/\s+/g, ' ').trim();
}

/** Text without spaces and code separators, so "AA 01", "AA-01" and "aa01" compare equal */
const compact = (text: string) => text.replace(/[\s\-_/.]+/g, '');

/** Words of a query; empty when the query is blank */
export function searchTokens(query: string): string[] {
  const q = normalizeSearch(query);
  return q ? q.split(' ') : [];
}

/** True when every word of the query appears somewhere in the text (a blank query matches all). */
export function matchesSearch(text: string, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const hay = normalizeSearch(text);
  const hayCompact = compact(hay);
  return tokens.every((t) => hay.includes(t) || (compact(t) !== '' && hayCompact.includes(compact(t))));
}

/**
 * Rank of a match for sorting suggestions: 0 when the text starts with the query (a code typed
 * from its start), 1 when a word starts with it, 2 for any other match.
 */
export function searchRank(text: string, query: string): number {
  const q = normalizeSearch(query);
  if (!q) return 2;
  const hay = normalizeSearch(text);
  if (hay.startsWith(q) || compact(hay).startsWith(compact(q))) return 0;
  if (hay.split(' ').some((w) => w.startsWith(q))) return 1;
  return 2;
}

/** The entries whose text matches the query, best matches first (stable within a rank). */
export function filterBySearch<T>(list: readonly T[], query: string, text: (item: T) => string): T[] {
  if (searchTokens(query).length === 0) return [...list];
  return list
    .map((item, i) => ({ item, i, t: text(item) }))
    .filter((x) => matchesSearch(x.t, query))
    .map((x) => ({ ...x, r: searchRank(x.t, query) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}
