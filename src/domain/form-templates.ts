import { COMPANY_NAME_EN } from './brand';
import { PR_TYPE_META, prSignatures, type PrType } from './pr-type';
import { SALES_DOC_META, type SalesDocKind } from './sales-doc';

/**
 * The words printed on each document form that the owner can change in the settings (/settings/forms):
 * the document's name, the name over each signature box and a note under the boxes. A field left
 * blank prints the default below. Layout, columns and figures stay in code. The 50 ทวิ certificate is
 * a Revenue Department form and is not listed.
 */

export type FormKind =
  | 'PR_GOODS'
  | 'PR_LABOR'
  | 'PR_GOODS_AND_LABOR'
  | 'PV'
  | 'PRV'
  | 'INC'
  | 'EXP'
  | 'PO'
  | 'QT'
  | 'RC'
  | 'TI'
  | 'DN'
  | 'STI';

/** ภายใน: kept inside the company; ภายนอก: handed to a supplier or customer */
export type FormGroup = 'INTERNAL' | 'EXTERNAL';

export const FORM_GROUP_LABEL: Record<FormGroup, string> = { INTERNAL: 'ฟอร์มภายใน', EXTERNAL: 'ฟอร์มภายนอก' };

export interface FormText {
  titleTh: string;
  titleEn: string;
  /** One per signature box, in the order the form prints them */
  signatureLabels: string[];
  /** Printed under the signature boxes; blank prints nothing */
  footerNote: string;
}

/** What the owner saved; a missing or blank field keeps the default */
export interface FormTextOverride {
  titleTh?: string;
  titleEn?: string;
  signatureLabels?: string[];
  footerNote?: string;
}

export interface FormDef {
  kind: FormKind;
  group: FormGroup;
  /** The form's name in the settings list */
  label: string;
  defaults: FormText;
}

/** PURCHASE REQUISITION → Purchase Requisition; the forms print the English name in capitals anyway */
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/ And /g, ' and ');

const prDef = (type: PrType): FormDef => ({
  kind: `PR_${type}`,
  group: 'INTERNAL',
  label: `PR ${PR_TYPE_META[type].titleTh}`,
  defaults: {
    titleTh: PR_TYPE_META[type].titleTh,
    titleEn: titleCase(PR_TYPE_META[type].titleEn),
    // The printed requisition has the person asking and the PM; the owner's approval is not printed
    signatureLabels: [prSignatures(type)[0]!, 'ผู้จัดการโครงการ (PM)'],
    footerNote: '',
  },
});

const salesDef = (kind: SalesDocKind, group: FormGroup, label: string): FormDef => ({
  kind,
  group,
  label,
  defaults: {
    titleTh: SALES_DOC_META[kind].th,
    titleEn: titleCase(SALES_DOC_META[kind].en),
    signatureLabels: ['ผู้จัดทำ', 'ผู้อนุมัติ', kind === 'EXP' ? 'ผู้รับเงิน' : 'ลูกค้า'],
    footerNote: '',
  },
});

export const FORM_DEFS: readonly FormDef[] = [
  prDef('GOODS'),
  prDef('LABOR'),
  prDef('GOODS_AND_LABOR'),
  {
    kind: 'PV',
    group: 'INTERNAL',
    label: 'PV ใบสำคัญจ่าย (จ่ายผู้ขาย)',
    defaults: { titleTh: 'ใบสำคัญจ่าย', titleEn: 'Payment Voucher', signatureLabels: ['ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้รับเงิน'], footerNote: '' },
  },
  {
    kind: 'PRV',
    group: 'INTERNAL',
    label: 'PRV ใบรับรองการขอเบิกเงิน',
    defaults: {
      titleTh: 'ใบรับรองการขอเบิกเงิน',
      titleEn: 'Payment Certificate',
      signatureLabels: ['ผู้ขอเบิก / Site Engineer', 'ผู้ตรวจรับรอง / Project Engineer (PM)', 'ผู้อนุมัติจ่าย / Approved by Owner'],
      footerNote: '',
    },
  },
  salesDef('INC', 'INTERNAL', 'ใบสำคัญรับ (รายรับอื่น)'),
  salesDef('EXP', 'INTERNAL', 'ใบสำคัญจ่าย (ค่าใช้จ่ายจ่ายตรง)'),
  {
    kind: 'PO',
    group: 'EXTERNAL',
    label: 'PO ใบสั่งซื้อ',
    defaults: {
      titleTh: 'ใบสั่งซื้อ',
      titleEn: 'Purchase Order',
      signatureLabels: ['ผู้จัดซื้อ', 'ผู้จัดการแผนกจัดซื้อ', 'ผู้มีอำนาจลงนาม'],
      footerNote: '',
    },
  },
  salesDef('QT', 'EXTERNAL', 'ใบเสนอราคา'),
  salesDef('TI', 'EXTERNAL', 'ใบกำกับภาษี'),
  salesDef('RC', 'EXTERNAL', 'ใบเสร็จรับเงิน'),
  salesDef('DN', 'EXTERNAL', 'ใบเพิ่มหนี้'),
  salesDef('STI', 'EXTERNAL', 'ใบกำกับภาษีอย่างย่อ'),
];

export const FORM_KINDS: readonly FormKind[] = FORM_DEFS.map((d) => d.kind);

export const isFormKind = (v: unknown): v is FormKind => FORM_KINDS.includes(v as FormKind);

export function formDef(kind: FormKind): FormDef {
  return FORM_DEFS.find((d) => d.kind === kind)!;
}

export const prFormKind = (type: PrType): FormKind => `PR_${type}`;

const filled = (v: string | undefined | null): string | null => (v && v.trim() ? v.trim() : null);

/** The words a form prints: what the owner saved, else the default */
export function resolveFormText(kind: FormKind, saved?: FormTextOverride | null): FormText {
  const d = formDef(kind).defaults;
  return {
    titleTh: filled(saved?.titleTh) ?? d.titleTh,
    titleEn: filled(saved?.titleEn) ?? d.titleEn,
    signatureLabels: d.signatureLabels.map((label, i) => filled(saved?.signatureLabels?.[i]) ?? label),
    footerNote: filled(saved?.footerNote) ?? d.footerNote,
  };
}

/** Puts the form's own box names on signers worked out in the system; the boxes keep their order */
export function labelSigners<T extends { label: string }>(signers: T[], labels: readonly string[]): T[] {
  return signers.map((s, i) => ({ ...s, label: labels[i] ?? s.label }));
}

/** The letterhead lines shared by every form, beside the Thai name, address and tax ID in the company settings */
export interface FormHeader {
  companyNameEn: string;
  phone: string;
  email: string;
}

export const DEFAULT_FORM_HEADER: FormHeader = { companyNameEn: COMPANY_NAME_EN, phone: '', email: '' };

export function resolveFormHeader(saved?: Partial<FormHeader> | null): FormHeader {
  return {
    companyNameEn: filled(saved?.companyNameEn) ?? DEFAULT_FORM_HEADER.companyNameEn,
    phone: filled(saved?.phone) ?? '',
    email: filled(saved?.email) ?? '',
  };
}

/** โทร 02-xxx · อีเมล a@b.c, or blank when neither is set */
export function contactLine(h: Pick<FormHeader, 'phone' | 'email'> | null | undefined): string {
  return [h?.phone && `โทร ${h.phone}`, h?.email && `อีเมล ${h.email}`].filter(Boolean).join(' · ');
}
