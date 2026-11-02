import { D, round2, type Decimal } from './money';
import { type PoPaymentType } from '@/db/schema/po';

export interface SummarizePoInput {
  poGross: Decimal;
  payablesGross: Decimal;
  taxInvoiceGross: Decimal;
  matchedGross: Decimal;
  pvPendingGross: Decimal;
  pvApprovedGross: Decimal;
  paidGross: Decimal;
  receivedGross: Decimal;
  orderedQtyTotal: Decimal;
  receivedQtyTotal: Decimal;
  paymentType: PoPaymentType;
  installments: { name: string; amount: Decimal; status: string }[];
  refundDue: Decimal;
}

export type ReceiveStatus = 'NONE' | 'PARTIAL' | 'FULL';
export type PayStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface PoSummary {
  poGross: Decimal;
  receivedGross: Decimal;
  payablesGross: Decimal;
  pvApprovedGross: Decimal;
  paidGross: Decimal;
  remainingToPay: Decimal;
  receiveStatus: ReceiveStatus;
  payStatus: PayStatus;
  paidNotReceived: boolean;
  paidNotReceivedAmount: Decimal;
  missingTaxInvoice: boolean;
  refundDue: Decimal;
  installments: { name: string; amount: Decimal; status: string }[];
  labels: string[];
}

export function summarizePo(f: SummarizePoInput): PoSummary {
  const poGross = round2(f.poGross);
  const receivedGross = round2(f.receivedGross);
  const payablesGross = round2(f.payablesGross);
  const pvApprovedGross = round2(f.pvApprovedGross);
  const paidGross = round2(f.paidGross);
  const taxInvoiceGross = round2(f.taxInvoiceGross);
  const refundDue = round2(f.refundDue);

  const rawRemaining = round2(poGross.minus(paidGross));
  const remainingToPay = rawRemaining.gt(0) ? rawRemaining : D(0);

  let receiveStatus: ReceiveStatus;
  if (f.receivedQtyTotal.lte(0)) {
    receiveStatus = 'NONE';
  } else if (f.orderedQtyTotal.gt(0) && f.receivedQtyTotal.gte(f.orderedQtyTotal)) {
    receiveStatus = 'FULL';
  } else {
    receiveStatus = 'PARTIAL';
  }

  let payStatus: PayStatus;
  if (paidGross.lte(0)) {
    payStatus = 'UNPAID';
  } else if (poGross.gt(0) && paidGross.gte(poGross)) {
    payStatus = 'PAID';
  } else {
    payStatus = 'PARTIAL';
  }

  const paidNotReceived = paidGross.gt(receivedGross);
  const paidNotReceivedAmount = paidNotReceived
    ? round2(paidGross.minus(receivedGross))
    : D(0);

  const missingTaxInvoice = paidGross.gt(taxInvoiceGross);

  const labels: string[] = [];
  if (receiveStatus === 'NONE') labels.push('รอรับของ');
  else if (receiveStatus === 'PARTIAL') labels.push('รับบางส่วน');
  else labels.push('รับครบ');

  if (payStatus === 'UNPAID') labels.push('ยังไม่จ่าย');
  else if (payStatus === 'PARTIAL') labels.push('จ่ายบางส่วน');
  else labels.push('จ่ายครบ');

  if (paidNotReceived) labels.push('จ่ายแล้ว ของยังไม่มา');
  if (missingTaxInvoice) labels.push('ยังไม่ได้ใบกำกับภาษี');
  if (refundDue.gt(0)) labels.push('รอคืนเงินจากผู้ขาย');

  return {
    poGross,
    receivedGross,
    payablesGross,
    pvApprovedGross,
    paidGross,
    remainingToPay,
    receiveStatus,
    payStatus,
    paidNotReceived,
    paidNotReceivedAmount,
    missingTaxInvoice,
    refundDue,
    installments: f.installments,
    labels,
  };
}
