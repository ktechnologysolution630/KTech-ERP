import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import { D, formatMoneyDisplay, round2, sum } from '@/domain/money';
import { resolveFormText, type FormHeader, type FormText } from '@/domain/form-templates';
import { PO_CONDITIONS } from '@/domain/po-conditions';
import { type Signer } from '@/domain/signature';
import { formatThaiDate } from '@/domain/thai';
import { type getPo } from '@/server/services/po';
import { type Settings } from '@/server/services/settings';
import { branchLabel, ConditionsAndSignatures, Field, FormNote, FormPage, fs, HeaderCell, qtyText, RuledCell, RuledFiller, TotalsBlock, vatLabel, WrapText } from './form-parts';

/** The item code a PO line was bought as; blank when it was typed in */
export interface PoLineRef {
  itemCode: string;
}

/** Fixed column widths of the item table; the description takes the rest */
const COL = { no: 26, qty: 66, price: 60, discount: 46, amount: 68 };
/** The payment-terms cell beside Quotation No.: about half the right-hand box on an A4 page */
const TERMS_CELL = 128;
/** Room for "เลขประจำตัวผู้เสียภาษี :", the longest vendor label; the others line up their colons with it */
const VENDOR_LABEL = 84;
/** The vendor and delivery cells, set closer than the usual padding to leave the items more room */
const CELL = { paddingHorizontal: 6, paddingVertical: 2 };

export function PoPdfDoc({
  po,
  settings,
  signers,
  lineRefs,
  form,
  header,
}: {
  po: Awaited<ReturnType<typeof getPo>>;
  settings: Settings;
  /** The words set for the PO in the settings; the defaults when left out */
  form?: FormText;
  header?: FormHeader;
  /** Who has signed in the system: preparer, purchasing head, approver; blank lines when left out */
  signers?: Signer[];
  lineRefs?: ReadonlyMap<string, PoLineRef>;
}) {
  const isDraft = po.status === 'DRAFT' || po.status === 'PENDING_REVIEW' || po.status === 'PENDING_APPROVAL' || po.status === 'REJECTED';

  const lines = po.lines.map((l) => ({
    ...l,
    amount: round2(D(l.qty).times(l.unitPrice).minus(l.discount)),
    ref: lineRefs?.get(l.id),
  }));
  const subtotal = sum(lines.map((l) => l.amount));
  const afterDiscount = subtotal.minus(po.billDiscount);
  const hasShipping = !D(po.shipping).isZero();

  // The purchaser who sent it, the purchasing head who checked it, the owner who approved it
  const text = form ?? resolveFormText('PO');
  const signed: Signer[] = text.signatureLabels.map((label, i) => ({ ...signers?.[i], label }));
  // Printed with the approver first, then the purchaser and the purchasing head
  const signatures = [signed[2], signed[0], signed[1]].filter((s): s is Signer => Boolean(s));

  return (
    <Document>
      <FormPage
        settings={settings}
        header={header}
        isDraft={isDraft}
        docNumber={po.number}
        // The PO's name, number and date sit in the letterhead, beside the company
        docTitle={{ titleTh: text.titleTh, titleEn: text.titleEn, number: po.number, date: formatThaiDate(po.docDate ?? po.createdAt) }}
      >
        <View style={[fs.box, { flexDirection: 'row', marginBottom: 3 }]}>
          <View style={[fs.cellRight, CELL, { flex: 1.1 }]}>
            {/* The labels flush right, their colons lined up under the longest, the tax ID's */}
            <Field label="ชื่อผู้ขาย" value={po.vendorName} bold labelAlign="right" labelWidth={VENDOR_LABEL} tight />
            <Field label="ที่อยู่" value={po.vendorAddress || '-'} labelAlign="right" labelWidth={VENDOR_LABEL} tight />
            <Field label="โทร" value={po.vendorPhone || '-'} labelAlign="right" labelWidth={VENDOR_LABEL} tight />
            <Field
              label="เลขประจำตัวผู้เสียภาษี"
              value={`${po.vendorTaxId || '-'}${po.vendorTaxId && po.vendorType === 'COMPANY' ? `  ${branchLabel(po.vendorBranch)}` : ''}`}
              labelAlign="right"
              labelWidth={VENDOR_LABEL}
              tight
            />
            <Field label="ผู้ติดต่อ" value={po.vendorContactPerson || '-'} labelAlign="right" labelWidth={VENDOR_LABEL} tight />
          </View>
          <View style={{ flex: 1 }}>
            <View style={[fs.cellBottom, { flexDirection: 'row' }]}>
              {/* Quotation No. over the delivery date; the payment terms beside both */}
              <View style={[fs.cellRight, { flex: 1 }]}>
                <View style={[fs.cellBottom, CELL]}>
                  <Field label="Quotation No." value="" labelWidth={64} tight />
                </View>
                <View style={CELL}>
                  <Field label="กำหนดส่งของ" value={po.deliveryDate ? formatThaiDate(po.deliveryDate) : '-'} labelWidth={60} tight />
                </View>
              </View>
              <View style={[CELL, { width: TERMS_CELL }]}>
                <Text style={fs.label}>เงื่อนไขการชำระเงิน :</Text>
                {/* Thai typed without spaces still wraps inside the cell; WrapText's own inset undone */}
                <View style={{ marginLeft: -3 }}>
                  <WrapText text={po.paymentTerms || '-'} width={TERMS_CELL - 6} />
                </View>
              </View>
            </View>
            <View style={[fs.cellBottom, CELL]}>
              <Field label="สถานที่จัดส่ง" value={po.deliveryAddress || '-'} tight />
              {/* Who to call at the delivery place: the requester, as Contact Delivery was at the foot */}
              <Field
                label="Contact"
                value={po.requesterName ? `${po.requesterName}${po.department ? ` (${po.department})` : ''}` : '-'}
                tight
              />
            </View>
            <View style={CELL}>
              <Field label="Project" value={`${po.projectCode} - ${po.projectName}`} tight />
            </View>
          </View>
        </View>

        {/* The item table, ruled like the paper form: the column lines run on down to the foot of the page */}
        <View style={fs.ruledTable}>
          <View style={[fs.tableHeader, { paddingVertical: 0 }]}>
            <HeaderCell th="ลำดับ" en="Item" width={COL.no} ruled />
            <HeaderCell th="รายการ" en="Description" ruled />
            <HeaderCell th="จำนวน หน่วย" en="Quantity Unit" width={COL.qty} align="right" ruled />
            <HeaderCell th="ราคา/หน่วย" en="Unit Price" width={COL.price} align="right" ruled />
            <HeaderCell th="ส่วนลด" en="Discount" width={COL.discount} align="right" ruled />
            <HeaderCell th="จำนวนเงิน" en="Amount" width={COL.amount} align="right" ruled last />
          </View>

          {lines.map((l, idx) => (
            <View key={l.id} style={[fs.ruledRow, idx % 2 ? fs.tableRowAlt : {}]} wrap={false}>
              <RuledCell width={COL.no}>
                <Text style={{ textAlign: 'center' }}>{idx + 1}</Text>
              </RuledCell>
              <RuledCell style={{ paddingHorizontal: 3 }}>
                <Text>{l.description}</Text>
                {l.detail ? <Text style={fs.small}>{l.detail}</Text> : null}
                {l.ref?.itemCode ? <Text style={fs.small}>รหัสสินค้า {l.ref.itemCode}</Text> : null}
              </RuledCell>
              <RuledCell width={COL.qty} style={{ paddingHorizontal: 3 }}>
                <Text style={{ textAlign: 'right' }}>
                  {qtyText(l.qty)} {l.unitName}
                </Text>
              </RuledCell>
              <RuledCell width={COL.price} style={{ paddingHorizontal: 3 }}>
                <Text style={{ textAlign: 'right' }}>{formatMoneyDisplay(l.unitPrice)}</Text>
              </RuledCell>
              <RuledCell width={COL.discount} style={{ paddingHorizontal: 3 }}>
                <Text style={{ textAlign: 'right' }}>{D(l.discount).isZero() ? '' : formatMoneyDisplay(l.discount)}</Text>
              </RuledCell>
              <RuledCell width={COL.amount} style={{ paddingHorizontal: 3 }} last>
                <Text style={{ textAlign: 'right' }}>{formatMoneyDisplay(l.amount.toFixed(2))}</Text>
              </RuledCell>
            </View>
          ))}

          <RuledFiller widths={[COL.no, undefined, COL.qty, COL.price, COL.discount, COL.amount]} />
        </View>

        {/* Kept whole at the foot of the last page: split, the figures lose their place beside the amount in words */}
        {/* The item table runs right down to it, so the items get all the room the page has */}
        <View wrap={false} style={{ marginTop: 'auto' }}>
          <TotalsBlock
            note={po.note}
            noteLabel="หมายเหตุ"
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

          <ConditionsAndSignatures title="เงื่อนไข / CONDITION" conditions={PO_CONDITIONS} signatures={signatures} />
          <FormNote text={text.footerNote} />
        </View>
      </FormPage>
    </Document>
  );
}
