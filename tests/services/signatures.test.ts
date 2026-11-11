import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { signatureImageProblem, signerLine } from '@/domain/signature';
import { D } from '@/domain/money';
import { poSigners, prSigners } from '@/server/services/doc-signers';
import { renderDocPdf } from '@/server/services/pdf';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { approvePr, createPr, getPr, submitPr } from '@/server/services/pr';
import { deleteMySignature, getMySignature, saveMySignature, signerPeople } from '@/server/services/signatures';

// A real 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('a person\'s own signature', () => {
  test('only a small PNG is kept', () => {
    expect(signatureImageProblem(PNG)).toBeNull();
    expect(signatureImageProblem('data:image/jpeg;base64,/9j/4AAQ')).toBe('ลายเซ็นต้องเป็นรูป PNG');
    expect(signatureImageProblem('data:image/png;base64,PHN2Zz48L3N2Zz4=')).toBe('ไฟล์ลายเซ็นไม่ถูกต้อง');
    expect(signatureImageProblem('data:image/png;base64,iVBORw0KGgo"><script>')).toBe('ไฟล์ลายเซ็นไม่ถูกต้อง');
    expect(signatureImageProblem(`data:image/png;base64,iVBORw0KGgo${'A'.repeat(300 * 1024)}`)).toMatch(/ใหญ่เกินไป/);
  });

  test('set, replaced and removed by its owner, and read for the people who acted on a document', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    expect(await getMySignature(db, f.users.pm)).toBeNull();
    await expect(saveMySignature(db, f.users.pm, 'data:image/gif;base64,R0lGOD')).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });

    await saveMySignature(db, f.users.pm, PNG);
    await saveMySignature(db, f.users.pm, PNG);
    expect((await getMySignature(db, f.users.pm))?.image).toBe(PNG);
    // Each person has their own
    expect(await getMySignature(db, f.users.foreman)).toBeNull();

    const people = await signerPeople(db, [f.users.pm.id, f.users.foreman.id, null, undefined, f.users.pm.id]);
    expect(people.get(f.users.pm.id)).toEqual({ name: f.users.pm.name, image: PNG });
    // No signature yet: the name still stands on the line
    expect(people.get(f.users.foreman.id)).toEqual({ name: f.users.foreman.name, image: null });
    expect((await signerPeople(db, [null])).size).toBe(0);

    // The line is signed once the step has happened, and stays blank until then
    expect(signerLine('ผู้อนุมัติ', people, f.users.pm.id, '2026-11-11')).toEqual({ label: 'ผู้อนุมัติ', name: f.users.pm.name, image: PNG, date: '11 พ.ย. 2569' });
    expect(signerLine('ผู้อนุมัติ', people, null, null)).toEqual({ label: 'ผู้อนุมัติ' });
    expect(signerLine('ผู้จัดทำ', people, f.users.foreman.id, '2026-11-11', false)).toEqual({ label: 'ผู้จัดทำ' });

    await deleteMySignature(db, f.users.pm);
    expect(await getMySignature(db, f.users.pm)).toBeNull();
  });

  test('a document is signed by whoever sent it and whoever approved it, step by step', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveMySignature(db, f.users.foreman, PNG);
    await saveMySignature(db, f.users.pm, PNG);

    const pr = await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10) }] });
    const lines = async () => prSigners(db, await getPr(db, f.users.buyer, pr.id));
    // A draft is signed by nobody
    expect(await lines()).toEqual([{ label: 'ผู้ขอซื้อ / ผู้จัดทำ' }, { label: 'ผู้อนุมัติ' }]);
    const blank = await renderDocPdf(db, f.users.foreman, 'pr', pr.id);

    await submitPr(db, f.users.foreman, pr.id);
    expect(await lines()).toMatchObject([{ label: 'ผู้ขอซื้อ / ผู้จัดทำ', name: f.users.foreman.name, image: PNG }, { label: 'ผู้อนุมัติ' }]);
    expect((await lines())[1]).toEqual({ label: 'ผู้อนุมัติ' });

    await approvePr(db, f.users.pm, pr.id);
    const signed = await lines();
    expect(signed[1]).toMatchObject({ label: 'ผู้อนุมัติ', name: f.users.pm.name, image: PNG });
    expect(signed[1]!.date).toMatch(/^\d{1,2} \S+ 25\d\d$/);

    // The printed form carries the signature pictures
    const pdf = await renderDocPdf(db, f.users.foreman, 'pr', pr.id);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(blank.length);

    // PO: the buyer has no signature yet, so the name stands on the line; the head's signature shows once approved
    await saveMySignature(db, f.users.buyerHead, PNG);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA, vendorId: f.vendorCo, paymentType: 'CREDIT', vatMode: 'EXCLUSIVE', billDiscount: D(0), shipping: D(0),
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10), unitPrice: D(150), discount: D(0) }],
    });
    const poLines = async () => poSigners(db, await getPo(db, f.users.buyer, po.id));
    expect(await poLines()).toEqual([{ label: 'ผู้จัดทำ' }, { label: 'ผู้อนุมัติ' }]);
    await submitPo(db, f.users.buyer, po.id);
    expect(await poLines()).toMatchObject([{ name: f.users.buyer.name, image: null }, { label: 'ผู้อนุมัติ' }]);
    expect((await poLines())[1]).toEqual({ label: 'ผู้อนุมัติ' });
    await approvePo(db, f.users.buyerHead, po.id);
    expect((await poLines())[1]).toMatchObject({ name: f.users.buyerHead.name, image: PNG });
    expect((await renderDocPdf(db, f.users.buyer, 'po', po.id)).subarray(0, 4).toString()).toBe('%PDF');
  });
});
