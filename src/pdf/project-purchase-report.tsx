import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { formatThaiDate } from '@/domain/thai';
import type { ProjectPurchaseReport } from '@/server/services/project-purchase-report';
import { type Settings } from '@/server/services/settings';
import { STATUS_MAP } from '@/components/doc-status-badge';
import { PdfShell, pdfStyles } from './layout';

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });

export function ProjectPurchaseReportPdf({ report, settings }: { report: ProjectPurchaseReport; settings: Settings }) {
  const { summary } = report;
  const period =
    report.from || report.to
      ? `${report.from ? formatThaiDate(report.from) : 'เริ่มโครงการ'} – ${report.to ? formatThaiDate(report.to) : 'ปัจจุบัน'}`
      : 'ทั้งหมด';

  return (
    <PdfShell
      settings={settings}
      titleTh="รายงานสรุปการจัดซื้อประจำโครงการ"
      titleEn="Project Purchasing Summary"
      docNumber={report.project.code}
      docDate={formatThaiDate(new Date())}
      signatures={['ผู้จัดทำ', 'ผู้ตรวจสอบ']}
    >
      <View style={pdfStyles.metaGrid}>
        <View style={pdfStyles.metaBox}>
          <Text>
            โครงการ: {report.project.code} - {report.project.name}
          </Text>
          <Text>ช่วงวันที่: {period}</Text>
          {report.q ? <Text>ค้นหา: {report.q}</Text> : null}
        </View>
        <View style={pdfStyles.metaBox}>
          <Text>
            ใบสั่งซื้อ {summary.poCount} ใบ · ผู้ขาย {summary.vendorCount} ราย · {summary.lineCount} รายการ
          </Text>
          <Text>มูลค่าก่อน VAT: ฿{money(summary.amount)}</Text>
          <Text>
            VAT: ฿{money(summary.vat)} · รวมทั้งสิ้น: ฿{money(summary.gross)}
          </Text>
          <Text>
            รับของแล้ว: ฿{money(summary.receivedAmount)} · ค้างรับ: ฿{money(summary.outstandingAmount)}
          </Text>
        </View>
      </View>

      <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>สรุปตามผู้ขาย</Text>
      <View style={pdfStyles.tableHeader}>
        <Text style={{ flex: 1 }}>ผู้ขาย</Text>
        <Text style={{ width: 50, textAlign: 'right' }}>PO</Text>
        <Text style={{ width: 100, textAlign: 'right' }}>มูลค่าก่อน VAT</Text>
        <Text style={{ width: 45, textAlign: 'right' }}>%</Text>
      </View>
      {report.byVendor.map((v) => (
        <View key={v.vendorName} style={pdfStyles.tableRow} wrap={false}>
          <Text style={{ flex: 1 }}>{v.vendorName}</Text>
          <Text style={{ width: 50, textAlign: 'right' }}>{v.poCount}</Text>
          <Text style={{ width: 100, textAlign: 'right' }}>{money(v.amount)}</Text>
          <Text style={{ width: 45, textAlign: 'right' }}>{v.share}</Text>
        </View>
      ))}

      <Text style={{ fontWeight: 'bold', marginTop: 10, marginBottom: 4 }}>สรุปตามหมวดหมู่</Text>
      <View style={pdfStyles.tableHeader}>
        <Text style={{ flex: 1 }}>หมวดหมู่</Text>
        <Text style={{ width: 50, textAlign: 'right' }}>รายการ</Text>
        <Text style={{ width: 100, textAlign: 'right' }}>มูลค่าก่อน VAT</Text>
        <Text style={{ width: 45, textAlign: 'right' }}>%</Text>
      </View>
      {report.byCategory.map((c) => (
        <View key={c.category} style={pdfStyles.tableRow} wrap={false}>
          <Text style={{ flex: 1 }}>{c.category}</Text>
          <Text style={{ width: 50, textAlign: 'right' }}>{c.lineCount}</Text>
          <Text style={{ width: 100, textAlign: 'right' }}>{money(c.amount)}</Text>
          <Text style={{ width: 45, textAlign: 'right' }}>{c.share}</Text>
        </View>
      ))}

      <Text style={{ fontWeight: 'bold', marginTop: 10, marginBottom: 4 }}>รายละเอียดใบสั่งซื้อ</Text>
      <View style={pdfStyles.tableHeader}>
        <Text style={{ flex: 1 }}>รายการ</Text>
        <Text style={{ width: 80 }}>หมวด</Text>
        <Text style={{ width: 55, textAlign: 'right' }}>จำนวน</Text>
        <Text style={{ width: 55, textAlign: 'right' }}>รับแล้ว</Text>
        <Text style={{ width: 80, textAlign: 'right' }}>มูลค่า</Text>
      </View>
      {report.pos.map((po) => (
        <View key={po.id}>
          <View style={[pdfStyles.tableRow, { backgroundColor: '#f8fafc' }]} wrap={false}>
            <Text style={{ flex: 1, fontWeight: 'bold' }}>
              {po.number} · {formatThaiDate(po.date)} · {po.vendorName} · {STATUS_MAP[po.status]?.label ?? po.status}
            </Text>
            <Text style={{ width: 80, textAlign: 'right', fontWeight: 'bold' }}>{money(po.amount)}</Text>
          </View>
          {po.lines.map((l, i) => (
            <View key={i} style={pdfStyles.tableRow} wrap={false}>
              <Text style={{ flex: 1, paddingLeft: 8 }}>{l.description}</Text>
              <Text style={{ width: 80 }}>{l.category}</Text>
              <Text style={{ width: 55, textAlign: 'right' }}>
                {qty(l.qty)} {l.unit}
              </Text>
              <Text style={{ width: 55, textAlign: 'right' }}>{qty(l.receivedQty)}</Text>
              <Text style={{ width: 80, textAlign: 'right' }}>{money(l.amount)}</Text>
            </View>
          ))}
        </View>
      ))}
      {report.pos.length === 0 ? <Text style={{ marginTop: 8, color: '#64748b' }}>ไม่พบใบสั่งซื้อในช่วงที่เลือก</Text> : null}
    </PdfShell>
  );
}
