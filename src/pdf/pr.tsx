import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { formatThaiDate } from '@/domain/thai';
import { type getPr } from '@/server/services/pr';
import { type Settings } from '@/server/services/settings';
import { PdfShell, pdfStyles } from './layout';
import { LINE_KIND_LABEL, PR_TYPE_META } from '@/domain/pr-type';

export function PrPdfDoc({
  pr,
  settings,
}: {
  pr: Awaited<ReturnType<typeof getPr>>;
  settings: Settings;
}) {
  const isDraft = pr.status !== 'APPROVED' && pr.status !== 'CLOSED';
  const meta = PR_TYPE_META[pr.prType];
  const showPrices = meta.priced || pr.lines.some((l) => l.estUnitPrice);
  const combined = pr.prType === 'GOODS_AND_LABOR';
  const labor = pr.prType === 'LABOR';
  const total = pr.lines.reduce((s, l) => s + Number(l.qty) * Number(l.estUnitPrice ?? 0) - Number(l.discount), 0);

  return (
    <PdfShell
      settings={settings}
      titleTh={meta.titleTh}
      titleEn={meta.titleEn}
      docNumber={pr.number}
      docDate={formatThaiDate(pr.docDate ?? pr.createdAt)}
      isDraft={isDraft}
      signatures={[labor ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ', 'ผู้จัดทำ', 'ผู้อนุมัติ']}
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text>
            โครงการ: {pr.projectCode} - {pr.projectName}
          </Text>
          <Text>ผู้ขอซื้อ: {pr.requesterText || pr.requesterName}{pr.department ? ` (${pr.department})` : ''}</Text>
          <Text>{labor ? 'สถานที่ทำงาน' : 'สถานที่จัดส่ง'}: {pr.deliveryPlace || '-'}</Text>
          <Text>{labor ? 'กำหนดเริ่มงาน' : 'กำหนดใช้/รับของ'}: {pr.needBy ? formatThaiDate(pr.needBy) : '-'}</Text>
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
        <Text style={{ width: 32 }}>#</Text>
        <Text style={{ flex: 1 }}>รายการ</Text>
        {combined && <Text style={{ width: 70 }}>ประเภท</Text>}
        <Text style={{ width: 90 }}>หมวดหมู่</Text>
        <Text style={{ width: 55, textAlign: 'right' }}>จำนวน</Text>
        <Text style={{ width: 50, textAlign: 'center' }}>หน่วย</Text>
        {showPrices && <Text style={{ width: 70, textAlign: 'right' }}>ราคา/หน่วย</Text>}
        {showPrices && <Text style={{ width: 50, textAlign: 'right' }}>ส่วนลด</Text>}
        {showPrices && <Text style={{ width: 75, textAlign: 'right' }}>จำนวนเงิน</Text>}
      </View>

      {pr.lines.map((l, idx) => (
        <View key={l.id} style={pdfStyles.tableRow}>
          <Text style={{ width: 32 }}>{idx + 1}</Text>
          <Text style={{ flex: 1 }}>{l.detail ? `${l.description}
${l.detail}` : l.description}</Text>
          {combined && <Text style={{ width: 70 }}>{LINE_KIND_LABEL[l.lineKind]}</Text>}
          <Text style={{ width: 90 }}>{l.category ?? '-'}</Text>
          <Text style={{ width: 55, textAlign: 'right' }}>{Number(l.qty)}</Text>
          <Text style={{ width: 50, textAlign: 'center' }}>{l.unitName}</Text>
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
