import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { bahtText, D } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import { type getPo } from '@/server/services/po';
import { type Settings } from '@/server/services/settings';
import { PdfShell, pdfStyles } from './layout';

const PO_CONDITIONS = [
  { text: '1.โปรดระบุเลขที่ใบสั่งซื้อข้างต้น ในใบส่งของทุกฉบับ' },
  { text: '2. การวางบิลและการรับเช็ค เป็นไปตามกำหนดเวลาที่บริษัทฯ กำหนดไว้' },
  { text: '2.1 วางบิลวันที่ 20 - 25 ของเดือน', indented: true },
  { text: '2.2 รับเช็ค สำหรับ Supplier วันที่ 30 ของเดือน', indented: true },
  { text: '2.3 รับเช็ค สำหรับผู้รับเหมา วันที่ 15 และ 30 ของเดือน', indented: true },
  { text: '3. การวางบิลเพื่อเรียกเก็บเงิน ให้แนบสำเนาใบสั่งซื้อกำกับมาด้วย' },
];

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
      footer={
        <View style={{ fontSize: 10 }}>
          <Text style={{ fontWeight: 'bold' }}>เงื่อนไข/CONDITION:</Text>
          {PO_CONDITIONS.map((c) => (
            <Text key={c.text} style={c.indented ? { paddingLeft: 12 } : undefined}>
              {c.text}
            </Text>
          ))}
        </View>
      }
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text style={{ fontWeight: 'bold' }}>ผู้ขาย: {po.vendorName}</Text>
          <Text>ที่อยู่: {po.vendorAddress || '-'}</Text>
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

      {/* Kept whole: split across pages, the figures lose their place beside the amount in words */}
      <View wrap={false} style={pdfStyles.totalsBox}>
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
