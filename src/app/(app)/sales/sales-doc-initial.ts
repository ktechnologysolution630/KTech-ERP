import { type SalesVatMode } from '@/domain/sales-doc';

/** One row of the sales form: an item, or an area heading over the items under it */
export interface SalesDocFormLine {
  isSection: boolean;
  name: string;
  detail: string;
  qty: string;
  unit: string;
  unitPrice: string;
  /** ส่วนลดรายบรรทัด in baht, blank for none */
  discount: string;
  /** The stock item the line sells, blank for a service or free text line */
  stockItemId: string;
}

export type SalesPayMethod = 'TRANSFER' | 'CASH' | 'CHEQUE' | 'PROMPTPAY' | 'CARD';

/** What the sales form starts from when it opens a saved document */
export interface SalesDocFormInitial {
  docDate: string;
  dueDate: string;
  reference: string;
  /** The customer, or for a payment voucher the vendor, picked from the list */
  partyId: string;
  party: { name: string; taxId: string; branch: string; address: string; contact: string; phone: string; email: string };
  projectId: string;
  milestone: string;
  accountCategory: string;
  lines: SalesDocFormLine[];
  notes: string;
  vatMode: SalesVatMode;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: string;
  whtRate: string;
  payMethod: SalesPayMethod;
  accountId: string;
  retentionRate: string;
  bank: string;
  bankBranch: string;
  accountName: string;
  accountNo: string;
}

/**
 * How the form is used: a new document, a quotation or voucher changed in place, or a tax document
 * issued again in place of the one being corrected
 */
export type SalesDocFormMode =
  | { type: 'create' }
  | { type: 'edit'; id: string; number: string }
  | { type: 'reissue'; replacesId: string; number: string }
  /** A new document filled from a quotation or sales order (QT → SO → TI) */
  | { type: 'convert'; sourceId: string; number: string; sourceLabel: string };

/** A stored amount as the form types it: blank for nothing, no trailing zeros */
const typed = (v: string | null | undefined) => (v && Number(v) !== 0 ? String(Number(v)) : '');

/** The form's starting values from a saved document */
export function salesDocFormInitial(doc: {
  kind: string;
  docDate: string;
  dueDate: string | null;
  reference: string;
  customerId: string | null;
  vendorId: string | null;
  customerName: string;
  customerTaxId: string;
  customerBranch: string;
  customerAddress: string;
  contactName: string;
  phone: string;
  email: string;
  projectId: string | null;
  milestone: string;
  accountCategory: string;
  vatMode: SalesVatMode;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: string;
  whtRate: string;
  payMethod: SalesPayMethod | null;
  accountId: string | null;
  retentionRate: string;
  bank: string;
  bankBranch: string;
  accountName: string;
  accountNo: string;
  notes: string;
  lines: { isSection: boolean; name: string; detail: string; qty: string; unit: string; unitPrice: string; discount?: string; stockItemId?: string | null }[];
}): SalesDocFormInitial {
  return {
    docDate: doc.docDate,
    dueDate: doc.dueDate ?? '',
    reference: doc.reference,
    partyId: (doc.kind === 'EXP' ? doc.vendorId : doc.customerId) ?? '',
    party: {
      name: doc.customerName,
      taxId: doc.customerTaxId,
      branch: doc.customerBranch,
      address: doc.customerAddress,
      contact: doc.contactName,
      phone: doc.phone,
      email: doc.email,
    },
    projectId: doc.projectId ?? '',
    milestone: doc.milestone,
    accountCategory: doc.accountCategory,
    lines: doc.lines.map((l) => ({
      isSection: l.isSection,
      name: l.name,
      detail: l.detail,
      qty: l.isSection ? '' : String(Number(l.qty)),
      unit: l.unit,
      unitPrice: l.isSection ? '' : typed(l.unitPrice),
      discount: l.isSection ? '' : typed(l.discount),
      stockItemId: l.stockItemId ?? '',
    })),
    notes: doc.notes,
    vatMode: doc.vatMode,
    discountType: doc.discountType,
    discountValue: typed(doc.discountValue),
    whtRate: typed(doc.whtRate),
    payMethod: doc.payMethod ?? 'TRANSFER',
    accountId: doc.accountId ?? '',
    retentionRate: typed(doc.retentionRate),
    bank: doc.bank,
    bankBranch: doc.bankBranch,
    accountName: doc.accountName,
    accountNo: doc.accountNo,
  };
}
