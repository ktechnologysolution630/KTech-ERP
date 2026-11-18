import React from 'react';
import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { COMPANY_NAME_EN } from '@/domain/brand';
import { contactLine, type FormHeader } from '@/domain/form-templates';
import { bahtText, D, formatMoneyDisplay, VAT_RATE, type VatMode } from '@/domain/money';
import { type Signer } from '@/domain/signature';
import { type Settings } from '@/server/services/settings';
import { companyLogo } from './layout';

/**
 * Pieces of the boxed purchasing form, shared by the purchase requisition and the purchase order
 * so the two print alike.
 */

/** The blue of the K TECH logo, and a deeper shade for headings */
export const BRAND = '#1668a8';
export const BRAND_DARK = '#0e4677';
/** Pale blue behind the document number, the signature labels and the amount in words */
export const BRAND_TINT = '#eaf2fa';
export const LINE = '#9db0c4';
export const LINE_WIDTH = 0.8;
export const SIDE_WIDTH = 150;
export const TOTALS_WIDTH = 225;
/** Room for the logo, and the same on the right, so the company name stays centred */
const HEADER_SIDE_WIDTH = 104;
/** The logo file is 368 x 338 px, enough for print at this size */
const LOGO_SIZE = { width: 92, height: 85 };
const RADIUS = 3;
const MUTED = '#475569';

export const fs = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
    fontSize: 9.5,
    paddingTop: 22,
    // Room for the document number and page count at the foot
    paddingBottom: 34,
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
  box: { borderWidth: LINE_WIDTH, borderColor: LINE, borderRadius: RADIUS },
  cellRight: { borderRightWidth: LINE_WIDTH, borderColor: LINE },
  cellBottom: { borderBottomWidth: LINE_WIDTH, borderColor: LINE },
  pad: { paddingHorizontal: 6, paddingVertical: 4 },
  bold: { fontWeight: 'bold' },
  label: { fontWeight: 'bold', color: '#334155' },
  /** The heading inside a box, e.g. ซัพพลายเออร์อ้างอิง */
  sectionTitle: { fontWeight: 'bold', color: BRAND_DARK, marginBottom: 3 },
  small: { fontSize: 8.5, color: MUTED },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND,
    color: '#ffffff',
    paddingVertical: 4,
    fontSize: 8.5,
    fontWeight: 'bold',
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderColor: '#dbe4ee' },
  /** Every other item row, tinted so a long line is easy to follow across */
  tableRowAlt: { backgroundColor: '#f6f9fc' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
});

const thaiWords = new Intl.Segmenter('th', { granularity: 'word' });

/**
 * Thai text in a narrow cell. Thai has no spaces between words, so the PDF cannot break a phrase such
 * as งานระบบไฟฟ้าและสื่อสาร and it runs into the next column; here each word is laid out on its own
 * and the cell wraps between them.
 */
export function WrapText({
  text,
  width,
  style,
  align = 'left',
}: {
  text: string;
  width: number;
  style?: { fontSize?: number; color?: string };
  /** centre: each line sits in the middle of the cell, under a centred heading */
  align?: 'left' | 'center';
}) {
  return (
    <View
      style={{
        width,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        paddingHorizontal: 3,
      }}
    >
      {[...thaiWords.segment(text)].map(({ segment }, i) =>
        // A space between words keeps its gap; a line may also break there
        segment.trim() ? (
          <Text key={i} style={style}>
            {segment}
          </Text>
        ) : (
          <View key={i} style={{ width: 2.5 }} />
        ),
      )}
    </View>
  );
}

/** A label and its value on one line, the value wrapping under itself */
export function Field({
  label,
  value,
  labelWidth = 56,
  bold,
  labelAlign = 'left',
}: {
  label: string;
  value: string;
  labelWidth?: number;
  bold?: boolean;
  /** right: the label sits flush against its value, the colons lined up */
  labelAlign?: 'left' | 'right';
}) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 2 }}>
      <Text style={[fs.label, { width: labelWidth }, labelAlign === 'right' ? { textAlign: 'right', paddingRight: 4 } : {}]}>{label} :</Text>
      <Text style={[{ flex: 1 }, bold ? fs.bold : {}]}>{value}</Text>
    </View>
  );
}

const isHeadOffice = (branch: string) => !branch || branch === '00000';

export function branchLabel(branch: string): string {
  return isHeadOffice(branch) ? 'สำนักงานใหญ่' : `สาขา ${branch}`;
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
    <View style={[width ? { width } : { flex: 1 }, { paddingHorizontal: 4, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }]}>
      <Text>{th}</Text>
      <Text style={{ fontWeight: 'normal', fontSize: 7.5, color: '#d6e6f5' }}>{en}</Text>
    </View>
  );
}

/**
 * An A4 page with the company letterhead, and the document number and page count at the foot, on
 * every page; "ร่าง" across it while the document is not final
 */
export function FormPage({
  settings,
  header,
  isDraft,
  docNumber,
  children,
}: {
  settings: Settings;
  /** The English name and contact lines set in the form settings; the defaults when left out */
  header?: FormHeader;
  isDraft: boolean;
  docNumber: string;
  children: React.ReactNode;
}) {
  const contact = contactLine(header);
  const logo = companyLogo();
  const footText = { fontSize: 7.5, color: '#94a3b8' };
  return (
    <Page size="A4" style={fs.page}>
      {isDraft && (
        <Text style={fs.watermark} fixed>
          ร่าง
        </Text>
      )}

      <View fixed style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: HEADER_SIDE_WIDTH }}>
            {logo && (
              // A PDF image has no alt text
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logo} style={{ ...LOGO_SIZE, objectFit: 'contain' }} />
            )}
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: BRAND_DARK }}>{settings.companyName}</Text>
            <Text style={{ fontSize: 11.5, fontWeight: 'bold', color: BRAND, letterSpacing: 0.3, marginBottom: 2 }}>{header?.companyNameEn || COMPANY_NAME_EN}</Text>
            <Text style={{ textAlign: 'center', fontSize: 8.5, color: MUTED }}>
              {/* สำนักงานใหญ่, or the branch, leads the address */}
              {branchLabel(settings.companyBranch)} {settings.companyAddress}
            </Text>
            <Text style={{ textAlign: 'center', fontSize: 8.5, color: MUTED }}>เลขประจำตัวผู้เสียภาษี {settings.companyTaxId}</Text>
            {contact ? <Text style={{ textAlign: 'center', fontSize: 8.5, color: MUTED }}>{contact}</Text> : null}
          </View>
          {/* Balances the logo so the company name stays centred */}
          <View style={{ width: HEADER_SIDE_WIDTH }} />
        </View>
        {/* The letterhead rule: a brand-blue line over a thin pale one */}
        <View style={{ marginTop: 6, height: 2, backgroundColor: BRAND }} />
        <View style={{ marginTop: 1.5, height: 0.6, backgroundColor: '#9ec3e6' }} />
      </View>

      {children}

      <View fixed style={{ position: 'absolute', bottom: 14, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={footText}>{docNumber}</Text>
        <Text style={footText} render={({ pageNumber, totalPages }) => `หน้า ${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  );
}

/** The document name centred, its number and date boxed to the right */
export function TitleRow({ titleTh, titleEn, number, date }: { titleTh: string; titleEn: string; number: string; date: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
      <View style={{ width: SIDE_WIDTH }} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 19, fontWeight: 'bold', color: BRAND_DARK }}>{titleTh}</Text>
        <Text style={{ fontSize: 9, color: '#64748b', letterSpacing: 1.2 }}>{titleEn.toUpperCase()}</Text>
      </View>
      <View
        style={{
          width: SIDE_WIDTH,
          borderWidth: LINE_WIDTH,
          borderColor: BRAND,
          borderRadius: RADIUS,
          backgroundColor: BRAND_TINT,
          paddingHorizontal: 7,
          paddingVertical: 4,
        }}
      >
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
      <View style={[fs.box, { flexDirection: 'row', marginTop: 3, borderColor: BRAND }]}>
        <Text style={[fs.pad, fs.bold, { flex: 1, textAlign: 'center', backgroundColor: BRAND_TINT, color: BRAND_DARK }]}>({bahtText(D(gross))})</Text>
        <View
          style={[
            fs.pad,
            { width: TOTALS_WIDTH, flexDirection: 'row', justifyContent: 'space-between', borderLeftWidth: LINE_WIDTH, borderColor: BRAND, backgroundColor: BRAND, color: '#ffffff' },
          ]}
        >
          <Text style={fs.bold}>รวมเงินสุทธิ</Text>
          <Text style={fs.bold}>{formatMoneyDisplay(gross)}</Text>
        </View>
      </View>
    </>
  );
}

/** A box per signer, its role on a pale band at the top; a signer who has acted in the system is drawn on the line */
export function SignatureRow({ signatures }: { signatures: Signer[] }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 6, gap: 6 }}>
      {signatures.map((sig, i) => (
        <View key={i} style={[fs.box, { flex: 1, alignItems: 'center', paddingBottom: 5 }]}>
          <View
            style={{
              alignSelf: 'stretch',
              alignItems: 'center',
              paddingVertical: 2.5,
              backgroundColor: BRAND_TINT,
              borderTopLeftRadius: RADIUS,
              borderTopRightRadius: RADIUS,
            }}
          >
            <Text style={[fs.bold, { color: BRAND_DARK }]}>{sig.label}</Text>
          </View>
          <View style={{ height: 36, justifyContent: 'flex-end', alignItems: 'center' }}>
            {sig.image ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={sig.image} style={{ maxWidth: 130, maxHeight: 32, objectFit: 'contain' }} />
            ) : sig.name ? (
              <Text>{sig.name}</Text>
            ) : null}
          </View>
          <View style={{ width: 130, borderBottomWidth: 0.6, borderColor: '#64748b', borderStyle: 'dotted', marginBottom: 3 }} />
          {sig.image && sig.name ? <Text style={{ fontSize: 8.5 }}>{sig.name}</Text> : null}
          <Text style={{ fontSize: 8, color: MUTED }}>
            {sig.name ? `วันที่ ${sig.date ?? '........................'}` : 'วันที่ ......../......../........'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The note set for the form in the settings, under the signature boxes; nothing when blank */
export function FormNote({ text }: { text: string }) {
  if (!text.trim()) return null;
  return <Text style={{ marginTop: 5, fontSize: 8.5, color: MUTED }}>{text}</Text>;
}
