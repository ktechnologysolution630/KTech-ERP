import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { pvs, whtCerts } from '@/db/schema';
import { D } from '@/domain/money';
import { listWhtRows } from '@/server/services/accounting';
import { createInvoice } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { renderDocPdf } from '@/server/services/pdf';
import { approvePo, createPo, reviewPo, submitPo } from '@/server/services/po';
import { approvePv, createPv, getPv, markPvPaid, submitPv } from '@/server/services/pv';
import { reissueWhtCert, voidWhtCert } from '@/server/services/wht-cert';
import { createTestDb } from '../helpers/test-db';
import { EARLY_PAY_REASON, receiveAll } from '../helpers/receive';
import { seedBasics } from '../helpers/fixtures';
import { pdfText } from '../helpers/pdf-text';

/** A PO bill paid by transfer through a PV that withholds 3%, so a 50 ทวิ certificate is issued */
async function paidPvWithWht() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  const po = await createPo(db, f.users.buyer, {
    projectId: f.projectA,
    vendorId: f.vendorCo,
    paymentType: 'CREDIT',
    creditDays: 30,
    vatMode: 'EXCLUSIVE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ description: 'ค่าติดตั้งระบบไฟฟ้า', unitName: 'งาน', qty: D(1), unitPrice: D(10000), discount: D(0) }],
  });
  await submitPo(db, f.users.buyer, po.id);
  await reviewPo(db, f.users.buyerHead, po.id);
  await approvePo(db, f.users.buyerHead, po.id);
  await receiveAll(db, f.users.owner, po.id);
  await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-WHT-1', invoiceDate: '2026-11-04', beforeVat: D(10000), vat: D(700) });
  const [payable] = await listOpenPayables(db, f.users.finance, {});
  const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [payable!.id], whtRates: { [payable!.id]: 3 } });
  await submitPv(db, f.users.finance, pv.id);
  await approvePv(db, f.users.owner, pv.id, EARLY_PAY_REASON);
  await markPvPaid(db, f.users.finance, pv.id, { paidAt: '2026-11-05', payMethod: 'TRANSFER' });
  const certId = (await getPv(db, f.users.finance, pv.id)).whtCertId!;
  return { db, f, pv, certId };
}

describe('the PV voucher and its 50 ทวิ certificate', () => {
  test('the printed PV names how it was paid in Thai', async () => {
    const { db, f, pv } = await paidPvWithWht();
    const text = await pdfText(await renderDocPdf(db, f.users.finance, 'pv', pv.id));
    expect(text).toContain('วิธีจ่ายเงิน:โอนเงิน');
    expect(text).not.toContain('TRANSFER');
  });

  test('a certificate is cancelled with a reason, keeps its number, and prints ยกเลิก', async () => {
    const { db, f, certId } = await paidPvWithWht();
    const [issued] = await listWhtRows(db, f.users.finance);
    expect(issued).toMatchObject({ id: certId, status: 'ACTIVE', wht: 300, pvPaid: true, voidReason: null });
    expect(await pdfText(await renderDocPdf(db, f.users.finance, 'wht', certId))).not.toContain('ยกเลิก');

    // Only those who pay vouchers may cancel, and never without a reason
    await expect(voidWhtCert(db, f.users.buyer, certId, 'ผิด')).rejects.toMatchObject({ status: 403 });
    await expect(voidWhtCert(db, f.users.finance, certId, '  ')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

    await voidWhtCert(db, f.users.finance, certId, 'ประเภทเงินได้ผิด');
    const [voided] = await listWhtRows(db, f.users.finance);
    expect(voided).toMatchObject({ id: certId, number: issued!.number, status: 'VOID', voidReason: 'ประเภทเงินได้ผิด', pvPaid: true });
    expect(await pdfText(await renderDocPdf(db, f.users.finance, 'wht', certId))).toContain('ยกเลิก');
    await expect(voidWhtCert(db, f.users.finance, certId, 'อีกครั้ง')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  test('a cancelled certificate of a paid PV is issued again with its own number', async () => {
    const { db, f, certId } = await paidPvWithWht();
    const [issued] = await listWhtRows(db, f.users.finance);
    await expect(reissueWhtCert(db, f.users.finance, certId)).rejects.toMatchObject({ code: 'INVALID_STATUS' });

    await voidWhtCert(db, f.users.owner, certId, 'ออกผิด');
    await expect(reissueWhtCert(db, f.users.buyer, certId)).rejects.toMatchObject({ status: 403 });
    expect(await reissueWhtCert(db, f.users.owner, certId)).toBe(certId);
    const [again] = await listWhtRows(db, f.users.finance);
    expect(again).toMatchObject({ id: certId, number: issued!.number, status: 'ACTIVE', voidReason: null, wht: 300 });
  });

  test('a certificate is not issued again while its PV is not paid', async () => {
    const { db, f, pv, certId } = await paidPvWithWht();
    await voidWhtCert(db, f.users.finance, certId, 'ยกเลิกการจ่าย');
    // As after a voided cheque: the PV waits to be paid again
    await db.update(pvs).set({ status: 'APPROVED' }).where(eq(pvs.id, pv.id));
    expect((await listWhtRows(db, f.users.finance))[0]).toMatchObject({ status: 'VOID', pvPaid: false });
    await expect(reissueWhtCert(db, f.users.finance, certId)).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    const [cert] = await db.select().from(whtCerts).where(eq(whtCerts.id, certId));
    expect(cert!.status).toBe('VOID');
  });
});
