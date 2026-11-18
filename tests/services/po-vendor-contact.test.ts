import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { vendors } from '@/db/schema';
import { D } from '@/domain/money';
import { listActivity } from '@/server/services/activity';
import { createPo, updatePo, type PoInput } from '@/server/services/po';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('the vendor contact typed on a PO', () => {
  test('is kept in the vendor register; an unchanged or missing one leaves it alone', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const contactOf = async () => (await db.select({ c: vendors.contactPerson }).from(vendors).where(eq(vendors.id, f.vendorCo)))[0]!.c;
    const before = await contactOf();
    const input: PoInput = {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10), unitPrice: D(107), discount: D(0) }],
    };

    // Left out, as by callers that do not show the field
    const po = await createPo(db, f.users.buyer, input);
    expect(await contactOf()).toBe(before);

    await updatePo(db, f.users.buyer, po.id, { ...input, vendorContact: '  คุณสมศรี ฝ่ายขาย ' });
    expect(await contactOf()).toBe('คุณสมศรี ฝ่ายขาย');
    const changes = (await listActivity(db, 'VENDOR', f.vendorCo)).filter((a) => a.action === 'UPDATE');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.note).toContain('คุณสมศรี ฝ่ายขาย');

    // The same name again is not a change
    await createPo(db, f.users.buyer, { ...input, vendorContact: 'คุณสมศรี ฝ่ายขาย' });
    expect((await listActivity(db, 'VENDOR', f.vendorCo)).filter((a) => a.action === 'UPDATE')).toHaveLength(1);

    // Cleared on the form, cleared in the register
    await updatePo(db, f.users.buyer, po.id, { ...input, vendorContact: '' });
    expect(await contactOf()).toBe('');
  });
});
