import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Db } from '@/db/client';
import type { SessionUser } from '@/db/schema';

// A thrown error from a server action reaches the browser as "React error #441" on production,
// so the receive action has to hand its message back instead.
const ctx = vi.hoisted(() => ({ db: null as unknown, actor: null as unknown }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/db/client', () => ({ getDb: vi.fn(async () => ctx.db) }));
vi.mock('@/server/auth/current-user', () => ({ requireWriter: vi.fn(async () => ctx.actor) }));

import { createReceiptAction } from '@/app/(app)/receive/actions';
import { D } from '@/domain/money';
import { approvePo, createPo, getPo, reviewPo, submitPo } from '@/server/services/po';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

describe('createReceiptAction', () => {
  let db: Db;
  let f: Awaited<ReturnType<typeof seedBasics>>;
  let poId: string;
  let poLineId: string;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'เหล็กเส้น', unitName: 'เส้น', qty: D(10), unitPrice: D(200), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await reviewPo(db, f.users.buyerHead, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    poId = po.id;
    poLineId = (await getPo(db, f.users.buyer, po.id)).lines[0].id;
    ctx.db = db;
    ctx.actor = f.users.foreman satisfies SessionUser;
  });

  test('receives the goods and hands back the receipt', async () => {
    const res = await createReceiptAction({ poId, receivedAt: '2026-11-18', lines: [{ poLineId, qty: '10' }] });
    expect(res).toMatchObject({ ok: true, receiptId: expect.any(String) });
  });

  test('a PO already received in full gives the reason, not a thrown error', async () => {
    await createReceiptAction({ poId, receivedAt: '2026-11-18', lines: [{ poLineId, qty: '10' }] });

    // The receive page of a PO with nothing left sends no lines
    const res = await createReceiptAction({ poId, receivedAt: '2026-11-18', lines: [] });
    expect(res).toEqual({ ok: false, error: 'ต้องมีรายการรับของอย่างน้อย 1 รายการ' });
  });

  test('receiving more than was ordered gives the reason, not a thrown error', async () => {
    const res = await createReceiptAction({ poId, receivedAt: '2026-11-18', lines: [{ poLineId, qty: '11' }] });
    expect(res).toEqual({ ok: false, error: 'รับเกินจำนวนที่สั่ง' });
  });
});
