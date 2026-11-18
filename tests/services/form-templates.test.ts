import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, test } from 'vitest';
import { type Db } from '@/db/client';
import * as schema from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { COMPANY_NAME_EN } from '@/domain/brand';
import { labelSigners, resolveFormText } from '@/domain/form-templates';
import { D } from '@/domain/money';
import { getFormTemplates, resetFormText, saveFormHeader, saveFormText } from '@/server/services/form-templates';
import { renderDocPdf } from '@/server/services/pdf';
import { createPo } from '@/server/services/po';
import { createPr } from '@/server/services/pr';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { pdfText } from '../helpers/pdf-text';

const blank = { titleTh: '', titleEn: '', signatureLabels: [], footerNote: '' };

describe('form templates', () => {
  test('a form nobody changed prints the words in the code', async () => {
    const db = await createTestDb();
    const t = await getFormTemplates(db);
    expect(t.texts.PO).toEqual({ titleTh: 'ใบสั่งซื้อ', titleEn: 'Purchase Order', signatureLabels: ['ผู้จัดซื้อ', 'ผู้จัดการแผนกจัดซื้อ', 'ผู้มีอำนาจลงนาม'], footerNote: '', hiddenFields: [] });
    expect(t.texts.PR_LABOR.signatureLabels).toEqual(['ผู้ขอจ้าง / ผู้จัดทำ', 'ผู้จัดการโครงการ (PM)']);
    expect(t.texts.EXP.signatureLabels[2]).toBe('ผู้รับเงิน');
    expect(t.header).toEqual({ companyNameEn: COMPANY_NAME_EN, phone: '', email: '' });
    expect(t.saved).toEqual({});
  });

  test('the owner changes one form; the others keep their words', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveFormText(db, f.users.owner, 'PO', {
      titleTh: '  ใบสั่งซื้อ/สั่งจ้าง ',
      titleEn: '',
      signatureLabels: ['', 'หัวหน้าจัดซื้อ', 'ผู้มีอำนาจลงนาม'],
      footerNote: 'กรุณาแนบสำเนา PO มากับใบส่งของ',
    });
    const t = await getFormTemplates(db);
    expect(t.texts.PO).toEqual({
      titleTh: 'ใบสั่งซื้อ/สั่งจ้าง',
      titleEn: 'Purchase Order',
      signatureLabels: ['ผู้จัดซื้อ', 'หัวหน้าจัดซื้อ', 'ผู้มีอำนาจลงนาม'],
      footerNote: 'กรุณาแนบสำเนา PO มากับใบส่งของ',
      hiddenFields: [],
    });
    // Blank fields and words equal to the default are not stored, so they follow the code
    expect(t.saved.PO).toEqual({ titleTh: 'ใบสั่งซื้อ/สั่งจ้าง', signatureLabels: ['', 'หัวหน้าจัดซื้อ', ''], footerNote: 'กรุณาแนบสำเนา PO มากับใบส่งของ' });
    expect(t.texts.QT).toEqual(resolveFormText('QT'));
    expect(t.texts.PR_GOODS.titleTh).toBe('ใบขอซื้อ');
  });

  test('reset puts the form back to its defaults', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveFormText(db, f.users.admin, 'QT', { ...blank, titleTh: 'ใบเสนอราคางานติดตั้ง', footerNote: 'ราคานี้ยืนยันได้ 30 วัน' });
    expect((await getFormTemplates(db)).texts.QT.titleTh).toBe('ใบเสนอราคางานติดตั้ง');
    await resetFormText(db, f.users.admin, 'QT');
    const t = await getFormTemplates(db);
    expect(t.texts.QT).toEqual(resolveFormText('QT'));
    expect(t.saved.QT).toBeUndefined();
  });

  test('only the owner or an admin may change the forms, within the form’s boxes', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(saveFormText(db, f.users.buyer, 'PO', { ...blank, titleTh: 'x' })).rejects.toThrow(DomainError);
    await expect(resetFormText(db, f.users.foreman, 'PO')).rejects.toThrow(DomainError);
    await expect(saveFormHeader(db, f.users.finance, { companyNameEn: '', phone: '', email: '' })).rejects.toThrow(DomainError);
    // The printed requisition has two boxes
    await expect(saveFormText(db, f.users.owner, 'PR_GOODS', { ...blank, signatureLabels: ['a', 'b', 'c'] })).rejects.toThrow('2 ช่อง');
    await expect(saveFormText(db, f.users.owner, 'PO', { ...blank, titleTh: 'ก'.repeat(81) })).rejects.toThrow('ยาวเกิน');
  });

  test('the letterhead lines are shared by every form', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(saveFormHeader(db, f.users.owner, { companyNameEn: '', phone: '', email: 'not-an-email' })).rejects.toThrow('อีเมล');
    await saveFormHeader(db, f.users.owner, { companyNameEn: 'K TECH CO., LTD.', phone: '02-123-4567', email: 'po@ktech.example' });
    expect((await getFormTemplates(db)).header).toEqual({ companyNameEn: 'K TECH CO., LTD.', phone: '02-123-4567', email: 'po@ktech.example' });
    // Clearing the English name brings back the default
    await saveFormHeader(db, f.users.owner, { companyNameEn: ' ', phone: '02-123-4567', email: '' });
    expect((await getFormTemplates(db)).header).toEqual({ companyNameEn: COMPANY_NAME_EN, phone: '02-123-4567', email: '' });
  });

  test('before the migration has run, forms print their defaults instead of failing', async () => {
    const client = new PGlite();
    await client.waitReady;
    const db = drizzle(client, { schema }) as unknown as Db;
    const t = await getFormTemplates(db);
    expect(t.texts.PO.titleTh).toBe('ใบสั่งซื้อ');
    // Saving says the migration is missing
    const owner = { id: '00000000-0000-0000-0000-000000000001', email: 'o@x', name: 'o', roles: ['OWNER'] } as unknown as Parameters<typeof saveFormText>[1];
    await expect(saveFormText(db, owner, 'PO', { ...blank, titleTh: 'x' })).rejects.toThrow('db:migrate');
    await client.close();
  });

  test('signers take the form’s box names in order', () => {
    const signed = labelSigners([{ label: 'ผู้จัดทำ', name: 'สมชาย' }, { label: 'ผู้อนุมัติ' }], ['ผู้เขียน', 'ผู้ตรวจ']);
    expect(signed).toEqual([{ label: 'ผู้เขียน', name: 'สมชาย' }, { label: 'ผู้ตรวจ' }]);
  });

  test('the printed PO and PR carry the saved words', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveFormText(db, f.users.owner, 'PO', {
      titleTh: 'ใบสั่งซื้อสินค้า',
      titleEn: 'Order Form',
      signatureLabels: ['ผู้ออกใบสั่งซื้อ', '', ''],
      footerNote: 'โปรดระบุเลขที่ใบสั่งซื้อในใบแจ้งหนี้',
    });
    await saveFormHeader(db, f.users.owner, { companyNameEn: 'K TECH TEST CO., LTD.', phone: '02-555-0101', email: '' });

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10), unitPrice: D(107), discount: D(0) }],
    });
    const poText = await pdfText(await renderDocPdf(db, f.users.buyer, 'po', po.id));
    expect(poText).toContain('ใบสั่งซื้อสินค้า');
    expect(poText).toContain('ORDERFORM');
    expect(poText).toContain('ผู้ออกใบสั่งซื้อ');
    expect(poText).toContain('ผู้จัดการแผนกจัดซื้อ');
    expect(poText).toContain('โปรดระบุเลขที่ใบสั่งซื้อในใบแจ้งหนี้');
    expect(poText).toContain('KTECHTESTCO.,LTD.');
    expect(poText).toContain('02-555-0101');

    // The requisition was not changed and keeps its own words
    const pr = await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(5) }] });
    const prText = await pdfText(await renderDocPdf(db, f.users.foreman, 'pr', pr.id));
    expect(prText).toContain('ใบขอซื้อ');
    expect(prText).not.toContain('ใบสั่งซื้อสินค้า');
    expect(prText).not.toContain('โปรดระบุเลขที่ใบสั่งซื้อ');
    expect(prText).toContain('KTECHTESTCO.,LTD.');
  });

  test("optional parts are left off one form; only that form's own parts count", async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const saved = await saveFormText(db, f.users.owner, 'PO', { ...blank, hiddenFields: ['quotationNo', 'itemCode', 'quotationNo', 'not-a-field'] });
    expect(saved.hiddenFields).toEqual(['quotationNo', 'itemCode']);
    // The labour requisition names its contractor in full; a reference supplier is not one of its parts
    expect((await saveFormText(db, f.users.owner, 'PR_LABOR', { ...blank, hiddenFields: ['vendor', 'contact'] })).hiddenFields).toEqual(['contact']);
    const t = await getFormTemplates(db);
    expect(t.texts.PO.hiddenFields).toEqual(['quotationNo', 'itemCode']);
    expect(t.texts.PR_GOODS.hiddenFields).toEqual([]);
    // Ticking everything back on stores nothing for it
    await saveFormText(db, f.users.owner, 'PO', { ...blank, hiddenFields: [] });
    expect((await getFormTemplates(db)).saved.PO).toEqual({});
  });

  test('the printed PO and PR leave off the parts ticked off', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10), unitPrice: D(107), discount: D(0) }],
    });
    const before = await pdfText(await renderDocPdf(db, f.users.buyer, 'po', po.id));
    expect(before).toContain('QuotationNo.');
    expect(before).toContain('ContactDelivery');

    await saveFormText(db, f.users.owner, 'PO', { ...blank, hiddenFields: ['quotationNo', 'contact'] });
    const after = await pdfText(await renderDocPdf(db, f.users.buyer, 'po', po.id));
    expect(after).not.toContain('QuotationNo.');
    expect(after).not.toContain('ContactDelivery');
    expect(after).toContain('กำหนดส่งของ');

    await saveFormText(db, f.users.owner, 'PR_GOODS', { ...blank, hiddenFields: ['vendor'] });
    const pr = await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(5) }] });
    const prText = await pdfText(await renderDocPdf(db, f.users.foreman, 'pr', pr.id));
    expect(prText).not.toContain('ซัพพลายเออร์อ้างอิง');
    expect(prText).toContain('ContactDelivery');
  });
});
