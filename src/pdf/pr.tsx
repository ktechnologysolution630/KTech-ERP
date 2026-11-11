import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { formatThaiDate } from '@/domain/thai';
import { type getPr } from '@/server/services/pr';
import { type Settings } from '@/server/services/settings';
import { PdfShell, pdfStyles } from './layout';
import { LINE_KIND_LABEL, PR_TYPE_META, prSignatures } from '@/domain/pr-type';
import { type Signer } from '@/domain/signature';

export function PrPdfDoc({
  pr,
  settings,
  signers,
}: {
  pr: Awaited<ReturnType<typeof getPr>>;
  settings: Settings;
  /** Who has signed in the system; blank lines when left out */
  signers?: Signer[];
}) {
  const isDraft = pr.status !== 'APPROVED' && pr.status !== 'CLOSED';
  const meta = PR_TYPE_META[pr.prType];
  // The goods form never prints prices, also for PRs written before the forms existed
  const showPrices = meta.priced;
  const goods = pr.prType === 'GOODS';
  const combined = pr.prType === 'GOODS_AND_LABOR';
  const labor = pr.prType === 'LABOR';
  // PRs written while the date sat in the header carry it there
  const needed = (lineDate: string | null) => {
    const d = lineDate ?? pr.needBy;
    return d ? formatThaiDate(d) : '-';
  };
  // The goods table carries three more columns, so its narrow ones give way to the item name
  const w = goods ? { no: 26, category: 90, group: 115, qty: 48, unit: 44, needed: 62 } : { no: 32, category: 0, group: 0, qty: 55, unit: 50, needed: 0 };
  const total = pr.lines.reduce((s, l) => s + Number(l.qty) * Number(l.estUnitPrice ?? 0) - Number(l.discount), 0);

  return (
    <PdfShell
      settings={settings}
      titleTh={meta.titleTh}
      titleEn={meta.titleEn}
      docNumber={pr.number}
      docDate={formatThaiDate(pr.docDate ?? pr.createdAt)}
      isDraft={isDraft}
      signatures={signers ?? prSignatures(pr.prType)}
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text>
            โครงการ: {pr.projectCode} - {pr.projectName}
          </Text>
          <Text>ผู้ขอซื้อ: {pr.requesterText || pr.requesterName}{pr.department ? ` (${pr.department})` : ''}</Text>
          <Text>{labor ? 'สถานที่ทำงาน' : 'สถานที่จัดส่ง'}: {pr.deliveryPlace || '-'}</Text>
          {!goods && <Text>{labor ? 'กำหนดเริ่มงาน' : 'กำหนดรับของ/เริ่มงาน'}: {pr.needBy ? formatThaiDate(pr.needBy) : '-'}</Text>}
          {pr.prType !== 'GOODS' && <Text>กำหนดแล้วเสร็จ: {pr.workEnd ? formatThaiDate(pr.workEnd) : '-'}</Text>}
        </View>
        <View style={pdfStyles.metaBox}>
          <Text>{labor ? 'ช่าง / ผู้รับเหมา' : 'ซัพพลายเออร์อ้างอิง'}: {pr.vendorName ?? '-'}</Text>
          {pr.vendorName && <Text>{[pr.vendorAddress, pr.vendorPhone].filter(Boolean).join(' · ')}</Text>}
          {showPrices && <Text>เงื่อนไขการชำระเงิน: {pr.paymentTerms || '-'}</Text>}
          <Text>หมายเหตุ: {pr.note || '-'}</Text>
        </View>
      </View>

      <View style={pdfStyles.tableHeader}>
        <Text style={{ width: w.no }}>#</Text>
        {goods && <Text style={{ width: w.category }}>หมวด</Text>}
        {goods && <Text style={{ width: w.group }}>กลุ่ม</Text>}
        <Text style={{ flex: 1 }}>รายการ</Text>
        {combined && <Text style={{ width: 70 }}>ประเภท</Text>}
        {!goods && <Text style={{ width: 90 }}>หมวดหมู่</Text>}
        <Text style={{ width: w.qty, textAlign: 'right' }}>จำนวน</Text>
        <Text style={{ width: w.unit, textAlign: 'center' }}>หน่วย</Text>
        {goods && <Text style={{ width: w.needed, textAlign: 'center' }}>กำหนดใช้/รับของ</Text>}
        {showPrices && <Text style={{ width: 70, textAlign: 'right' }}>ราคา/หน่วย</Text>}
        {showPrices && <Text style={{ width: 50, textAlign: 'right' }}>ส่วนลด</Text>}
        {showPrices && <Text style={{ width: 75, textAlign: 'right' }}>จำนวนเงิน</Text>}
      </View>

      {pr.lines.map((l, idx) => (
        <View key={l.id} style={pdfStyles.tableRow}>
          <Text style={{ width: w.no }}>{idx + 1}</Text>
          {goods && <Text style={{ width: w.category, paddingRight: 4 }}>{l.category ?? '-'}</Text>}
          {goods && <Text style={{ width: w.group, paddingRight: 4 }}>{l.itemGroup ?? '-'}</Text>}
          <Text style={{ flex: 1 }}>{l.detail ? `${l.description}
${l.detail}` : l.description}</Text>
          {combined && <Text style={{ width: 70 }}>{LINE_KIND_LABEL[l.lineKind]}</Text>}
          {!goods && <Text style={{ width: 90 }}>{l.itemGroup ? `${l.category ?? '-'}
${l.itemGroup}` : (l.category ?? '-')}</Text>}
          <Text style={{ width: w.qty, textAlign: 'right' }}>{Number(l.qty)}</Text>
          <Text style={{ width: w.unit, textAlign: 'center' }}>{l.unitName}</Text>
          {goods && <Text style={{ width: w.needed, textAlign: 'center' }}>{needed(l.neededDate)}</Text>}
          {showPrices && <Text style={{ width: 70, textAlign: 'right' }}>{l.estUnitPrice ?? '-'}</Text>}
          {showPrices && <Text style={{ width: 50, textAlign: 'right' }}>{Number(l.discount) ? l.discount : '-'}</Text>}
          {showPrices && <Text style={{ width: 75, textAlign: 'right' }}>{(Number(l.qty) * Number(l.estUnitPrice ?? 0) - Number(l.discount)).toFixed(2)}</Text>}
        </View>
      ))}
      {showPrices && (
        <View style={pdfStyles.tableRow}>
          <Text style={{ flex: 1, textAlign: 'right', fontWeight: 'bold' }}>รวมก่อนส่วนลดท้ายบิลและ VAT</Text>
          <Text style={{ width: 75, textAlign: 'right', fontWeight: 'bold' }}>{total.toFixed(2)}</Text>
        </View>
      )}
    </PdfShell>
  );
}
