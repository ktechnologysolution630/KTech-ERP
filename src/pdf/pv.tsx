import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { bahtText, D } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import { type getPv } from '@/server/services/pv';
import { type Settings } from '@/server/services/settings';
import { PdfShell, pdfStyles } from './layout';

export function PvPdfDoc({
  pv,
  settings,
}: {
  pv: Awaited<ReturnType<typeof getPv>>;
  settings: Settings;
}) {
  const isDraft = pv.status !== 'APPROVED' && pv.status !== 'PAID';

  return (
    <PdfShell
      settings={settings}
      titleTh="ใบสำคัญจ่าย"
      titleEn="Payment Voucher"
      docNumber={pv.number}
      docDate={pv.paidAt ? formatThaiDate(pv.paidAt) : formatThaiDate(pv.createdAt)}
      isDraft={isDraft}
      signatures={['ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้รับเงิน']}
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text style={{ fontWeight: 'bold' }}>สั่งจ่าย: {pv.vendorName}</Text>
          <Text>
            บัญชีธนาคาร: {pv.vendorBankName} {pv.vendorBankAccountNo} (
            {pv.vendorBankAccountName})
          </Text>
        </View>
        <View style={pdfStyles.metaBox}>
          <Text>วิธีจ่ายเงิน: {pv.payMethod ?? '-'}</Text>
          <Text>อ้างอิงการโอน/เช็ค: {pv.payRef ?? '-'}</Text>
          <Text>หมายเหตุ: {pv.note || '-'}</Text>
        </View>
      </View>

      <View style={pdfStyles.tableHeader}>
        <Text style={{ width: 28 }}>#</Text>
        <Text style={{ flex: 1 }}>รายการ / อ้างอิง PO / ใบแจ้งหนี้</Text>
        <Text style={{ width: 70, textAlign: 'right' }}>ก่อน VAT</Text>
        <Text style={{ width: 55, textAlign: 'right' }}>VAT</Text>
        <Text style={{ width: 70, textAlign: 'right' }}>ยอดรวม</Text>
        <Text style={{ width: 65, textAlign: 'right' }}>หัก ณ ที่จ่าย</Text>
        <Text style={{ width: 75, textAlign: 'right' }}>จ่ายสุทธิ</Text>
      </View>

      {pv.lines.map((l, idx) => (
        <View key={l.id} style={pdfStyles.tableRow}>
          <Text style={{ width: 28 }}>{idx + 1}</Text>
          <Text style={{ flex: 1 }}>
            {l.payableNote} {l.poNumber ? `(PO: ${l.poNumber})` : ''}{' '}
            {l.invoiceNo ? `[IV: ${l.invoiceNo}]` : ''}
          </Text>
          <Text style={{ width: 70, textAlign: 'right' }}>{l.beforeVat}</Text>
          <Text style={{ width: 55, textAlign: 'right' }}>{l.vat}</Text>
          <Text style={{ width: 70, textAlign: 'right' }}>{l.gross}</Text>
          <Text style={{ width: 65, textAlign: 'right' }}>
            {l.wht} ({l.whtRate}%)
          </Text>
          <Text style={{ width: 75, textAlign: 'right' }}>{l.net}</Text>
        </View>
      ))}

      <View style={pdfStyles.totalsBox}>
        <View style={pdfStyles.bahtTextBox}>
          <Text style={{ fontWeight: 'bold' }}>
            ยอดจ่ายสุทธิตัวอักษร: ({bahtText(D(pv.net))})
          </Text>
        </View>
        <View style={pdfStyles.numbersBox}>
          <View style={pdfStyles.numberRow}>
            <Text>รวมยอดก่อน VAT:</Text>
            <Text>{pv.beforeVat}</Text>
          </View>
          <View style={pdfStyles.numberRow}>
            <Text>รวม VAT:</Text>
            <Text>{pv.vat}</Text>
          </View>
          <View style={pdfStyles.numberRow}>
            <Text>รวมทั้งสิ้น (Gross):</Text>
            <Text>{pv.gross}</Text>
          </View>
          <View style={pdfStyles.numberRow}>
            <Text>หักภาษี ณ ที่จ่าย:</Text>
            <Text>-{pv.wht}</Text>
          </View>
          <View style={[pdfStyles.numberRow, { fontWeight: 'bold', borderTopWidth: 1, borderTopColor: '#94a3b8' }]}>
            <Text>ยอดจ่ายสุทธิ (Net):</Text>
            <Text>฿{pv.net}</Text>
          </View>
        </View>
      </View>
    </PdfShell>
  );
}
