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

/** Text reduced for "looks alike": no spaces, separators or Thai tone marks */
function skeleton(text: string): string {
  return normalizeSearch(text).replace(/[\s\-_/.,()"'*]+/g, '').replace(/[\u0E48-\u0E4C]/g, '');
}

/** Pairs of neighbouring characters, the usual unit for comparing spellings */
function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/**
 * How alike a query is to a text, 0 to 1. Counts the query's character pairs found in the text,
 * so a typo, a missing tone mark or a different word order still scores, and a short query
 * against a long name is not punished for what it left out.
 */
export function similarity(text: string, query: string): number {
  const q = skeleton(query);
  const t = skeleton(text);
  if (q.length < 2 || t.length < 2) return 0;
  if (t.includes(q)) return 1;
  const pool = new Map<string, number>();
  for (const b of bigrams(t)) pool.set(b, (pool.get(b) ?? 0) + 1);
  const qb = bigrams(q);
  let hit = 0;
  for (const b of qb) {
    const n = pool.get(b) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(b, n - 1);
    }
  }
  const wordsFound = searchTokens(query).filter((w) => w.length >= 2 && normalizeSearch(text).includes(w)).length;
  const wordShare = wordsFound / Math.max(1, searchTokens(query).length);
  return Math.max(hit / qb.length, wordShare * 0.9);
}

/** Least similarity for an entry to be offered as "close to what was typed" */
export const SIMILAR_THRESHOLD = 0.45;

/**
 * Entries that do not match the query outright but look close to it (spelling, part of the words),
 * most alike first. Used under the direct matches as "รายการใกล้เคียง".
 */
export function similarBySearch<T>(list: readonly T[], query: string, text: (item: T) => string, limit = 8): T[] {
  // Two letters are too few to say what looks alike
  if (skeleton(query).length < 3) return [];
  return list
    .map((item) => ({ item, t: text(item) }))
    .filter((x) => !matchesSearch(x.t, query))
    .map((x) => ({ item: x.item, s: similarity(x.t, query) }))
    .filter((x) => x.s >= SIMILAR_THRESHOLD)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}
