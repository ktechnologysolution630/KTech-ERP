import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { advanceBalance, clearingStatus } from '@/domain/advance';
import {
  addAdvanceExpense,
  cancelAdvance,
  createReceiptSubstitute,
  decideAdvance,
  decideReceiptSubstitute,
  getAdvance,
  getReceiptSubstitute,
  listAdvances,
  listReceiptSubstitutes,
  payAdvance,
  recordAdvanceReturn,
  removeAdvanceExpense,
  requestAdvance,
  submitReceiptSubstitute,
} from '@/server/services/advances';

describe('advance maths', () => {
  test('outstanding and reimbursable never go negative', () => {
    const under = advanceBalance(10_000, [3_000, 2_000], 1_000);
    expect(under.outstanding.toNumber()).toBe(4_000);
    expect(clearingStatus(under)).toBe('PARTIALLY_CLEARED');
    const over = advanceBalance(10_000, [12_500], 0);
    expect(over.outstanding.toNumber()).toBe(0);
    expect(over.reimbursable.toNumber()).toBe(2_500);
    expect(clearingStatus(over)).toBe('CLEARED');
    expect(clearingStatus(advanceBalance(10_000, [], 0))).toBe('PAID');
  });
});

describe('advance service', () => {
  test('request → approve → pay → clear with expenses and returned cash', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const adv = await requestAdvance(db, f.users.foreman, { projectId: f.projectA, purpose: 'ซื้อวัสดุหน้างาน', amount: 10_000 });
    expect(adv.number).toMatch(/^ADV-\d{4}-0001$/);

    await expect(payAdvance(db, f.users.finance, adv.id)).rejects.toMatchObject({ status: 409 });
    await expect(decideAdvance(db, f.users.foreman, adv.id, true, '')).rejects.toMatchObject({ status: 403 });
    await decideAdvance(db, f.users.owner, adv.id, true, '');
    await payAdvance(db, f.users.finance, adv.id, '2026-11-03');

    await addAdvanceExpense(db, f.users.foreman, adv.id, { description: 'ทราย 2 คิว', amount: 4_000, reference: 'บิล 123' });
    await addAdvanceExpense(db, f.users.foreman, adv.id, { description: 'ค่าขนส่ง', amount: 1_500 });
    let a = await getAdvance(db, f.users.foreman, adv.id);
    expect(a).toMatchObject({ status: 'PARTIALLY_CLEARED', spent: 5_500, outstanding: 4_500, canClear: true });

    await expect(recordAdvanceReturn(db, f.users.finance, adv.id, 5_000)).rejects.toMatchObject({ code: 'OVER_RETURN' });
    await recordAdvanceReturn(db, f.users.finance, adv.id, 4_500);
    a = await getAdvance(db, f.users.finance, adv.id);
    expect(a).toMatchObject({ status: 'CLEARED', outstanding: 0, returned: 4_500 });

    await expect(removeAdvanceExpense(db, f.users.foreman, a.expenses[0].id)).rejects.toMatchObject({ status: 409 });
  });

  test('visibility, self-approval and cancellation rules', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const mine = await requestAdvance(db, f.users.foreman, { purpose: 'เบิกค่าน้ำมัน', amount: 2_000 });
    await requestAdvance(db, f.users.pm, { purpose: 'ค่าเดินทาง', amount: 1_000 });

    expect((await listAdvances(db, f.users.foreman)).rows.map((r) => r.id)).toEqual([mine.id]);
    expect((await listAdvances(db, f.users.finance)).rows).toHaveLength(2);

    const ownerAdv = await requestAdvance(db, f.users.owner, { purpose: 'ของตัวเอง', amount: 500 });
    await expect(decideAdvance(db, f.users.owner, ownerAdv.id, true, '')).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    await expect(decideAdvance(db, f.users.admin, mine.id, false, '')).rejects.toMatchObject({ status: 400 });

    await expect(cancelAdvance(db, f.users.pm, mine.id)).rejects.toMatchObject({ status: 403 });
    await cancelAdvance(db, f.users.foreman, mine.id);
    expect((await getAdvance(db, f.users.foreman, mine.id)).status).toBe('CANCELLED');

    await expect(
      requestAdvance(db, f.users.foreman, { projectId: f.projectB, purpose: 'x', amount: 1 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('approved receipt substitute can clear an advance; unapproved cannot', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const adv = await requestAdvance(db, f.users.foreman, { purpose: 'ค่าแรงรายวัน', amount: 3_000 });
    await decideAdvance(db, f.users.owner, adv.id, true, '');
    await payAdvance(db, f.users.finance, adv.id);

    const rs = await createReceiptSubstitute(db, f.users.foreman, {
      advanceId: adv.id,
      lines: [{ spentOn: '2026-11-02', description: 'ค่าแรงขนย้าย', paidTo: 'นายสมชาย', amount: 3_000 }],
    });
    await expect(
      addAdvanceExpense(db, f.users.foreman, adv.id, { description: 'ค่าแรง', amount: 3_000, evidence: 'SUBSTITUTE', substituteId: rs.id }),
    ).rejects.toMatchObject({ status: 400 });

    const number = await submitReceiptSubstitute(db, f.users.foreman, rs.id);
    expect(number).toMatch(/^RS-/);
    await expect(decideReceiptSubstitute(db, f.users.foreman, rs.id, true, '')).rejects.toMatchObject({ status: 403 });
    await decideReceiptSubstitute(db, f.users.finance, rs.id, true, '');

    await addAdvanceExpense(db, f.users.foreman, adv.id, { description: 'ค่าแรง', amount: 3_000, evidence: 'SUBSTITUTE', substituteId: rs.id });
    const a = await getAdvance(db, f.users.foreman, adv.id);
    expect(a.status).toBe('CLEARED');
    expect(a.expenses[0].substituteNumber).toBe(number);
    expect((await listReceiptSubstitutes(db, f.users.foreman)).rows[0]).toMatchObject({ total: 3_000, status: 'APPROVED' });
  });

  test('receipt substitute detail: visibility and no self-decision', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const line = { spentOn: '2026-11-02', description: 'ค่าขนส่ง', paidTo: 'นายสมชาย', amount: 800 };
    const foremanRs = await createReceiptSubstitute(db, f.users.foreman, { lines: [line] });
    const ownerRs = await createReceiptSubstitute(db, f.users.owner, { lines: [line] });
    await submitReceiptSubstitute(db, f.users.foreman, foremanRs.id);
    await submitReceiptSubstitute(db, f.users.owner, ownerRs.id);

    await expect(getReceiptSubstitute(db, f.users.pm, foremanRs.id)).rejects.toMatchObject({ status: 404 });
    await expect(getReceiptSubstitute(db, f.users.finance, 'not-a-uuid')).rejects.toMatchObject({ status: 404 });
    expect((await listReceiptSubstitutes(db, f.users.foreman)).rows.map((r) => r.id)).toEqual([foremanRs.id]);

    expect(await getReceiptSubstitute(db, f.users.owner, ownerRs.id)).toMatchObject({ canDecide: false, lines: [line] });
    expect(await getReceiptSubstitute(db, f.users.owner, foremanRs.id)).toMatchObject({ canDecide: true, canEdit: false });
    expect(await getReceiptSubstitute(db, f.users.foreman, foremanRs.id)).toMatchObject({ canDecide: false, canCancel: true, status: 'PENDING' });
    expect(await getReceiptSubstitute(db, f.users.foreman, foremanRs.id)).not.toMatchObject({ canEdit: true });
  });
});
