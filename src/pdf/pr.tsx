import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import { computeDocTotals, D, formatMoneyDisplay } from '@/domain/money';
import { LINE_KIND_LABEL, PR_TYPE_META, prSignatures } from '@/domain/pr-type';
import { type Signer } from '@/domain/signature';
import { formatThaiDate } from '@/domain/thai';
import { type getPr } from '@/server/services/pr';
import { type Settings } from '@/server/services/settings';
import { Field, FormPage, fs, HeaderCell, LINE, LINE_WIDTH, qtyText, SignatureRow, TitleRow, TotalsBlock, vatLabel } from './form-parts';

/** The item code a requisition line was picked as; blank when it was typed in */
export interface PrLineRef {
  itemCode: string;
}

/** Fixed column widths of the two item tables; the description takes the rest */
const GOODS_COL = { no: 26, boq: 70, qty: 76, needed: 74 };
const PRICED_COL = { no: 26, boq: 60, qty: 66, price: 60, discount: 46, amount: 68 };

/** PURCHASE REQUISITION → Purchase Requisition, to sit like the order's title */
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/ And /g, ' and ');

export function PrPdfDoc({
  pr,
  settings,
  signers,
  lineRefs,
}: {
  pr: Awaited<ReturnType<typeof getPr>>;
  settings: Settings;
  /** The requester and the PM as signed in the system; blank lines when left out */
  signers?: Signer[];
  lineRefs?: ReadonlyMap<string, PrLineRef>;
}) {
  const isDraft = pr.status !== 'APPROVED' && pr.status !== 'CLOSED';
  const meta = PR_TYPE_META[pr.prType];
  // The goods form never prints prices, also for PRs written before the forms existed
  const priced = meta.priced;
  const goods = pr.prType === 'GOODS';
  const labor = pr.prType === 'LABOR';
  const mixed = pr.prType === 'GOODS_AND_LABOR';
  const dateText = (d: string | null | undefined) => (d ? formatThaiDate(d) : '-');

  const totals = computeDocTotals({
    vatMode: pr.vatMode,
    billDiscount: priced ? D(pr.billDiscount) : D(0),
    shipping: D(0),
    lines: pr.lines.map((l) => ({ qty: D(l.qty), unitPrice: D(l.estUnitPrice ?? 0), discount: D(l.discount) })),
  });

  const signatures: Signer[] = signers ?? [prSignatures(pr.prType)[0]!, 'ผู้จัดการโครงการ (PM)'].map((label) => ({ label }));
  // The goods form does not carry the department
  const requester = `${pr.requesterText || pr.requesterName}${pr.department && !goods ? ` (${pr.department})` : ''}`;

  return (
    <Document>
      <FormPage settings={settings} isDraft={isDraft} docNumber={pr.number}>
        <TitleRow titleTh={meta.titleTh} titleEn={titleCase(meta.titleEn)} number={pr.number} date={formatThaiDate(pr.docDate ?? pr.createdAt)} />

        {goods ? (
          // The goods form: the project with the reference supplier under it, then where it goes
          <View style={[fs.box, { flexDirection: 'row', marginBottom: 6 }]}>
            <View style={[fs.cellRight, { flex: 1.1 }]}>
              <View style={[fs.cellBottom, fs.pad]}>
                <Field label="Project" value={`${pr.projectCode} - ${pr.projectName}`} labelWidth={92} bold />
              </View>
              <View style={fs.pad}>
                <Field label="ซัพพลายเออร์อ้างอิง" value={pr.vendorName ?? '-'} labelWidth={92} />
              </View>
            </View>
            <View style={[fs.pad, { flex: 1 }]}>
              <Field label="สถานที่จัดส่ง" value={pr.deliveryPlace || '-'} />
            </View>
          </View>
        ) : (
          <View style={[fs.box, { flexDirection: 'row', marginBottom: 6 }]}>
            <View style={[fs.cellRight, fs.pad, { flex: 1.1 }]}>
              <Text style={fs.sectionTitle}>{labor ? 'ช่าง / ผู้รับเหมา' : 'ซัพพลายเออร์อ้างอิง'}</Text>
              <Field label="ชื่อ" value={pr.vendorName ?? '-'} bold />
              <Field label="ที่อยู่" value={pr.vendorAddress || '-'} />
              <Field label="โทร" value={pr.vendorPhone || '-'} />
              <Text>
                <Text style={fs.label}>เลขประจำตัวผู้เสียภาษี : </Text>
                {pr.vendorTaxId || '-'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={[fs.cellBottom, { flexDirection: 'row' }]}>
                <View style={[fs.cellRight, fs.pad, { flex: 1.3 }]}>
                  <Field label={labor ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ'} value={pr.requesterText || pr.requesterName} labelWidth={46} />
                </View>
                <View style={[fs.pad, { flex: 1 }]}>
                  <Field label="แผนก" value={pr.department || '-'} labelWidth={30} />
                </View>
              </View>
              <View style={[fs.cellBottom, fs.pad]}>
                <Field label={labor ? 'สถานที่ทำงาน' : 'สถานที่จัดส่ง'} value={pr.deliveryPlace || '-'} />
              </View>
              <View style={[fs.cellBottom, fs.pad]}>
                <Field label="Project" value={`${pr.projectCode} - ${pr.projectName}`} />
              </View>
              <View style={{ flexDirection: 'row' }}>
                <View style={[fs.cellRight, fs.pad, { flex: 1 }]}>
                  <Field label={labor ? 'กำหนดเริ่มงาน' : 'รับของ/เริ่มงาน'} value={dateText(pr.needBy)} labelWidth={62} />
                </View>
                <View style={[fs.pad, { flex: 1 }]}>
                  <Field label="แล้วเสร็จ" value={dateText(pr.workEnd)} labelWidth={42} />
                </View>
              </View>
            </View>
          </View>
        )}

        {goods ? (
          <View style={fs.tableHeader}>
            <HeaderCell th="ลำดับ" en="Item" width={GOODS_COL.no} />
            <HeaderCell th="รายการ" en="Description" />
            <HeaderCell th="รายการ BOQ" en="BOQ No." width={GOODS_COL.boq} />
            <HeaderCell th="จำนวน หน่วย" en="Quantity Unit" width={GOODS_COL.qty} align="right" />
            <HeaderCell th="กำหนดใช้/รับของ" en="Required Date" width={GOODS_COL.needed} />
          </View>
        ) : (
          <View style={fs.tableHeader}>
            <HeaderCell th="ลำดับ" en="Item" width={PRICED_COL.no} />
            <HeaderCell th="รายการ" en="Description" />
            <HeaderCell th="รายการ BOQ" en="BOQ No." width={PRICED_COL.boq} />
            <HeaderCell th="จำนวน หน่วย" en="Quantity Unit" width={PRICED_COL.qty} align="right" />
            <HeaderCell th="ราคา/หน่วย" en="Unit Price" width={PRICED_COL.price} align="right" />
            <HeaderCell th="ส่วนลด" en="Discount" width={PRICED_COL.discount} align="right" />
            <HeaderCell th="จำนวนเงิน" en="Amount" width={PRICED_COL.amount} align="right" />
          </View>
        )}

        {pr.lines.map((l, idx) => {
          const col = goods ? GOODS_COL : PRICED_COL;
          const itemCode = lineRefs?.get(l.id)?.itemCode;
          const place = [mixed ? LINE_KIND_LABEL[l.lineKind] : '', [l.category, l.itemGroup].filter(Boolean).join(' › ')].filter(Boolean).join(' · ');
          return (
            <View key={l.id} style={[fs.tableRow, idx % 2 ? fs.tableRowAlt : {}]} wrap={false}>
              <Text style={{ width: col.no, textAlign: 'center' }}>{idx + 1}</Text>
              <View style={{ flex: 1, paddingHorizontal: 3 }}>
                <Text>{l.description}</Text>
                {l.detail ? <Text style={fs.small}>{l.detail}</Text> : null}
                {place ? <Text style={fs.small}>{place}</Text> : null}
                {itemCode ? <Text style={fs.small}>รหัสสินค้า {itemCode}</Text> : null}
              </View>
              <Text style={{ width: col.boq, textAlign: 'center', fontSize: 8.5 }}>{l.boq?.no || '-'}</Text>
              <Text style={{ width: col.qty, textAlign: 'right', paddingHorizontal: 3 }}>
                {qtyText(l.qty)} {l.unitName}
              </Text>
              {goods ? (
                // PRs written while the date sat in the header carry it there
                <Text style={{ width: GOODS_COL.needed, textAlign: 'center' }}>{dateText(l.neededDate ?? pr.needBy)}</Text>
              ) : (
                <>
                  <Text style={{ width: PRICED_COL.price, textAlign: 'right', paddingHorizontal: 3 }}>{l.estUnitPrice ? formatMoneyDisplay(l.estUnitPrice) : '-'}</Text>
                  <Text style={{ width: PRICED_COL.discount, textAlign: 'right', paddingHorizontal: 3 }}>
                    {D(l.discount).isZero() ? '' : formatMoneyDisplay(l.discount)}
                  </Text>
                  <Text style={{ width: PRICED_COL.amount, textAlign: 'right', paddingHorizontal: 3 }}>
                    {formatMoneyDisplay(totals.lines[idx]!.amount.toFixed(2))}
                  </Text>
                </>
              )}
            </View>
          );
        })}

        {/* Kept whole at the foot of the last page */}
        <View wrap={false} style={{ marginTop: 'auto', paddingTop: 8 }}>
          {priced ? (
            <TotalsBlock
              note={pr.note}
              gross={totals.gross.toFixed(2)}
              rows={[
                ['ยอดรวมก่อนหักส่วนลด', totals.subtotal.toFixed(2)],
                ['หักส่วนลดพิเศษ', totals.billDiscount.toFixed(2)],
                ['หลังหักส่วนลดพิเศษ', totals.subtotal.minus(totals.billDiscount).toFixed(2)],
                ...(pr.vatMode === 'INCLUSIVE' ? [['มูลค่าก่อนภาษี', totals.beforeVat.toFixed(2)] as [string, string]] : []),
                [vatLabel(pr.vatMode), totals.vat.toFixed(2)],
              ]}
            />
          ) : (
            <View style={{ borderTopWidth: LINE_WIDTH, borderColor: LINE, paddingTop: 4 }}>
              <Field label="คำอธิบาย" value={pr.note || '-'} labelWidth={46} />
            </View>
          )}

          <View style={[fs.box, { flexDirection: 'row', marginTop: 6 }]}>
            <View style={[fs.cellRight, fs.pad, { flex: 1.1 }]}>
              <Field label="Contact Delivery" value={requester} labelWidth={78} />
              {priced && <Field label="เงื่อนไขการชำระเงิน" value={pr.paymentTerms || '-'} labelWidth={78} />}
            </View>
            <View style={[fs.pad, { flex: 1 }]}>
              <Field label="Tel." value="" labelWidth={30} />
            </View>
          </View>

          <SignatureRow signatures={signatures} />
        </View>
      </FormPage>
    </Document>
  );
}
