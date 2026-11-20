import { describe, expect, test } from 'vitest';
import { apInvoiceLines, arReceiptLines, finishLines, pvLines, salesDocLines } from '@/domain/gl';
import { D } from '@/domain/money';

const view = (lines: { account: string; debit: { toFixed: (n: number) => string }; credit: { toFixed: (n: number) => string } }[]) =>
  lines.map((l) => [l.account, l.debit.toFixed(2), l.credit.toFixed(2)]);

describe('Auto-GL rules', () => {
  test('a credit purchase into stock: Dr inventory + input VAT / Cr AP', () => {
    expect(view(apInvoiceLines({ beforeVat: 10000, vat: 700, gross: 10700, isTaxInvoice: true, toInventory: true }))).toEqual([
      ['INVENTORY', '10000.00', '0.00'],
      ['VAT_INPUT', '700.00', '0.00'],
      ['AP', '0.00', '10700.00'],
    ]);
  });

  test('a bill that is not a tax invoice puts its VAT into the cost', () => {
    expect(view(apInvoiceLines({ beforeVat: 100, vat: 7, gross: 107, isTaxInvoice: false, toInventory: false }))).toEqual([
      ['PURCHASE', '100.00', '0.00'],
      ['PURCHASE', '7.00', '0.00'],
      ['AP', '0.00', '107.00'],
    ]);
  });

  test('a PV clears AP for bills and expenses labour, net of withholding', () => {
    const lines = pvLines({
      payMethod: 'TRANSFER',
      lines: [
        { sourceType: 'CREDIT_INVOICE', beforeVat: 10000, vat: 700, gross: 10700, wht: 0 },
        { sourceType: 'LABOR', beforeVat: 5000, vat: 0, gross: 5000, wht: 150 },
      ],
    });
    expect(view(lines)).toEqual([
      ['AP', '10700.00', '0.00'],
      ['LABOR_COST', '5000.00', '0.00'],
      ['WHT_PAYABLE', '0.00', '150.00'],
      ['BANK', '0.00', '15550.00'],
    ]);
  });

  test('a receipt moves its VAT from not-yet-due to output VAT', () => {
    expect(view(arReceiptLines({ method: 'CASH', amountReceived: 104000, whtAmount: 3000, vat: 7000 }))).toEqual([
      ['CASH', '104000.00', '0.00'],
      ['WHT_RECEIVABLE', '3000.00', '0.00'],
      ['AR', '0.00', '107000.00'],
      ['VAT_OUTPUT_UNDUE', '7000.00', '0.00'],
      ['VAT_OUTPUT', '0.00', '7000.00'],
    ]);
  });

  test('a cash sale with withholding and retention balances; a quotation posts nothing', () => {
    const rc = salesDocLines({ kind: 'RC', payMethod: 'TRANSFER', beforeVat: 10000, vat: 700, total: 10700, wht: 300, retention: 500, payable: 9900 })!;
    expect(view(rc)).toEqual([
      ['BANK', '9900.00', '0.00'],
      ['WHT_RECEIVABLE', '300.00', '0.00'],
      ['RETENTION_AR', '500.00', '0.00'],
      ['SALES', '0.00', '10000.00'],
      ['VAT_OUTPUT', '0.00', '700.00'],
    ]);
    expect(salesDocLines({ kind: 'QT', payMethod: null, beforeVat: 1, vat: 0, total: 1, wht: 0, retention: 0, payable: 1 })).toBeNull();
  });

  test('an entry that does not balance is refused', () => {
    expect(() => finishLines([{ account: 'AR', debit: D(1), credit: D(0) }])).toThrow(/ไม่สมดุล/);
  });
});
