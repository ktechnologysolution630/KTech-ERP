import React from 'react';
import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { branchLabel, COMPANY_NAME_EN } from '@/domain/brand';
import { bahtText, D, formatMoneyDisplay, VAT_RATE, type VatMode } from '@/domain/money';
import { type Signer } from '@/domain/signature';
import { type Settings } from '@/server/services/settings';
import { companyLogo } from './layout';

/**
 * Pieces of the boxed purchasing form, shared by the purchase requisition and the purchase order
 * so the two print alike.
 */

export const LINE = '#334155';
export const LINE_WIDTH = 0.8;
export const SIDE_WIDTH = 150;
export const TOTALS_WIDTH = 225;
/** Room for the logo, and the same on the right, leaving the company address one line where it can */
const HEADER_SIDE_WIDTH = 90;

export const fs = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
    fontSize: 9.5,
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 28,
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
  box: { borderWidth: LINE_WIDTH, borderColor: LINE },
  cellRight: { borderRightWidth: LINE_WIDTH, borderColor: LINE },
  cellBottom: { borderBottomWidth: LINE_WIDTH, borderColor: LINE },
  pad: { paddingHorizontal: 5, paddingVertical: 3 },
  bold: { fontWeight: 'bold' },
  small: { fontSize: 8.5, color: '#334155' },
  tableHeader: {
    flexDirection: 'row',
    borderTopWidth: LINE_WIDTH,
    borderBottomWidth: LINE_WIDTH,
    borderColor: LINE,
    paddingVertical: 2,
    fontSize: 8.5,
    fontWeight: 'bold',
  },
  tableRow: { flexDirection: 'row', paddingVertical: 3 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
});

/** A label and its value on one line, the value wrapping under itself */
export function Field({ label, value, labelWidth = 56, bold }: { label: string; value: string; labelWidth?: number; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 1.5 }}>
      <Text style={[fs.bold, { width: labelWidth }]}>{label} :</Text>
      <Text style={[{ flex: 1 }, bold ? fs.bold : {}]}>{value}</Text>
    </View>
  );
}

/** 6.00, or 2.125 when the quantity carries a third decimal */
export function qtyText(qty: string): string {
  return formatMoneyDisplay(qty, D(qty).decimalPlaces() > 2 ? 3 : 2);
}

export function vatLabel(mode: VatMode): string {
  return mode === 'NONE' ? 'VAT (ไม่คิดภาษี)' : mode === 'INCLUSIVE' ? `VAT ${VAT_RATE}% (รวมในราคา)` : `VAT ${VAT_RATE}%`;
}

/** A column heading in Thai over English */
export function HeaderCell({ th, en, width, align = 'center' }: { th: string; en: string; width?: number; align?: 'left' | 'center' | 'right' }) {
  return (
    <View style={[width ? { width } : { flex: 1 }, { paddingHorizontal: 3, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }]}>
      <Text>{th}</Text>
      <Text style={{ fontWeight: 'normal' }}>{en}</Text>
    </View>
  );
}

/** An A4 page with the company header on every page, and "ร่าง" across it while the document is not final */
export function FormPage({ settings, isDraft, children }: { settings: Settings; isDraft: boolean; children: React.ReactNode }) {
  const logo = companyLogo();
  return (
    <Page size="A4" style={fs.page}>
      {isDraft && (
        <Text style={fs.watermark} fixed>
          ร่าง
        </Text>
      )}

      <View fixed style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
        <View style={{ width: HEADER_SIDE_WIDTH }}>
          {logo && (
            // A PDF image has no alt text
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logo} style={{ width: 66, height: 60, objectFit: 'contain' }} />
          )}
        </View>
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: 'bold' }}>{settings.companyName}</Text>
          <Text style={{ fontSize: 10.5, fontWeight: 'bold' }}>{COMPANY_NAME_EN}</Text>
          <Text style={{ textAlign: 'center' }}>{settings.companyAddress}</Text>
          <Text style={{ textAlign: 'center' }}>
            {branchLabel(settings.companyBranch)} เลขประจำตัวผู้เสียภาษี {settings.companyTaxId}
          </Text>
        </View>
        {/* Balances the logo so the company name stays centred */}
        <View style={{ width: HEADER_SIDE_WIDTH }} />
      </View>

      {children}
    </Page>
  );
}

/** The document name centred, its number and date to the right */
export function TitleRow({ titleTh, titleEn, number, date }: { titleTh: string; titleEn: string; number: string; date: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6 }}>
      <View style={{ width: SIDE_WIDTH }} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{titleTh}</Text>
        <Text style={{ fontSize: 10 }}>{titleEn}</Text>
      </View>
      <View style={{ width: SIDE_WIDTH }}>
        <Field label="เลขที่" value={number} labelWidth={36} bold />
        <Field label="วันที่" value={date} labelWidth={36} />
      </View>
    </View>
  );
}

/** The figures beside the note, then the net amount with its words in a box */
export function TotalsBlock({ note, rows, gross }: { note: string; rows: [string, string][]; gross: string }) {
  return (
    <>
      <View style={{ flexDirection: 'row', borderTopWidth: LINE_WIDTH, borderColor: LINE, paddingTop: 4 }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Field label="คำอธิบาย" value={note || '-'} labelWidth={46} />
        </View>
        <View style={{ width: TOTALS_WIDTH }}>
          {rows.map(([label, value]) => (
            <View key={label} style={fs.totalRow}>
              <Text>{label}</Text>
              <Text>{formatMoneyDisplay(value)}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={[fs.box, { flexDirection: 'row', marginTop: 3 }]}>
        <Text style={[fs.pad, fs.bold, { flex: 1, textAlign: 'center', backgroundColor: '#f1f5f9' }]}>({bahtText(D(gross))})</Text>
        <View style={[fs.pad, { width: TOTALS_WIDTH, flexDirection: 'row', justifyContent: 'space-between', borderLeftWidth: LINE_WIDTH, borderColor: LINE }]}>
          <Text style={fs.bold}>รวมเงินสุทธิ</Text>
          <Text style={fs.bold}>{formatMoneyDisplay(gross)}</Text>
        </View>
      </View>
    </>
  );
}

/** One boxed row of signature spaces; a signer who has acted in the system is drawn on the line */
export function SignatureRow({ signatures }: { signatures: Signer[] }) {
  return (
    <View style={[fs.box, { flexDirection: 'row', borderTopWidth: 0 }]}>
      {signatures.map((sig, i) => (
        <View
          key={sig.label}
          style={{ flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 4, borderLeftWidth: i ? LINE_WIDTH : 0, borderColor: LINE }}
        >
          <View style={{ height: 34, justifyContent: 'flex-end', alignItems: 'center' }}>
            {sig.image ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={sig.image} style={{ maxWidth: 130, maxHeight: 32, objectFit: 'contain' }} />
            ) : sig.name ? (
              <Text>{sig.name}</Text>
            ) : null}
          </View>
          <View style={{ width: 140, borderBottomWidth: 0.6, borderColor: '#64748b', marginBottom: 3 }} />
          <Text style={fs.bold}>{sig.label}</Text>
          {sig.image && sig.name ? <Text style={{ fontSize: 8.5 }}>{sig.name}</Text> : null}
          <Text style={{ fontSize: 8, color: '#475569' }}>
            {sig.name ? `วันที่ ${sig.date ?? '........................'}` : 'วันที่ ......../......../........'}
          </Text>
        </View>
      ))}
    </View>
  );
}
