import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  createPr,
  updatePr,
  submitPr,
  approvePr,
  rejectPr,
  cancelPr,
  closePr,
  getPr,
  listPrs,
} from '@/server/services/pr';
import { listActivity } from '@/server/services/activity';
import { D } from '@/domain/money';
import { DomainError } from '@/domain/errors';

describe('PR service', () => {
  const sampleLine = {
    description: 'ปูนซีเมนต์ปอร์ตแลนด์',
    unitName: 'ถุง',
    qty: D(100),
    estUnitPrice: D(150),
    neededDate: '2026-11-15',
    note: 'เทพื้นชั้น 1',
  };

  test('foreman creates, PM approves', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    expect(pr.number).toMatch(/^PR-\d{4}-\d{4}$/);
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const got = await getPr(db, f.users.pm, pr.id);
    expect(got.status).toBe('APPROVED');
    expect(got.lines[0].remainingQty.toString()).toBe('100');
    expect(got.orderProgress).toBe('NONE');
  });

  test('foreman cannot create PR in other project', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      createPr(db, f.users.foreman, {
        projectId: f.projectB,
        lines: [sampleLine],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('reject requires reason, keeps number and history on resubmit', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await expect(rejectPr(db, f.users.pm, pr.id, ' ')).rejects.toThrow(DomainError);

    await rejectPr(db, f.users.pm, pr.id, 'จำนวนเกิน');
    await updatePr(db, f.users.foreman, pr.id, {
      lines: [{ ...sampleLine, qty: D(5) }],
    });
    await submitPr(db, f.users.foreman, pr.id);

    const got = await getPr(db, f.users.pm, pr.id);
    expect(got.number).toBe(pr.number);
    expect(got.status).toBe('SUBMITTED');
    expect(got.lines[0].qty).toBe('5.000');

    const acts = await listActivity(db, 'PR', pr.id);
    expect(acts.map((a) => a.action)).toEqual([
      'submit',
      'update',
      'reject',
      'submit',
      'create',
    ]);
  });

  test('submitting or creating a PR with zero lines fails, cancel and close work', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      createPr(db, f.users.foreman, { projectId: f.projectA, lines: [] }),
    ).rejects.toThrow(DomainError);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    await closePr(db, f.users.pm, pr.id);
    expect((await getPr(db, f.users.pm, pr.id)).status).toBe('CLOSED');

    const pr2 = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    await cancelPr(db, f.users.foreman, pr2.id);
    expect((await getPr(db, f.users.foreman, pr2.id)).status).toBe('CANCELLED');

    const listForForeman = await listPrs(db, f.users.foreman, {});
    expect(listForForeman.length).toBe(2);
    const listForOther = await listPrs(db, f.users.otherForeman, {});
    expect(listForOther.length).toBe(0);
  });
});
