import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { summarizePo, type SummarizePoInput } from '@/domain/po-summary';

const base: SummarizePoInput = {
  poGross: D(1070),
  payablesGross: D(1070),
  taxInvoiceGross: D(1070),
  matchedGross: D(1070),
  pvPendingGross: D(0),
  pvApprovedGross: D(0),
  paidGross: D(0),
  receivedGross: D(0),
  orderedQtyTotal: D(100),
  receivedQtyTotal: D(0),
  paymentType: 'PREPAID',
  installments: [],
  refundDue: D(0),
};

describe('summarizePo', () => {
  test('prepaid paid, nothing received → paidNotReceived & missingTaxInvoice', () => {
    const s = summarizePo({
      ...base,
      paidGross: D(1070),
      receivedGross: D(0),
      taxInvoiceGross: D(0),
    });
    expect(s).toMatchObject({
      paidNotReceived: true,
      missingTaxInvoice: true,
      payStatus: 'PAID',
      receiveStatus: 'NONE',
    });
    expect(s.paidNotReceivedAmount.toFixed(2)).toBe('1070.00');
    expect(s.remainingToPay.toFixed(2)).toBe('0.00');
  });

  test('credit received partially, unpaid', () => {
    const s = summarizePo({
      ...base,
      paymentType: 'CREDIT',
      receivedQtyTotal: D(40),
      orderedQtyTotal: D(100),
      receivedGross: D(428),
      paidGross: D(0),
    });
    expect(s).toMatchObject({
      receiveStatus: 'PARTIAL',
      payStatus: 'UNPAID',
      paidNotReceived: false,
    });
    expect(s.remainingToPay.toFixed(2)).toBe('1070.00');
  });

  test('installment deposit 20% paid during production shows label', () => {
    const s = summarizePo({
      ...base,
      paymentType: 'INSTALLMENT',
      paidGross: D(214),
      receivedGross: D(0),
      installments: [
        { name: 'มัดจำ 20%', amount: D(214), status: 'PAID' },
        { name: 'ก่อนส่ง 80%', amount: D(856), status: 'PENDING' },
      ],
    });
    expect(s.payStatus).toBe('PARTIAL');
    expect(s.paidNotReceived).toBe(true);
    expect(s.labels).toContain('รับบางส่วน'.includes('xx') ? '' : 'รอรับของ');
    expect(s.labels).toContain('จ่ายบางส่วน');
    expect(s.labels).toContain('จ่ายแล้ว ของยังไม่มา');
  });

  test('WHT does not make a fully paid PO look partial', () => {
    // paidGross is gross including WHT (e.g. gross 1070, WHT 30, net 1040 -> paidGross = 1070)
    const s = summarizePo({
      ...base,
      receivedQtyTotal: D(100),
      orderedQtyTotal: D(100),
      receivedGross: D(1070),
      paidGross: D(1070),
      taxInvoiceGross: D(1070),
    });
    expect(s.payStatus).toBe('PAID');
    expect(s.receiveStatus).toBe('FULL');
    expect(s.remainingToPay.toFixed(2)).toBe('0.00');
    expect(s.paidNotReceived).toBe(false);
    expect(s.missingTaxInvoice).toBe(false);
  });
});
