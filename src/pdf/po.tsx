import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { type PoPaymentType } from '@/db/schema';
import { COMPANY_NAME_EN } from '@/domain/brand';
import { bahtText, D, formatMoneyDisplay, round2, sum, VAT_RATE } from '@/domain/money';
import { CREDIT_BASIS_LABEL, PAY_METHOD_LABEL, describeSchedule } from '@/domain/payment-terms';
import { type Signer } from '@/domain/signature';
import { formatThaiDate } from '@/domain/thai';
import { type getPo } from '@/server/services/po';
import { type Settings } from '@/server/services/settings';
import { companyLogo } from './layout';

/** Where a PO line came from: the requisition and the item code it was bought as; blank when it has neither */
export interface PoLineRef {
  prNumber: string;
  itemCode: string;
}

const PO_CONDITIONS = [
  { text: '1. โปรดระบุเลขที่ใบสั่งซื้อข้างต้น ในใบส่งของทุกฉบับ' },
  { text: '2. การวางบิลและการรับเช็ค เป็นไปตามกำหนดเวลาที่บริษัทฯ กำหนดไว้' },
  { text: '2.1 วางบิลวันที่ 20 - 25 ของเดือน', indented: true },
  { text: '2.2 รับเช็ค สำหรับ Supplier วันที่ 30 ของเดือน', indented: true },
  { text: '2.3 รับเช็ค สำหรับผู้รับเหมา วันที่ 15 และ 30 ของเดือน', indented: true },
  { text: '3. การวางบิลเพื่อเรียกเก็บเงิน ให้แนบสำเนาใบสั่งซื้อกำกับมาด้วย' },
];

const PAYMENT_TYPE_LABEL: Record<PoPaymentType, string> = {
  CREDIT: 'เครดิต',
  PREPAID: 'เงินสด / จ่ายก่อนรับของ',
  INSTALLMENT: 'แบ่งจ่ายหลายงวด',
};

const LINE = '#334155';
const LINE_WIDTH = 0.8;
const SIDE_WIDTH = 150;
/** Room for the logo, and the same on the right, leaving the company address one line where it can */
const HEADER_SIDE_WIDTH = 90;
const TOTALS_WIDTH = 225;
/** Fixed column widths of the item table; the description takes the rest */
const COL = { no: 26, pr: 76, qty: 66, price: 60, discount: 46, amount: 68 };

const s = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
    fontSize: 9.5,
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 28,
    color: '#0f172a',
  },
  watermark: {
    position: 'absolute',
    top: '40%',
    left: '28%',
    fontSize: 96,
    color: '#e2e8f0',
    opacity: 0.4,
    transform: 'rotate(-35deg)',
    fontWeight: 'bold',
  },
  box: { borderWidth: LINE_WIDTH, borderColor: LINE },
  cellRight: { borderRightWidth: LINE_WIDTH, borderColor: LINE },
  cellBottom: { borderBottomWidth: LINE_WIDTH, borderColor: LINE },
  pad: { paddingHorizontal: 5, paddingVertical: 3 },
  bold: { fontWeight: 'bold' },
  small: { fontSize: 8.5, color: '#334155' },
  tableHeader: {
    flexDirection: 'row',
    borderTopWidth: LINE_WIDTH,
    borderBottomWidth: LINE_WIDTH,
    borderColor: LINE,
    paddingVertical: 2,
    fontSize: 8.5,
    fontWeight: 'bold',
  },
  tableRow: { flexDirection: 'row', paddingVertical: 3 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
});

/** A label and its value on one line, the value wrapping under itself */
function Field({ label, value, labelWidth = 56, bold }: { label: string; value: string; labelWidth?: number; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 1.5 }}>
      <Text style={[s.bold, { width: labelWidth }]}>{label} :</Text>
      <Text style={[{ flex: 1 }, bold ? s.bold : {}]}>{value}</Text>
    </View>
  );
}

function branchLabel(branch: string): string {
  return !branch || branch === '00000' ? 'สำนักงานใหญ่' : `สาขา ${branch}`;
}

/** 6.00, or 2.125 when the quantity carries a third decimal */
function qtyText(qty: string): string {
  return formatMoneyDisplay(qty, D(qty).decimalPlaces() > 2 ? 3 : 2);
}

function HeaderCell({ th, en, width, align = 'center' }: { th: string; en: string; width?: number; align?: 'left' | 'center' | 'right' }) {
  return (
    <View style={[width ? { width } : { flex: 1 }, { paddingHorizontal: 3, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }]}>
      <Text>{th}</Text>
      <Text style={{ fontWeight: 'normal' }}>{en}</Text>
    </View>
  );
}

export function PoPdfDoc({
  po,
  settings,
  signers,
  lineRefs,
}: {
  po: Awaited<ReturnType<typeof getPo>>;
  settings: Settings;
  /** Who has signed in the system, preparer then approver; blank lines when left out */
  signers?: Signer[];
  lineRefs?: ReadonlyMap<string, PoLineRef>;
}) {
  const isDraft = po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL' || po.status === 'REJECTED';
  const logo = companyLogo();

  const lines = po.lines.map((l) => ({
    ...l,
    amount: round2(D(l.qty).times(l.unitPrice).minus(l.discount)),
    ref: lineRefs?.get(l.id),
  }));
  const subtotal = sum(lines.map((l) => l.amount));
  const afterDiscount = subtotal.minus(po.billDiscount);
  const hasShipping = !D(po.shipping).isZero();
  const vatLabel =
    po.vatMode === 'NONE' ? 'VAT (ไม่คิดภาษี)' : po.vatMode === 'INCLUSIVE' ? `VAT ${VAT_RATE}% (รวมในราคา)` : `VAT ${VAT_RATE}%`;

  const payment =
    po.paymentType === 'CREDIT'
      ? `เครดิต ${po.creditDays ?? 0} วัน ${CREDIT_BASIS_LABEL[po.creditBasis]}`
      : PAYMENT_TYPE_LABEL[po.paymentType];

  const [preparer, approver] = signers ?? [];
  const signatures: Signer[] = [
    { ...preparer, label: 'ผู้จัดซื้อ' },
    { label: 'ผู้จัดการแผนกจัดซื้อ' },
    { ...approver, label: 'ผู้มีอำนาจลงนาม' },
  ];

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {isDraft && (
          <Text style={s.watermark} fixed>
            ร่าง
          </Text>
        )}

        {/* Company header, repeated on every page */}
        <View fixed style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
          <View style={{ width: HEADER_SIDE_WIDTH }}>
            {logo && (
              // A PDF image has no alt text
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logo} style={{ width: 66, height: 60, objectFit: 'contain' }} />
            )}
          </View>
          <View style={{ flex: 1, alignItems: 'center', paddingTop: 2 }}>
            <Text style={{ fontSize: 14, fontWeight: 'bold' }}>{settings.companyName}</Text>
            <Text style={{ fontSize: 10.5, fontWeight: 'bold' }}>{COMPANY_NAME_EN}</Text>
            <Text style={{ textAlign: 'center' }}>{settings.companyAddress}</Text>
            <Text style={{ textAlign: 'center' }}>
              {branchLabel(settings.companyBranch)} เลขประจำตัวผู้เสียภาษี {settings.companyTaxId}
            </Text>
          </View>
          {/* Balances the logo so the company name stays centred */}
          <View style={{ width: HEADER_SIDE_WIDTH }} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6 }}>
          <View style={{ width: SIDE_WIDTH }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold' }}>ใบสั่งซื้อ</Text>
            <Text style={{ fontSize: 10 }}>Purchase Order</Text>
          </View>
          <View style={{ width: SIDE_WIDTH }}>
            <Field label="เลขที่" value={po.number} labelWidth={36} bold />
            <Field label="วันที่" value={formatThaiDate(po.docDate ?? po.createdAt)} labelWidth={36} />
          </View>
        </View>

        <View style={[s.box, { flexDirection: 'row' }]}>
          <View style={[s.cellRight, s.pad, { flex: 1.1 }]}>
            <Field label="ชื่อผู้ขาย" value={po.vendorName} bold />
            <Field label="ที่อยู่" value={po.vendorAddress || '-'} />
            <Field label="โทร" value={po.vendorPhone || '-'} />
            <Text>
              <Text style={s.bold}>เลขประจำตัวผู้เสียภาษี : </Text>
              {po.vendorTaxId || '-'}
              {po.vendorTaxId && po.vendorType === 'COMPANY' ? `  ${branchLabel(po.vendorBranch)}` : ''}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={[s.cellBottom, { flexDirection: 'row' }]}>
              <View style={[s.cellRight, s.pad, { flex: 1 }]}>
                <Field label="Quotation No." value="" labelWidth={64} />
              </View>
              <View style={[s.pad, { flex: 1 }]}>
                <Field label="กำหนดส่งของ" value={po.deliveryDate ? formatThaiDate(po.deliveryDate) : '-'} labelWidth={60} />
              </View>
            </View>
            <View style={[s.cellBottom, s.pad]}>
              <Field label="สถานที่จัดส่ง" value={po.deliveryAddress || '-'} />
            </View>
            <View style={s.pad}>
              <Field label="Project" value={`${po.projectCode} - ${po.projectName}`} />
            </View>
          </View>
        </View>
        <View style={[s.box, s.pad, { flexDirection: 'row', borderTopWidth: 0 }]}>
          <View style={{ flex: 1 }}>
            <Field label="Contact" value={po.vendorContactPerson || ''} labelWidth={40} />
          </View>
          <View style={{ width: SIDE_WIDTH }}>
            <Field label="Currency" value="BAHT" labelWidth={44} />
          </View>
        </View>

        <Text style={{ fontSize: 8, marginTop: 4, marginBottom: 3 }}>
          (ผู้ขายจะต้องส่งสินค้าให้เป็นไปตามเงื่อนไขที่ได้เสนอราคาไว้กับบริษัทฯ ดังต่อไปนี้) Supplier shall supply the following items in
          good order and condition as per quotation namely
        </Text>

        <View style={s.tableHeader}>
          <HeaderCell th="ลำดับ" en="Item" width={COL.no} />
          <HeaderCell th="รายการ" en="Description" align="left" />
          <HeaderCell th="เลขที่ PR" en="PR. No." width={COL.pr} />
          <HeaderCell th="จำนวน หน่วย" en="Quantity Unit" width={COL.qty} align="right" />
          <HeaderCell th="ราคา/หน่วย" en="Unit Price" width={COL.price} align="right" />
          <HeaderCell th="ส่วนลด" en="Discount" width={COL.discount} align="right" />
          <HeaderCell th="จำนวนเงิน" en="Amount" width={COL.amount} align="right" />
        </View>

        {lines.map((l, idx) => (
          <View key={l.id} style={s.tableRow} wrap={false}>
            <Text style={{ width: COL.no, textAlign: 'center' }}>{idx + 1}</Text>
            <View style={{ flex: 1, paddingHorizontal: 3 }}>
              <Text>{l.description}</Text>
              {l.detail ? <Text style={s.small}>{l.detail}</Text> : null}
              {l.ref?.itemCode ? <Text style={s.small}>รหัสสินค้า {l.ref.itemCode}</Text> : null}
            </View>
            <Text style={{ width: COL.pr, textAlign: 'center', fontSize: 8.5 }}>{l.ref?.prNumber || '-'}</Text>
            <Text style={{ width: COL.qty, textAlign: 'right', paddingHorizontal: 3 }}>
              {qtyText(l.qty)} {l.unitName}
            </Text>
            <Text style={{ width: COL.price, textAlign: 'right', paddingHorizontal: 3 }}>{formatMoneyDisplay(l.unitPrice)}</Text>
            <Text style={{ width: COL.discount, textAlign: 'right', paddingHorizontal: 3 }}>
              {D(l.discount).isZero() ? '' : formatMoneyDisplay(l.discount)}
            </Text>
            <Text style={{ width: COL.amount, textAlign: 'right', paddingHorizontal: 3 }}>{formatMoneyDisplay(l.amount.toFixed(2))}</Text>
          </View>
        ))}

        {/* Kept whole at the foot of the last page: split, the figures lose their place beside the amount in words */}
        <View wrap={false} style={{ marginTop: 'auto', paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', borderTopWidth: LINE_WIDTH, borderColor: LINE, paddingTop: 4 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Field label="คำอธิบาย" value={po.note || '-'} labelWidth={46} />
            </View>
            <View style={{ width: TOTALS_WIDTH }}>
              {[
                ['ยอดรวมก่อนหักส่วนลด', subtotal.toFixed(2)],
                ['หักส่วนลดพิเศษ', po.billDiscount],
                ['หลังหักส่วนลดพิเศษ', afterDiscount.toFixed(2)],
                ...(hasShipping ? [['ค่าขนส่ง', po.shipping]] : []),
                ...(hasShipping || po.vatMode === 'INCLUSIVE' ? [['มูลค่าก่อนภาษี', po.beforeVat]] : []),
                [vatLabel, po.vat],
              ].map(([label, value]) => (
                <View key={label} style={s.totalRow}>
                  <Text>{label}</Text>
                  <Text>{formatMoneyDisplay(value)}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={[s.box, { flexDirection: 'row', marginTop: 3 }]}>
            <Text style={[s.pad, s.bold, { flex: 1, textAlign: 'center', backgroundColor: '#f1f5f9' }]}>
              ({bahtText(D(po.gross))})
            </Text>
            <View style={[s.pad, { width: TOTALS_WIDTH, flexDirection: 'row', justifyContent: 'space-between', borderLeftWidth: LINE_WIDTH, borderColor: LINE }]}>
              <Text style={s.bold}>รวมเงินสุทธิ</Text>
              <Text style={s.bold}>{formatMoneyDisplay(po.gross)}</Text>
            </View>
          </View>

          <View style={[s.box, { flexDirection: 'row', marginTop: 6 }]}>
            <View style={[s.cellRight, s.pad, { flex: 1.1 }]}>
              {po.installments.length > 0 ? (
                <Field
                  label="Down Payment"
                  labelWidth={72}
                  value={po.installments.map((i) => `งวดที่ ${i.seq} ${i.name}  ${formatMoneyDisplay(i.amount)} บาท`).join('\n')}
                />
              ) : (
                <Field label="Down Payment" value="" labelWidth={72} />
              )}
              <Field label="Retention" value="" labelWidth={72} />
              <Field label="กำหนดชำระเงิน" value={`${payment} · ${PAY_METHOD_LABEL[po.payMethod]}`} labelWidth={72} />
              {po.paymentType === 'CREDIT' && (
                <Field
                  label="วางบิล / รับเช็ค"
                  value={`${describeSchedule(po.billingSchedule, 'ทุกวัน')} / ${describeSchedule(po.chequeSchedule, 'ไม่กำหนดรอบ')}`}
                  labelWidth={72}
                />
              )}
              {po.paymentTerms ? <Field label="เงื่อนไข" value={po.paymentTerms} labelWidth={72} /> : null}
            </View>
            <View style={[s.pad, { flex: 1 }]}>
              <Field
                label="Contact Delivery"
                value={po.requesterName ? `${po.requesterName}${po.department ? ` (${po.department})` : ''}` : ''}
                labelWidth={78}
              />
              <Field label="Tel." value="" labelWidth={78} />
            </View>
          </View>

          <View style={[s.box, { flexDirection: 'row', borderTopWidth: 0 }]}>
            {signatures.map((sig, i) => (
              <View
                key={sig.label}
                style={{ flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 4, borderLeftWidth: i ? LINE_WIDTH : 0, borderColor: LINE }}
              >
                <View style={{ height: 34, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {sig.image ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image src={sig.image} style={{ maxWidth: 130, maxHeight: 32, objectFit: 'contain' }} />
                  ) : sig.name ? (
                    <Text>{sig.name}</Text>
                  ) : null}
                </View>
                <View style={{ width: 140, borderBottomWidth: 0.6, borderColor: '#64748b', marginBottom: 3 }} />
                <Text style={s.bold}>{sig.label}</Text>
                {sig.image && sig.name ? <Text style={{ fontSize: 8.5 }}>{sig.name}</Text> : null}
                <Text style={{ fontSize: 8, color: '#475569' }}>
                  {sig.name ? `วันที่ ${sig.date ?? '........................'}` : 'วันที่ ......../......../........'}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 5, fontSize: 8 }}>
            <Text style={s.bold}>หมายเหตุ / เงื่อนไข :</Text>
            {PO_CONDITIONS.map((c) => (
              <Text key={c.text} style={c.indented ? { paddingLeft: 12 } : undefined}>
                {c.text}
              </Text>
            ))}
          </View>
        </View>
      </Page>
    </Document>
  );
}
