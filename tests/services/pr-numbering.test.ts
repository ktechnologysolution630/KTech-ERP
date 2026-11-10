import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { projects, prs } from '@/db/schema';
import { D } from '@/domain/money';
import { createPr } from '@/server/services/pr';

const line = { description: 'ปูน', unitName: 'ถุง', qty: D(1), estUnitPrice: null, neededDate: '2026-11-15', note: '' };

describe('PR numbers', () => {
  test('run per project as PR-<project code>-0001', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const a1 = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    const a2 = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    const b1 = await createPr(db, f.users.owner, { projectId: f.projectB, lines: [line] });
    expect([a1.number, a2.number, b1.number]).toEqual(['PR-PJ-001-0001', 'PR-PJ-001-0002', 'PR-PJ-002-0001']);
  });

  test('a number already used by an older PR is skipped', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const first = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    // An older document already holds the next number (e.g. after the code was renamed and back)
    await db.update(prs).set({ number: 'PR-PJ-001-0002' }).where(eq(prs.id, first.id));
    const next = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    expect(next.number).toBe('PR-PJ-001-0003');
  });

  test('a renamed project code is used from then on, keeping the sequence', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    await db.update(projects).set({ code: 'K68-007' }).where(eq(projects.id, f.projectA));
    const next = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    expect(next.number).toBe('PR-K68-007-0002');
  });
});
