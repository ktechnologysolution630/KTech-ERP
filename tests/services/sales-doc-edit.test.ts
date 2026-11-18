import { describe, expect, test } from 'vitest';
import { listActivity } from '@/server/services/activity';
import { cancelSalesDoc, createSalesDoc, getSalesDoc, listSalesDocs, updateSalesDoc, type SalesDocInput } from '@/server/services/sales-docs';
import { salesDocFormInitial } from '@/app/(app)/sales/sales-doc-initial';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

const quotation: SalesDocInput = {
  kind: 'QT',
  docDate: '2026-11-10',
  dueDate: '2026-12-10',
  customerName: 'บริษัท ลูกค้า จำกัด',
  vatMode: 'EXCLUSIVE',
  lines: [
    { isSection: true, name: 'ห้องโถง' },
    { name: 'ปูกระเบื้อง', qty: 20, unit: 'ตร.ม.', unitPrice: 350 },
  ],
};

const taxInvoice: SalesDocInput = {
  kind: 'TI',
  docDate: '2026-11-12',
  customerName: 'บริษัท ลูกค้า จำกัด',
  customerTaxId: '0105500000001',
  vatMode: 'EXCLUSIVE',
  lines: [{ name: 'งานติดตั้งระบบไฟฟ้า', qty: 1, unit: 'งาน', unitPrice: 10000 }],
};

describe('editing sales documents', () => {
  test('a quotation is changed in place: same number, lines and totals replaced', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const qt = await createSalesDoc(db, f.users.finance, quotation);
    const updated = await updateSalesDoc(db, f.users.finance, qt.id, {
      ...quotation,
      notes: 'ราคานี้รวมค่าแรง',
      discountType: 'AMOUNT',
      discountValue: 1000,
      lines: [{ name: 'ปูกระเบื้อง', qty: 30, unit: 'ตร.ม.', unitPrice: 350 }],
    });
    expect(updated.number).toBe(qt.number);
    const doc = await getSalesDoc(db, f.users.finance, qt.id);
    // 30 × 350 = 10,500 less 1,000 = 9,500 + VAT 665
    expect(doc).toMatchObject({ status: 'ISSUED', subtotal: '10500.00', discount: '1000.00', vat: '665.00', total: '10165.00', notes: 'ราคานี้รวมค่าแรง' });
    expect(doc.lines.map((l) => [l.name, l.qty, l.amount])).toEqual([['ปูกระเบื้อง', '30.000', '10500.00']]);
    expect((await listActivity(db, 'SALES_DOC', qt.id)).map((a) => a.action)).toContain('UPDATE');
    expect(await listSalesDocs(db, f.users.finance, 'QT')).toHaveLength(1);
  });

  test('a tax invoice is never written over; issuing a new one cancels the old in the same step', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const ti = await createSalesDoc(db, f.users.finance, taxInvoice);
    await expect(updateSalesDoc(db, f.users.finance, ti.id, taxInvoice)).rejects.toMatchObject({ code: 'INVALID_STATUS' });

    const fixed = await createSalesDoc(db, f.users.finance, { ...taxInvoice, customerName: 'บริษัท ลูกค้าที่ถูกต้อง จำกัด' }, { replacesId: ti.id });
    expect(fixed.number).not.toBe(ti.number);
    const old = await getSalesDoc(db, f.users.finance, ti.id);
    expect(old).toMatchObject({ status: 'CANCELLED', cancelReason: `แก้ไขโดยออกใบใหม่ ${fixed.number}` });
    expect((await getSalesDoc(db, f.users.finance, fixed.id)).customerName).toBe('บริษัท ลูกค้าที่ถูกต้อง จำกัด');
    expect((await listSalesDocs(db, f.users.finance, 'TI')).map((d) => d.number)).toEqual([fixed.number]);

    // The old one is already cancelled, so it cannot be replaced twice
    await expect(createSalesDoc(db, f.users.finance, taxInvoice, { replacesId: ti.id })).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  test('a failed reissue leaves the old document issued', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const ti = await createSalesDoc(db, f.users.finance, taxInvoice);
    await expect(createSalesDoc(db, f.users.finance, { ...taxInvoice, lines: [{ name: '', qty: 1, unitPrice: 1 }] }, { replacesId: ti.id })).rejects.toMatchObject({
      code: 'INVALID_SALES_DOC',
    });
    // Another kind cannot stand in for it either
    await expect(createSalesDoc(db, f.users.finance, { ...quotation }, { replacesId: ti.id })).rejects.toMatchObject({ code: 'INVALID_SALES_DOC' });
    expect((await getSalesDoc(db, f.users.finance, ti.id)).status).toBe('ISSUED');
  });

  test('only finance, the owner or an admin may edit, and never a cancelled document', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const qt = await createSalesDoc(db, f.users.finance, quotation);
    await expect(updateSalesDoc(db, f.users.buyer, qt.id, quotation)).rejects.toMatchObject({ status: 403 });
    await expect(updateSalesDoc(db, f.users.owner, qt.id, { ...quotation, kind: 'INC' })).rejects.toMatchObject({ code: 'INVALID_SALES_DOC' });
    await cancelSalesDoc(db, f.users.finance, qt.id, 'ลูกค้ายกเลิก');
    await expect(updateSalesDoc(db, f.users.owner, qt.id, quotation)).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  test('the edit form opens with the saved values', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const exp = await createSalesDoc(db, f.users.finance, {
      kind: 'EXP',
      docDate: '2026-11-11',
      vendorId: f.vendorCo,
      whtRate: 3,
      retentionRate: 5,
      vatMode: 'NONE',
      lines: [{ name: 'ค่าเช่านั่งร้าน', qty: 2, unit: 'เดือน', unitPrice: 1500 }],
    });
    const initial = salesDocFormInitial(await getSalesDoc(db, f.users.finance, exp.id));
    expect(initial).toMatchObject({
      docDate: '2026-11-11',
      partyId: f.vendorCo,
      whtRate: '3',
      retentionRate: '5',
      discountValue: '',
      vatMode: 'NONE',
      lines: [{ isSection: false, name: 'ค่าเช่านั่งร้าน', qty: '2', unit: 'เดือน', unitPrice: '1500' }],
    });
  });
});
