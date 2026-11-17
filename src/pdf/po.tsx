import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import { type PoPaymentType } from '@/db/schema';
import { D, formatMoneyDisplay, round2, sum } from '@/domain/money';
import { CREDIT_BASIS_LABEL, PAY_METHOD_LABEL, describeSchedule } from '@/domain/payment-terms';
import { type Signer } from '@/domain/signature';
import { formatThaiDate } from '@/domain/thai';
import { type getPo } from '@/server/services/po';
import { type Settings } from '@/server/services/settings';
import { branchLabel } from '@/domain/brand';
import { Field, FormPage, fs, HeaderCell, qtyText, SIDE_WIDTH, SignatureRow, TitleRow, TotalsBlock, vatLabel } from './form-parts';

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

/** Fixed column widths of the item table; the description takes the rest */
const COL = { no: 26, pr: 76, qty: 66, price: 60, discount: 46, amount: 68 };

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

  const lines = po.lines.map((l) => ({
    ...l,
    amount: round2(D(l.qty).times(l.unitPrice).minus(l.discount)),
    ref: lineRefs?.get(l.id),
  }));
  const subtotal = sum(lines.map((l) => l.amount));
  const afterDiscount = subtotal.minus(po.billDiscount);
  const hasShipping = !D(po.shipping).isZero();

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
      <FormPage settings={settings} isDraft={isDraft}>
        <TitleRow titleTh="ใบสั่งซื้อ" titleEn="Purchase Order" number={po.number} date={formatThaiDate(po.docDate ?? po.createdAt)} />

        <View style={[fs.box, { flexDirection: 'row' }]}>
          <View style={[fs.cellRight, fs.pad, { flex: 1.1 }]}>
            <Field label="ชื่อผู้ขาย" value={po.vendorName} bold />
            <Field label="ที่อยู่" value={po.vendorAddress || '-'} />
            <Field label="โทร" value={po.vendorPhone || '-'} />
            <Text>
              <Text style={fs.bold}>เลขประจำตัวผู้เสียภาษี : </Text>
              {po.vendorTaxId || '-'}
              {po.vendorTaxId && po.vendorType === 'COMPANY' ? `  ${branchLabel(po.vendorBranch)}` : ''}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={[fs.cellBottom, { flexDirection: 'row' }]}>
              <View style={[fs.cellRight, fs.pad, { flex: 1 }]}>
                <Field label="Quotation No." value="" labelWidth={64} />
              </View>
              <View style={[fs.pad, { flex: 1 }]}>
                <Field label="กำหนดส่งของ" value={po.deliveryDate ? formatThaiDate(po.deliveryDate) : '-'} labelWidth={60} />
              </View>
            </View>
            <View style={[fs.cellBottom, fs.pad]}>
              <Field label="สถานที่จัดส่ง" value={po.deliveryAddress || '-'} />
            </View>
            <View style={fs.pad}>
              <Field label="Project" value={`${po.projectCode} - ${po.projectName}`} />
            </View>
          </View>
        </View>
        <View style={[fs.box, fs.pad, { flexDirection: 'row', borderTopWidth: 0 }]}>
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

        <View style={fs.tableHeader}>
          <HeaderCell th="ลำดับ" en="Item" width={COL.no} />
          <HeaderCell th="รายการ" en="Description" align="left" />
          <HeaderCell th="เลขที่ PR" en="PR. No." width={COL.pr} />
          <HeaderCell th="จำนวน หน่วย" en="Quantity Unit" width={COL.qty} align="right" />
          <HeaderCell th="ราคา/หน่วย" en="Unit Price" width={COL.price} align="right" />
          <HeaderCell th="ส่วนลด" en="Discount" width={COL.discount} align="right" />
          <HeaderCell th="จำนวนเงิน" en="Amount" width={COL.amount} align="right" />
        </View>

        {lines.map((l, idx) => (
          <View key={l.id} style={fs.tableRow} wrap={false}>
            <Text style={{ width: COL.no, textAlign: 'center' }}>{idx + 1}</Text>
            <View style={{ flex: 1, paddingHorizontal: 3 }}>
              <Text>{l.description}</Text>
              {l.detail ? <Text style={fs.small}>{l.detail}</Text> : null}
              {l.ref?.itemCode ? <Text style={fs.small}>รหัสสินค้า {l.ref.itemCode}</Text> : null}
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
          <TotalsBlock
            note={po.note}
            gross={po.gross}
            rows={[
              ['ยอดรวมก่อนหักส่วนลด', subtotal.toFixed(2)],
              ['หักส่วนลดพิเศษ', po.billDiscount],
              ['หลังหักส่วนลดพิเศษ', afterDiscount.toFixed(2)],
              ...(hasShipping ? [['ค่าขนส่ง', po.shipping] as [string, string]] : []),
              ...(hasShipping || po.vatMode === 'INCLUSIVE' ? [['มูลค่าก่อนภาษี', po.beforeVat] as [string, string]] : []),
              [vatLabel(po.vatMode), po.vat],
            ]}
          />

          <View style={[fs.box, { flexDirection: 'row', marginTop: 6 }]}>
            <View style={[fs.cellRight, fs.pad, { flex: 1.1 }]}>
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
            <View style={[fs.pad, { flex: 1 }]}>
              <Field
                label="Contact Delivery"
                value={po.requesterName ? `${po.requesterName}${po.department ? ` (${po.department})` : ''}` : ''}
                labelWidth={78}
              />
              <Field label="Tel." value="" labelWidth={78} />
            </View>
          </View>

          <SignatureRow signatures={signatures} />

          <View style={{ marginTop: 5, fontSize: 8 }}>
            <Text style={fs.bold}>หมายเหตุ / เงื่อนไข :</Text>
            {PO_CONDITIONS.map((c) => (
              <Text key={c.text} style={c.indented ? { paddingLeft: 12 } : undefined}>
                {c.text}
              </Text>
            ))}
          </View>
        </View>
      </FormPage>
    </Document>
  );
}
