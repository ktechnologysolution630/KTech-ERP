import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import { computeDocTotals, D, formatMoneyDisplay } from '@/domain/money';
import { labelSigners, prFormKind, resolveFormText, type FormHeader, type FormText } from '@/domain/form-templates';
import { LINE_KIND_LABEL, PR_TYPE_META } from '@/domain/pr-type';
import { type Signer } from '@/domain/signature';
import { formatThaiDate } from '@/domain/thai';
import { type getPr } from '@/server/services/pr';
import { type Settings } from '@/server/services/settings';
import { Field, FormNote, FormPage, fs, HeaderCell, LINE_WIDTH, qtyText, RuledCell, RuledFiller, SignatureRow, TitleRow, TotalsBlock, TYPE, vatLabel, WrapText } from './form-parts';

/** The item code a requisition line was picked as; blank when it was typed in */
export interface PrLineRef {
  itemCode: string;
}

/**
 * Fixed column widths of the two item tables; the description takes the rest. Category and group come
 * first, as on the form, the priced table narrower to leave the description room. The goods table has
 * no BOQ column: ลำดับ, หมวด, กลุ่ม, รายการ, จำนวน/หน่วย, กำหนดใช้/รับของ.
 */
const GOODS_COL = { no: 26, category: 72, group: 84, qty: 72, needed: 70 };
const PRICED_COL = { no: 24, category: 56, group: 64, boq: 50, qty: 66, price: 54, discount: 42, amount: 60 };
/** The category and group cells: centred under their headings, a touch smaller than the description so long names fit */
const PLACE_CELL = { fontSize: TYPE.small };

export function PrPdfDoc({
  pr,
  settings,
  signers,
  lineRefs,
  form,
  header,
}: {
  pr: Awaited<ReturnType<typeof getPr>>;
  settings: Settings;
  /** The words set for this form in the settings; the defaults when left out */
  form?: FormText;
  header?: FormHeader;
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

  const text = form ?? resolveFormText(prFormKind(pr.prType));
  const signatures: Signer[] = labelSigners(signers ?? text.signatureLabels.map((label) => ({ label })), text.signatureLabels);
  // The goods form does not carry the department
  const requester = `${pr.requesterText || pr.requesterName}${pr.department && !goods ? ` (${pr.department})` : ''}`;

  return (
    <Document>
      <FormPage settings={settings} header={header} isDraft={isDraft} docNumber={pr.number}>
        <TitleRow titleTh={text.titleTh} titleEn={text.titleEn} number={pr.number} date={formatThaiDate(pr.docDate ?? pr.createdAt)} />

        {goods ? (
          // The goods form: the project with the reference supplier under it, then where it goes
          <View style={[fs.box, { flexDirection: 'row', marginBottom: 3 }]}>
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
          <View style={[fs.box, { flexDirection: 'row', marginBottom: 3 }]}>
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

        {/*
          The item table, ruled like the paper form: a line between every column and under every row,
          the columns running on through the empty space down to the foot of the page
        */}
        <View style={fs.ruledTable}>
          {goods ? (
            <View style={[fs.tableHeader, { paddingVertical: 0 }]}>
              <HeaderCell th="ลำดับ" en="Item" width={GOODS_COL.no} ruled />
              <HeaderCell th="หมวด" en="Category" width={GOODS_COL.category} ruled />
              <HeaderCell th="กลุ่ม" en="Group" width={GOODS_COL.group} ruled />
              <HeaderCell th="รายการ" en="Description" ruled />
              <HeaderCell th="จำนวน/หน่วย" en="Quantity / Unit" width={GOODS_COL.qty} align="right" ruled />
              <HeaderCell th="กำหนดใช้/รับของ" en="Required Date" width={GOODS_COL.needed} ruled last />
            </View>
          ) : (
            <View style={[fs.tableHeader, { paddingVertical: 0 }]}>
              <HeaderCell th="ลำดับ" en="Item" width={PRICED_COL.no} ruled />
              <HeaderCell th="หมวด" en="Category" width={PRICED_COL.category} ruled />
              <HeaderCell th="กลุ่ม" en="Group" width={PRICED_COL.group} ruled />
              <HeaderCell th="รายการ" en="Description" ruled />
              <HeaderCell th="รายการ BOQ" en="BOQ No." width={PRICED_COL.boq} ruled />
              <HeaderCell th="จำนวน หน่วย" en="Quantity Unit" width={PRICED_COL.qty} align="right" ruled />
              <HeaderCell th="ราคา/หน่วย" en="Unit Price" width={PRICED_COL.price} align="right" ruled />
              <HeaderCell th="ส่วนลด" en="Discount" width={PRICED_COL.discount} align="right" ruled />
              <HeaderCell th="จำนวนเงิน" en="Amount" width={PRICED_COL.amount} align="right" ruled last />
            </View>
          )}

          {pr.lines.map((l, idx) => {
            const col = goods ? GOODS_COL : PRICED_COL;
            const itemCode = lineRefs?.get(l.id)?.itemCode;
            return (
              <View key={l.id} style={[fs.ruledRow, idx % 2 ? fs.tableRowAlt : {}]} wrap={false}>
                <RuledCell width={col.no}>
                  <Text style={{ textAlign: 'center' }}>{idx + 1}</Text>
                </RuledCell>
                <RuledCell width={col.category}>
                  <WrapText text={l.category || '-'} width={col.category - LINE_WIDTH} style={PLACE_CELL} align="center" />
                </RuledCell>
                <RuledCell width={col.group}>
                  <WrapText text={l.itemGroup || '-'} width={col.group - LINE_WIDTH} style={PLACE_CELL} align="center" />
                </RuledCell>
                <RuledCell style={{ paddingHorizontal: 3 }}>
                  <Text>{l.description}</Text>
                  {l.detail ? <Text style={fs.small}>{l.detail}</Text> : null}
                  {/* The combined form says which part each line belongs to */}
                  {mixed ? <Text style={fs.small}>{LINE_KIND_LABEL[l.lineKind]}</Text> : null}
                  {itemCode ? <Text style={fs.small}>รหัสสินค้า {itemCode}</Text> : null}
                </RuledCell>
                {!goods && (
                  <RuledCell width={PRICED_COL.boq}>
                    <Text style={{ textAlign: 'center', fontSize: TYPE.small }}>{l.boq?.no || '-'}</Text>
                  </RuledCell>
                )}
                <RuledCell width={col.qty} style={{ paddingHorizontal: 3 }}>
                  <Text style={{ textAlign: 'right' }}>
                    {qtyText(l.qty)} {l.unitName}
                  </Text>
                </RuledCell>
                {goods ? (
                  // PRs written while the date sat in the header carry it there
                  <RuledCell width={GOODS_COL.needed} last>
                    <Text style={{ textAlign: 'center' }}>{dateText(l.neededDate ?? pr.needBy)}</Text>
                  </RuledCell>
                ) : (
                  <>
                    <RuledCell width={PRICED_COL.price} style={{ paddingHorizontal: 3 }}>
                      <Text style={{ textAlign: 'right' }}>{l.estUnitPrice ? formatMoneyDisplay(l.estUnitPrice) : '-'}</Text>
                    </RuledCell>
                    <RuledCell width={PRICED_COL.discount} style={{ paddingHorizontal: 3 }}>
                      <Text style={{ textAlign: 'right' }}>{D(l.discount).isZero() ? '' : formatMoneyDisplay(l.discount)}</Text>
                    </RuledCell>
                    <RuledCell width={PRICED_COL.amount} style={{ paddingHorizontal: 3 }} last>
                      <Text style={{ textAlign: 'right' }}>{formatMoneyDisplay(totals.lines[idx]!.amount.toFixed(2))}</Text>
                    </RuledCell>
                  </>
                )}
              </View>
            );
          })}

          {/* Empty ruled columns that fill the rest of the page, as on a printed form */}
          <RuledFiller
            widths={
              goods
                ? [GOODS_COL.no, GOODS_COL.category, GOODS_COL.group, undefined, GOODS_COL.qty, GOODS_COL.needed]
                : [PRICED_COL.no, PRICED_COL.category, PRICED_COL.group, undefined, PRICED_COL.boq, PRICED_COL.qty, PRICED_COL.price, PRICED_COL.discount, PRICED_COL.amount]
            }
          />
        </View>

        {/* Kept whole at the foot of the last page */}
        {/* The item table runs right down to it, so the items get all the room the page has */}
        <View wrap={false} style={{ marginTop: 'auto' }}>
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
            <View style={{ paddingTop: 3 }}>
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
          <FormNote text={text.footerNote} />
        </View>
      </FormPage>
    </Document>
  );
}
