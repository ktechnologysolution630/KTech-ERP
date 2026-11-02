import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { bahtText, D } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import { type Settings } from '@/server/services/settings';
import { pdfStyles } from './layout';

export interface WhtCertView {
  id: string;
  number: string;
  pvId: string;
  vendorId: string;
  vendorName: string;
  vendorTaxId: string;
  vendorBranch: string;
  vendorAddress: string;
  formType: 'PND3' | 'PND53';
  paidAt: string;
  incomeType: string;
  basis: string;
  wht: string;
  status: 'ACTIVE' | 'VOID';
}

export function Wht50PdfDoc({
  cert,
  settings,
}: {
  cert: WhtCertView;
  settings: Settings;
}) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        {cert.status === 'VOID' && <Text style={pdfStyles.watermark}>ยกเลิก</Text>}

        <View style={pdfStyles.headerRow}>
          <View>
            <Text style={pdfStyles.companyName}>
              หนังสือรับรองการหักภาษี ณ ที่จ่าย
            </Text>
            <Text style={pdfStyles.docTitleEn}>
              ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร
            </Text>
          </View>
          <View style={pdfStyles.docTitleBox}>
            <Text style={{ fontWeight: 'bold' }}>เลขที่: {cert.number}</Text>
            <Text>
              แบบฟอร์ม:{' '}
              {cert.formType === 'PND3'
                ? '[X] ภ.ง.ด.3 (บุคคลธรรมดา)   [ ] ภ.ง.ด.53'
                : '[ ] ภ.ง.ด.3   [X] ภ.ง.ด.53 (นิติบุคคล)'}
            </Text>
          </View>
        </View>

        <View style={[pdfStyles.metaBox, { marginBottom: 10 }]}>
          <Text style={{ fontWeight: 'bold' }}>
            ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (Payer):
          </Text>
          <Text>ชื่อ: {settings.companyName}</Text>
          <Text>ที่อยู่: {settings.companyAddress}</Text>
          <Text>
            เลขประจำตัวผู้เสียภาษีอากร: {settings.companyTaxId} (สาขา{' '}
            {settings.companyBranch})
          </Text>
        </View>

        <View style={[pdfStyles.metaBox, { marginBottom: 12 }]}>
          <Text style={{ fontWeight: 'bold' }}>
            ผู้ถูกหักภาษี ณ ที่จ่าย (Payee):
          </Text>
          <Text>ชื่อ: {cert.vendorName}</Text>
          <Text>ที่อยู่: {cert.vendorAddress || '-'}</Text>
          <Text>
            เลขประจำตัวผู้เสียภาษีอากร: {cert.vendorTaxId || '-'} (สาขา{' '}
            {cert.vendorBranch || '00000'})
          </Text>
        </View>

        <View style={pdfStyles.tableHeader}>
          <Text style={{ flex: 1 }}>ประเภทเงินได้พึงประเมินที่จ่าย</Text>
          <Text style={{ width: 90, textAlign: 'center' }}>วัน เดือน ปี ที่จ่าย</Text>
          <Text style={{ width: 110, textAlign: 'right' }}>จำนวนเงินที่จ่าย</Text>
          <Text style={{ width: 110, textAlign: 'right' }}>ภาษีที่หักและนำส่งไว้</Text>
        </View>

        <View style={pdfStyles.tableRow}>
          <Text style={{ flex: 1 }}>{cert.incomeType}</Text>
          <Text style={{ width: 90, textAlign: 'center' }}>
            {formatThaiDate(cert.paidAt)}
          </Text>
          <Text style={{ width: 110, textAlign: 'right' }}>฿{cert.basis}</Text>
          <Text style={{ width: 110, textAlign: 'right' }}>฿{cert.wht}</Text>
        </View>

        <View style={pdfStyles.totalsBox}>
          <View style={pdfStyles.bahtTextBox}>
            <Text style={{ fontWeight: 'bold' }}>
              รวมเงินภาษีที่หักนำส่ง (ตัวอักษร): ({bahtText(D(cert.wht))})
            </Text>
            <Text style={{ marginTop: 4 }}>
              เงื่อนไขการหักภาษี: [X] หัก ณ ที่จ่าย   [ ] ออกให้ตลอดไป   [ ] ออกให้ครั้งเดียว
            </Text>
          </View>
        </View>

        <View style={pdfStyles.signaturesRow}>
          <View style={pdfStyles.signatureBox}>
            <Text>(ผู้มีหน้าที่หักภาษี ณ ที่จ่าย)</Text>
            <Text style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              วันที่ {formatThaiDate(cert.paidAt)}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
