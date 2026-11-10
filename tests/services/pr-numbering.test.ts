import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { projects, prs } from '@/db/schema';
import { D } from '@/domain/money';
import { docPeriod } from '@/domain/thai';
import { createPr } from '@/server/services/pr';
import { nextProjectDocNumber } from '@/server/services/numbering';

const line = { description: 'ปูน', unitName: 'ถุง', qty: D(1), estUnitPrice: null, neededDate: '2026-11-15', note: '' };
/** Two-digit month of "now" in Bangkok, as PR numbers carry it */
const mm = () => docPeriod(new Date()).slice(2);
const never = async () => false;

describe('PR numbers', () => {
  test('run per project as PR-<project code>-<month><001>', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const a1 = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    const a2 = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    const b1 = await createPr(db, f.users.owner, { projectId: f.projectB, lines: [line] });
    expect([a1.number, a2.number, b1.number]).toEqual([`PR-PJ-001-${mm()}001`, `PR-PJ-001-${mm()}002`, `PR-PJ-002-${mm()}001`]);
  });

  test('a new month starts again at 001, and the same month next year is its own sequence', async () => {
    const db = await createTestDb();
    const project = { id: '00000000-0000-4000-8000-000000000001', code: 'K68-007' };
    const at = (iso: string) => new Date(iso);
    // 30 Nov 23:30 in Bangkok is still November
    expect(await nextProjectDocNumber(db, 'PR', project, never, at('2026-11-10T03:00:00Z'))).toBe('PR-K68-007-11001');
    expect(await nextProjectDocNumber(db, 'PR', project, never, at('2026-11-30T16:30:00Z'))).toBe('PR-K68-007-11002');
    // 1 Dec 00:30 in Bangkok (still 30 Nov in UTC) is December
    expect(await nextProjectDocNumber(db, 'PR', project, never, at('2026-11-30T17:30:00Z'))).toBe('PR-K68-007-12001');
    expect(await nextProjectDocNumber(db, 'PR', project, never, at('2027-11-05T03:00:00Z'))).toBe('PR-K68-007-11001');
  });

  test('a number already used by an older PR is skipped', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const first = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    await db.update(prs).set({ number: `PR-PJ-001-${mm()}002` }).where(eq(prs.id, first.id));
    const next = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    expect(next.number).toBe(`PR-PJ-001-${mm()}003`);
  });

  test('a renamed project code is used from then on, keeping the sequence', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    await db.update(projects).set({ code: 'K68-007' }).where(eq(projects.id, f.projectA));
    const next = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    expect(next.number).toBe(`PR-K68-007-${mm()}002`);
  });
});
