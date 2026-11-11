import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import type { Db } from '@/db/client';
import { notifications, pos } from '@/db/schema';
import { D, type VatMode } from '@/domain/money';
import { lastPriceFor, netUnitPrice, priceIncrease, type LastPurchasePrice } from '@/domain/price-history';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { listLastPurchasePrices, listPoPriceIncreases } from '@/server/services/price-history';

const bought = (over: Partial<LastPurchasePrice> = {}): LastPurchasePrice => ({
  itemId: null, description: 'ปูนซีเมนต์', unitName: 'ถุง', unitPrice: 100, poId: 'po-1', poNumber: 'PO-6911-0001', purchasedOn: '2026-11-01', vendorName: 'ร้าน ก', ...over,
});
const line = (unitPrice: number | string, over: Record<string, unknown> = {}) => ({ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: 10, unitPrice, discount: 0, ...over });

describe('comparing a price with the last purchase', () => {
  test('bought at 100, now 120: twenty baht and twenty percent dearer', () => {
    expect(priceIncrease(line(120), 'EXCLUSIVE', [bought()])).toEqual({ last: bought(), unitPrice: 120, diff: 20, percent: 20 });
  });

  test('the same price, a lower one, or something never bought raises nothing', () => {
    expect(priceIncrease(line(100), 'EXCLUSIVE', [bought()])).toBeNull();
    expect(priceIncrease(line(99.5), 'EXCLUSIVE', [bought()])).toBeNull();
    expect(priceIncrease(line(120, { description: 'ทราย' }), 'EXCLUSIVE', [bought()])).toBeNull();
    expect(priceIncrease(line(120), 'EXCLUSIVE', [])).toBeNull();
  });

  test('a line still being typed raises nothing', () => {
    expect(priceIncrease(line(''), 'EXCLUSIVE', [bought()])).toBeNull();
    expect(priceIncrease(line(120, { qty: '' }), 'EXCLUSIVE', [bought()])).toBeNull();
    expect(priceIncrease(line(120, { description: '  ' }), 'EXCLUSIVE', [bought()])).toBeNull();
    expect(priceIncrease(line('abc'), 'EXCLUSIVE', [bought()])).toBeNull();
  });

  test('the name is matched loosely, the unit exactly: a price per ton is not a price per bag', () => {
    expect(priceIncrease(line(120, { description: '  ปูนซีเมนต์ ' }), 'EXCLUSIVE', [bought()])?.diff).toBe(20);
    expect(priceIncrease(line(4000, { unitName: 'ตัน' }), 'EXCLUSIVE', [bought()])).toBeNull();
  });

  test('a catalogue item is the same thing even when the name on the order was reworded', () => {
    const history = [bought({ itemId: 'item-1', description: 'ปูน ตราเสือ 50 กก.' })];
    expect(priceIncrease(line(120, { itemId: 'item-1', description: 'ปูนซีเมนต์ตราเสือ' }), 'EXCLUSIVE', history)?.percent).toBe(20);
    expect(lastPriceFor({ itemId: 'item-2', description: 'ปูนซีเมนต์ตราเสือ', unitName: 'ถุง' }, history)).toBeNull();
  });

  test('VAT included and the line discount are taken out before comparing', () => {
    // 107 including VAT is the same 100 before it
    expect(priceIncrease(line(107), 'INCLUSIVE', [bought()])).toBeNull();
    expect(priceIncrease(line(128.4), 'INCLUSIVE', [bought()])).toMatchObject({ unitPrice: 120, diff: 20 });
    // 120 a bag with 200 off ten bags is 100 a bag
    expect(priceIncrease(line(120, { discount: 200 }), 'EXCLUSIVE', [bought()])).toBeNull();
    expect(netUnitPrice({ qty: 10, unitPrice: 120, discount: 100 }, 'NONE')?.toNumber()).toBe(110);
    expect(netUnitPrice({ qty: 0, unitPrice: 120 }, 'NONE')).toBeNull();
    expect(netUnitPrice({ qty: 1, unitPrice: 0 }, 'NONE')).toBeNull();
  });

  test('the newest purchase is the one compared with', () => {
    const history = [bought({ unitPrice: 110, poNumber: 'PO-6911-0002' }), bought({ unitPrice: 90 })];
    expect(priceIncrease(line(100), 'EXCLUSIVE', history)).toBeNull();
    expect(priceIncrease(line(115), 'EXCLUSIVE', history)?.last.poNumber).toBe('PO-6911-0002');
  });
});

describe('price history from purchase orders', () => {
  const order = async (db: Db, f: Awaited<ReturnType<typeof seedBasics>>, lines: { description: string; unitName: string; qty: number; unitPrice: number; discount?: number }[], opts: { vatMode?: VatMode; vendorId?: string; approve?: boolean } = {}) => {
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA, vendorId: opts.vendorId ?? f.vendorCo, paymentType: 'CREDIT', vatMode: opts.vatMode ?? 'EXCLUSIVE', billDiscount: D(0), shipping: D(0),
      lines: lines.map((l) => ({ description: l.description, unitName: l.unitName, qty: D(l.qty), unitPrice: D(l.unitPrice), discount: D(l.discount ?? 0) })),
    });
    if (opts.approve !== false) {
      await submitPo(db, f.users.buyer, po.id);
      await approvePo(db, f.users.buyerHead, po.id);
    }
    return po;
  };
  const increasesOf = async (db: Db, f: Awaited<ReturnType<typeof seedBasics>>, id: string) => listPoPriceIncreases(db, await getPo(db, f.users.buyer, id));

  test('an order counts once approved, and the newest one sets the last price', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    expect(await listLastPurchasePrices(db)).toEqual([]);

    const draft = await order(db, f, [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: 10, unitPrice: 100 }], { approve: false });
    // Written but not approved: nothing has been bought yet
    expect(await listLastPurchasePrices(db)).toEqual([]);
    await submitPo(db, f.users.buyer, draft.id);
    expect(await listLastPurchasePrices(db)).toEqual([]);
    await approvePo(db, f.users.buyerHead, draft.id);

    const first = await listLastPurchasePrices(db);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ description: 'ปูนซีเมนต์', unitName: 'ถุง', unitPrice: 100, poId: draft.id, poNumber: draft.number });
    expect(first[0]!.purchasedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first[0]!.vendorName).toBeTruthy();

    // Bought again from the other vendor, VAT included: 128.40 is 120 before VAT
    const second = await order(db, f, [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: 5, unitPrice: 128.4 }, { description: 'ทราย', unitName: 'คิว', qty: 2, unitPrice: 450 }], { vatMode: 'INCLUSIVE', vendorId: f.vendorPerson });
    const latest = await listLastPurchasePrices(db);
    expect(latest.find((h) => h.description === 'ปูนซีเมนต์')).toMatchObject({ unitPrice: 120, poId: second.id });
    expect(latest.find((h) => h.description === 'ทราย')).toMatchObject({ unitPrice: 420.56, poId: second.id });
    expect(latest).toHaveLength(2);

    // Leaving out the order being edited falls back to the one before it
    expect((await listLastPurchasePrices(db, { exceptPoId: second.id })).map((h) => h.poId)).toEqual([draft.id]);
  });

  test('a new order above the last price is pointed out, line by line, against what came before it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const first = await order(db, f, [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: 10, unitPrice: 100 }, { description: 'เหล็กเส้น', unitName: 'เส้น', qty: 20, unitPrice: 250 }]);
    // The first purchase has nothing before it
    expect(await increasesOf(db, f, first.id)).toEqual([]);

    const next = await order(
      db,
      f,
      [
        { description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: 10, unitPrice: 120 },
        { description: 'เหล็กเส้น', unitName: 'เส้น', qty: 20, unitPrice: 250 },
        { description: 'ทราย', unitName: 'คิว', qty: 1, unitPrice: 500 },
      ],
      { approve: false },
    );
    const ups = await increasesOf(db, f, next.id);
    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ description: 'ปูนซีเมนต์', unitName: 'ถุง', unitPrice: 120, diff: 20, percent: 20, last: { unitPrice: 100, poNumber: first.number } });

    // The approver is warned in the notification itself
    await submitPo(db, f.users.buyer, next.id);
    const sent = await db.select().from(notifications).where(eq(notifications.href, `/po/${next.id}`));
    expect(sent.length).toBeGreaterThan(0);
    for (const n of sent) {
      expect(n.title).toContain('มี 1 รายการราคาสูงกว่ารอบที่แล้ว');
      expect(n.level).toBe('WARNING');
    }
    // An order with nothing dearer keeps the plain notice
    const plain = await db.select().from(notifications).where(eq(notifications.href, `/po/${first.id}`));
    expect(plain.some((n) => n.title.includes('ราคาสูงกว่า'))).toBe(false);

    await approvePo(db, f.users.buyerHead, next.id);
    // Looking back at the first order later, the dearer second one is not "last time" for it
    expect(await increasesOf(db, f, first.id)).toEqual([]);
    // And the second is still compared with the first, not with itself
    expect((await increasesOf(db, f, next.id))[0]?.last.poNumber).toBe(first.number);
  });

  test('a cancelled or rejected order is not a purchase', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await order(db, f, [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: 10, unitPrice: 100 }]);
    await db.update(pos).set({ status: 'CANCELLED' }).where(eq(pos.id, po.id));
    expect(await listLastPurchasePrices(db)).toEqual([]);
  });
});
