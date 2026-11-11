import path from 'node:path';
import React from 'react';
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import { type Signer } from '@/domain/signature';
import { type Settings } from '@/server/services/settings';

let fontsRegistered = false;

export function ensureFontsRegistered() {
  if (fontsRegistered) return;
  const fontsDir = path.join(process.cwd(), 'src', 'pdf', 'fonts');
  Font.register({
    family: 'Sarabun',
    fonts: [
      {
        src: path.join(fontsDir, 'Sarabun-Regular.ttf'),
        fontWeight: 'normal',
      },
      {
        src: path.join(fontsDir, 'Sarabun-Bold.ttf'),
        fontWeight: 'bold',
      },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

export const pdfStyles = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
    fontSize: 12,
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 36,
    color: '#0f172a',
  },
  watermark: {
    position: 'absolute',
    top: '40%',
    left: '28%',
    fontSize: 96,
    color: '#e2e8f0',
    opacity: 0.4,
    transform: 'rotate(-35deg)',
    fontWeight: 'bold',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 10,
    marginBottom: 12,
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  docTitleBox: {
    alignItems: 'flex-end',
  },
  docTitleTh: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  docTitleEn: {
    fontSize: 11,
    color: '#475569',
  },
  metaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  metaBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 8,
    borderRadius: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  totalsBox: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bahtTextBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 6,
    marginRight: 16,
  },
  numbersBox: {
    width: 200,
  },
  numberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  signaturesRow: {
    marginTop: 28,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  signatureBox: {
    width: 150,
    alignItems: 'center',
  },
  /** Where a signature sits, resting on the line */
  signatureSpace: {
    width: 150,
    height: 42,
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: '#94a3b8',
    paddingBottom: 2,
    marginBottom: 6,
  },
});

export function PdfShell({
  settings,
  titleTh,
  titleEn,
  docNumber,
  docDate,
  isDraft,
  signatures,
  children,
  footer,
}: {
  settings: Settings;
  titleTh: string;
  titleEn: string;
  docNumber: string;
  docDate: string;
  isDraft?: boolean;
  /** A bare label is a blank line; a signer who has acted in the system is drawn on it */
  signatures: (string | Signer)[];
  children: React.ReactNode;
  /** Sits at the bottom of the last page, or on a page of its own if it does not fit */
  footer?: React.ReactNode;
}) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        {isDraft && <Text style={pdfStyles.watermark}>ร่าง</Text>}

        <View style={pdfStyles.headerRow}>
          <View>
            <Text style={pdfStyles.companyName}>{settings.companyName}</Text>
            <Text>{settings.companyAddress}</Text>
            <Text>
              เลขประจำตัวผู้เสียภาษี: {settings.companyTaxId} (สาขา {settings.companyBranch})
            </Text>
          </View>
          <View style={pdfStyles.docTitleBox}>
            <Text style={pdfStyles.docTitleTh}>{titleTh}</Text>
            <Text style={pdfStyles.docTitleEn}>{titleEn}</Text>
            <Text style={{ marginTop: 4, fontWeight: 'bold' }}>เลขที่: {docNumber}</Text>
            <Text>วันที่: {docDate}</Text>
          </View>
        </View>

        {children}

        <View style={pdfStyles.signaturesRow}>
          {signatures.map((entry) => {
            const s: Signer = typeof entry === 'string' ? { label: entry } : entry;
            return (
              <View key={s.label} style={pdfStyles.signatureBox} wrap={false}>
                <View style={pdfStyles.signatureSpace}>
                  {s.image ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image src={s.image} style={{ maxWidth: 140, maxHeight: 38, objectFit: 'contain' }} />
                  ) : s.name ? (
                    <Text style={{ fontSize: 11 }}>{s.name}</Text>
                  ) : null}
                </View>
                <Text>({s.label})</Text>
                {s.name && <Text style={{ fontSize: 10 }}>{s.name}</Text>}
                <Text style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {s.name ? (s.date ? `วันที่ ${s.date}` : 'ลงนามในระบบ') : 'วันที่ ......../......../........'}
                </Text>
              </View>
            );
          })}
        </View>

        {footer && (
          <View wrap={false} style={{ marginTop: 'auto', paddingTop: 16 }}>
            {footer}
          </View>
        )}
      </Page>
    </Document>
  );
}
