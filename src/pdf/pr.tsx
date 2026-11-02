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
      docDate={formatThaiDate(pr.createdAt)}
      isDraft={isDraft}
      signatures={['ผู้ขอซื้อ', 'ผู้ตรวจสอบ (PM)']}
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text>
            โครงการ: {pr.projectCode} - {pr.projectName}
          </Text>
          <Text>ผู้ขอซื้อ: {pr.requesterName}</Text>
          <Text>สถานะ: {pr.status}</Text>
        </View>
        <View style={pdfStyles.metaBox}>
          <Text>หมายเหตุ: {pr.note || '-'}</Text>
        </View>
      </View>

      <View style={pdfStyles.tableHeader}>
        <Text style={{ width: 32 }}>#</Text>
        <Text style={{ flex: 1 }}>รายการ</Text>
        <Text style={{ width: 65, textAlign: 'right' }}>จำนวน</Text>
        <Text style={{ width: 55, textAlign: 'center' }}>หน่วย</Text>
        <Text style={{ width: 85, textAlign: 'right' }}>ราคาประเมิน/หน่วย</Text>
        <Text style={{ width: 75, textAlign: 'center' }}>วันที่ต้องการ</Text>
      </View>

      {pr.lines.map((l, idx) => (
        <View key={l.id} style={pdfStyles.tableRow}>
          <Text style={{ width: 32 }}>{idx + 1}</Text>
          <Text style={{ flex: 1 }}>{l.description}</Text>
          <Text style={{ width: 65, textAlign: 'right' }}>{Number(l.qty)}</Text>
          <Text style={{ width: 55, textAlign: 'center' }}>{l.unitName}</Text>
          <Text style={{ width: 85, textAlign: 'right' }}>
            {l.estUnitPrice ? `฿${l.estUnitPrice}` : '-'}
          </Text>
          <Text style={{ width: 75, textAlign: 'center' }}>{l.neededDate ?? '-'}</Text>
        </View>
      ))}
    </PdfShell>
  );
}
