import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { bahtText, D } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import { type getPo } from '@/server/services/po';
import { type Settings } from '@/server/services/settings';
import { PdfShell, pdfStyles } from './layout';

export function PoPdfDoc({
  po,
  settings,
}: {
  po: Awaited<ReturnType<typeof getPo>>;
  settings: Settings;
}) {
  const isDraft =
    po.status === 'DRAFT' ||
    po.status === 'PENDING_APPROVAL' ||
    po.status === 'REJECTED';

  return (
    <PdfShell
      settings={settings}
      titleTh="ใบสั่งซื้อ"
      titleEn="Purchase Order"
      docNumber={po.number}
      docDate={formatThaiDate(po.createdAt)}
      isDraft={isDraft}
      signatures={['ผู้จัดทำ', 'ผู้อนุมัติ']}
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text style={{ fontWeight: 'bold' }}>ผู้ขาย: {po.vendorName}</Text>
          <Text>
            โครงการ: {po.projectCode} - {po.projectName}
          </Text>
          <Text>สถานที่จัดส่ง: {po.deliveryAddress || '-'}</Text>
        </View>
        <View style={pdfStyles.metaBox}>
          <Text>
            เงื่อนไขการชำระเงิน: {po.paymentType}
            {po.paymentType === 'CREDIT' && po.creditDays
              ? ` (${po.creditDays} วัน)`
              : ''}
          </Text>
          <Text>กำหนดส่งของ: {po.deliveryDate ?? '-'}</Text>
          <Text>หมายเหตุ: {po.note || '-'}</Text>
        </View>
      </View>

      <View style={pdfStyles.tableHeader}>
        <Text style={{ width: 28 }}>#</Text>
        <Text style={{ flex: 1 }}>รายการ</Text>
        <Text style={{ width: 55, textAlign: 'right' }}>จำนวน</Text>
        <Text style={{ width: 50, textAlign: 'center' }}>หน่วย</Text>
        <Text style={{ width: 70, textAlign: 'right' }}>ราคา/หน่วย</Text>
        <Text style={{ width: 60, textAlign: 'right' }}>ส่วนลด</Text>
        <Text style={{ width: 80, textAlign: 'right' }}>รวมเงิน</Text>
      </View>

      {po.lines.map((l, idx) => (
        <View key={l.id} style={pdfStyles.tableRow}>
          <Text style={{ width: 28 }}>{idx + 1}</Text>
          <Text style={{ flex: 1 }}>{l.description}</Text>
          <Text style={{ width: 55, textAlign: 'right' }}>{Number(l.qty)}</Text>
          <Text style={{ width: 50, textAlign: 'center' }}>{l.unitName}</Text>
          <Text style={{ width: 70, textAlign: 'right' }}>{l.unitPrice}</Text>
          <Text style={{ width: 60, textAlign: 'right' }}>{l.discount}</Text>
          <Text style={{ width: 80, textAlign: 'right' }}>{l.gross}</Text>
        </View>
      ))}

      <View style={pdfStyles.totalsBox}>
        <View style={pdfStyles.bahtTextBox}>
          <Text style={{ fontWeight: 'bold' }}>
            ตัวอักษร: ({bahtText(D(po.gross))})
          </Text>
        </View>
        <View style={pdfStyles.numbersBox}>
          <View style={pdfStyles.numberRow}>
            <Text>ส่วนลดท้ายบิล:</Text>
            <Text>{po.billDiscount}</Text>
          </View>
          <View style={pdfStyles.numberRow}>
            <Text>ค่าขนส่ง:</Text>
            <Text>{po.shipping}</Text>
          </View>
          <View style={pdfStyles.numberRow}>
            <Text>ยอดก่อน VAT:</Text>
            <Text>{po.beforeVat}</Text>
          </View>
          <View style={pdfStyles.numberRow}>
            <Text>ภาษีมูลค่าเพิ่ม (VAT 7%):</Text>
            <Text>{po.vat}</Text>
          </View>
          <View style={[pdfStyles.numberRow, { fontWeight: 'bold', borderTopWidth: 1, borderTopColor: '#94a3b8' }]}>
            <Text>ยอดรวมสุทธิ:</Text>
            <Text>฿{po.gross}</Text>
          </View>
        </View>
      </View>

      {po.installments.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>ตารางงวดการชำระเงิน</Text>
          {po.installments.map((inst) => (
            <View key={inst.id} style={pdfStyles.tableRow}>
              <Text style={{ flex: 1 }}>
                งวดที่ {inst.seq}: {inst.name} ({inst.condition})
              </Text>
              <Text style={{ width: 100, textAlign: 'right' }}>฿{inst.amount}</Text>
            </View>
          ))}
        </View>
      )}
    </PdfShell>
  );
}
