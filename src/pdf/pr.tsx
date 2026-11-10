import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { formatThaiDate } from '@/domain/thai';
import { type getPr } from '@/server/services/pr';
import { type Settings } from '@/server/services/settings';
import { PdfShell, pdfStyles } from './layout';

export function PrPdfDoc({
  pr,
  settings,
}: {
  pr: Awaited<ReturnType<typeof getPr>>;
  settings: Settings;
}) {
  const isDraft = pr.status !== 'APPROVED' && pr.status !== 'CLOSED';

  return (
    <PdfShell
      settings={settings}
      titleTh="ใบขอซื้อ"
      titleEn="Purchase Requisition"
      docNumber={pr.number}
      docDate={formatThaiDate(pr.docDate ?? pr.createdAt)}
      isDraft={isDraft}
      signatures={['ผู้ขอซื้อ', 'ผู้จัดทำ', 'ผู้อนุมัติ']}
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text>
            โครงการ: {pr.projectCode} - {pr.projectName}
          </Text>
          <Text>ผู้ขอซื้อ: {pr.requesterText || pr.requesterName}{pr.department ? ` (${pr.department})` : ''}</Text>
          <Text>สถานที่จัดส่ง: {pr.deliveryPlace || '-'}</Text>
          <Text>กำหนดใช้/รับของ: {pr.needBy ? formatThaiDate(pr.needBy) : '-'}</Text>
        </View>
        <View style={pdfStyles.metaBox}>
          <Text>ซัพพลายเออร์อ้างอิง: {pr.vendorName ?? '-'}</Text>
          {pr.vendorName && <Text>{[pr.vendorAddress, pr.vendorPhone].filter(Boolean).join(' · ')}</Text>}
          <Text>เงื่อนไขการชำระเงิน: {pr.paymentTerms || '-'}</Text>
          <Text>หมายเหตุ: {pr.note || '-'}</Text>
        </View>
      </View>

      <View style={pdfStyles.tableHeader}>
        <Text style={{ width: 32 }}>#</Text>
        <Text style={{ flex: 1 }}>รายการ</Text>
        <Text style={{ width: 90 }}>หมวดหมู่</Text>
        <Text style={{ width: 65, textAlign: 'right' }}>จำนวน</Text>
        <Text style={{ width: 55, textAlign: 'center' }}>หน่วย</Text>
        <Text style={{ width: 85, textAlign: 'right' }}>ราคาประเมิน/หน่วย</Text>
        <Text style={{ width: 60, textAlign: 'right' }}>ส่วนลด</Text>
      </View>

      {pr.lines.map((l, idx) => (
        <View key={l.id} style={pdfStyles.tableRow}>
          <Text style={{ width: 32 }}>{idx + 1}</Text>
          <Text style={{ flex: 1 }}>{l.detail ? `${l.description}
${l.detail}` : l.description}</Text>
          <Text style={{ width: 90 }}>{l.category ?? '-'}</Text>
          <Text style={{ width: 65, textAlign: 'right' }}>{Number(l.qty)}</Text>
          <Text style={{ width: 55, textAlign: 'center' }}>{l.unitName}</Text>
          <Text style={{ width: 85, textAlign: 'right' }}>
            {l.estUnitPrice ? `฿${l.estUnitPrice}` : '-'}
          </Text>
          <Text style={{ width: 60, textAlign: 'right' }}>{Number(l.discount) ? l.discount : '-'}</Text>
        </View>
      ))}
    </PdfShell>
  );
}
