import React from 'react';
import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { COMPANY_NAME_EN } from '@/domain/brand';
import { contactLine, type FormHeader } from '@/domain/form-templates';
import { bahtText, D, formatMoneyDisplay, VAT_RATE, type VatMode } from '@/domain/money';
import { isSubCondition } from '@/domain/po-conditions';
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
/** The logo beside a left-aligned company, a little smaller so the letterhead takes less height */
const COMPACT_LOGO_SIZE = { width: 78, height: 72 };
const RADIUS = 3;
const MUTED = '#475569';

/**
 * Type sizes in points. Sarabun's Thai sits small for its size, so the body is set at 12 to read
 * easily on a printed A4 page.
 */
export const TYPE = {
  body: 12,
  /** Detail lines under an item, the letterhead address, the form note */
  small: 11,
  /** The English line under a heading */
  tiny: 9.5,
} as const;

export const fs = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
    fontSize: TYPE.body,
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
  small: { fontSize: TYPE.small, color: MUTED },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND,
    color: '#ffffff',
    paddingVertical: 4,
    fontSize: TYPE.small,
    fontWeight: 'bold',
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
  },
  /** Every other item row, tinted so a long line is easy to follow across */
  tableRowAlt: { backgroundColor: '#f6f9fc' },
  /** A ruled item table's outline; it grows to fill the page so the column lines reach the foot */
  ruledTable: { flexGrow: 1, borderWidth: LINE_WIDTH, borderColor: LINE, borderRadius: RADIUS },
  /** A row of a ruled table: the padding sits in the cells so the column lines run its full height */
  ruledRow: { flexDirection: 'row', borderBottomWidth: LINE_WIDTH, borderColor: LINE },
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
  tight,
}: {
  label: string;
  value: string;
  labelWidth?: number;
  bold?: boolean;
  /** right: the label sits flush against its value, the colons lined up */
  labelAlign?: 'left' | 'right';
  /** No gap under the line, for boxes set close to leave the items more room */
  tight?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: tight ? 0 : 2 }}>
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

/** One cell of a ruled item table, with a line on its right unless it is the last column */
export function RuledCell({
  width,
  last,
  style,
  children,
}: {
  width?: number;
  last?: boolean;
  style?: { paddingHorizontal?: number };
  children?: React.ReactNode;
}) {
  return (
    <View style={[width ? { width } : { flex: 1 }, { paddingVertical: 4 }, last ? {} : { borderRightWidth: LINE_WIDTH, borderColor: LINE }, style ?? {}]}>
      {children}
    </View>
  );
}

/**
 * Empty ruled columns under the last item, filling the rest of the page as on a printed form;
 * one width per column, undefined for the description that takes the rest
 */
export function RuledFiller({ widths }: { widths: (number | undefined)[] }) {
  return (
    <View style={{ flexGrow: 1, flexDirection: 'row' }}>
      {widths.map((width, i) => (
        <RuledCell key={i} width={width} last={i === widths.length - 1} />
      ))}
    </View>
  );
}

/** A column heading in Thai over English */
export function HeaderCell({
  th,
  en,
  width,
  align = 'center',
  ruled = false,
  last = false,
}: {
  th: string;
  en: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  /**
   * In a ruled table: the cell takes the heading's height and a pale line on its right carries the
   * column lines up through the heading; the heading row then drops its own padding
   */
  ruled?: boolean;
  /** The last column of a ruled table, with no line on its right */
  last?: boolean;
}) {
  return (
    <View
      style={[
        width ? { width } : { flex: 1 },
        { paddingHorizontal: 4, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' },
        ruled ? { paddingVertical: 4 } : {},
        ruled && !last ? { borderRightWidth: LINE_WIDTH, borderColor: '#5d97c9' } : {},
      ]}
    >
      <Text>{th}</Text>
      <Text style={{ fontWeight: 'normal', fontSize: TYPE.tiny, color: '#d6e6f5' }}>{en}</Text>
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
  docTitle,
  children,
}: {
  settings: Settings;
  /** The English name and contact lines set in the form settings; the defaults when left out */
  header?: FormHeader;
  isDraft: boolean;
  docNumber: string;
  /**
   * The document's name, number and date, set in the letterhead's right-hand side with the company
   * flush left beside the logo. Left out, the company is centred and the page draws its own TitleRow.
   */
  docTitle?: DocTitle;
  children: React.ReactNode;
}) {
  const contact = contactLine(header);
  const logo = companyLogo();
  const footText = { fontSize: TYPE.tiny, color: '#94a3b8' };
  const align = docTitle ? 'left' : 'center';
  const companyLine = { textAlign: align, fontSize: TYPE.small, color: MUTED } as const;
  return (
    // The PO runs closer to the top and bottom edges, still inside what an office printer can reach
    <Page size="A4" style={[fs.page, docTitle ? { paddingTop: 14, paddingBottom: 26 } : {}]}>
      {isDraft && (
        <Text style={fs.watermark} fixed>
          ร่าง
        </Text>
      )}

      <View fixed style={{ marginBottom: docTitle ? 5 : 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: docTitle ? COMPACT_LOGO_SIZE.width + 10 : HEADER_SIDE_WIDTH }}>
            {logo && (
              // A PDF image has no alt text
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logo} style={{ ...(docTitle ? COMPACT_LOGO_SIZE : LOGO_SIZE), objectFit: 'contain' }} />
            )}
          </View>
          <View style={{ flex: 1, alignItems: docTitle ? 'flex-start' : 'center', paddingRight: docTitle ? 10 : 0 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: BRAND_DARK }}>{settings.companyName}</Text>
            <Text style={{ fontSize: 13, fontWeight: 'bold', color: BRAND, letterSpacing: 0.3, marginBottom: 2 }}>{header?.companyNameEn || COMPANY_NAME_EN}</Text>
            <Text style={companyLine}>
              {/* สำนักงานใหญ่, or the branch, leads the address */}
              {branchLabel(settings.companyBranch)} {settings.companyAddress}
            </Text>
            <Text style={companyLine}>เลขประจำตัวผู้เสียภาษี {settings.companyTaxId}</Text>
            {contact ? <Text style={companyLine}>{contact}</Text> : null}
          </View>
          {docTitle ? (
            <LetterheadTitle {...docTitle} />
          ) : (
            // Balances the logo so the company name stays centred
            <View style={{ width: HEADER_SIDE_WIDTH }} />
          )}
        </View>
        {/* The letterhead rule: a brand-blue line over a thin pale one */}
        <View style={{ marginTop: 6, height: 2, backgroundColor: BRAND }} />
        <View style={{ marginTop: 1.5, height: 0.6, backgroundColor: '#9ec3e6' }} />
      </View>

      {children}

      <View fixed style={{ position: 'absolute', bottom: docTitle ? 12 : 14, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={footText}>{docNumber}</Text>
        <Text style={footText} render={({ pageNumber, totalPages }) => `หน้า ${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  );
}

/** A document's name in Thai and English, with its number and date */
export interface DocTitle {
  titleTh: string;
  titleEn: string;
  number: string;
  date: string;
}

/** The document's number and date in a pale blue box */
function NumberBox({ number, date, compact }: { number: string; date: string; compact?: boolean }) {
  return (
    <View
      style={{
        width: SIDE_WIDTH,
        borderWidth: LINE_WIDTH,
        borderColor: BRAND,
        borderRadius: RADIUS,
        backgroundColor: BRAND_TINT,
        paddingHorizontal: 7,
        paddingVertical: compact ? 2 : 4,
      }}
    >
      <Field label="เลขที่" value={number} labelWidth={36} bold tight={compact} />
      <Field label="วันที่" value={date} labelWidth={36} tight={compact} />
    </View>
  );
}

/** The letterhead's right-hand side: the document name flush right, its number and date boxed under it */
function LetterheadTitle({ titleTh, titleEn, number, date }: DocTitle) {
  return (
    <View style={{ width: SIDE_WIDTH, alignItems: 'flex-end' }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold', color: BRAND_DARK }}>{titleTh}</Text>
      <Text style={{ fontSize: TYPE.tiny, color: '#64748b', letterSpacing: 1.2, marginBottom: 2 }}>{titleEn.toUpperCase()}</Text>
      <NumberBox number={number} date={date} compact />
    </View>
  );
}

/** The document name centred, its number and date boxed to the right */
export function TitleRow({ titleTh, titleEn, number, date }: DocTitle) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
      <View style={{ width: SIDE_WIDTH }} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 23, fontWeight: 'bold', color: BRAND_DARK }}>{titleTh}</Text>
        <Text style={{ fontSize: TYPE.small, color: '#64748b', letterSpacing: 1.2 }}>{titleEn.toUpperCase()}</Text>
      </View>
      <NumberBox number={number} date={date} />
    </View>
  );
}

/** The figures beside the note, then the net amount with its words in a box */
export function TotalsBlock({
  note,
  noteLabel = 'คำอธิบาย',
  rows,
  gross,
}: {
  note: string;
  /** The heading of the note beside the figures */
  noteLabel?: string;
  rows: [string, string][];
  gross: string;
}) {
  return (
    <>
      {/* No rule of its own: it sits right under the ruled item table's bottom edge */}
      <View style={{ flexDirection: 'row', paddingTop: 3 }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Field label={noteLabel} value={note || '-'} labelWidth={46} />
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
          {sig.image && sig.name ? <Text style={{ fontSize: TYPE.small }}>{sig.name}</Text> : null}
          <Text style={{ fontSize: TYPE.small, color: MUTED }}>
            {sig.name ? `วันที่ ${sig.date ?? '........................'}` : 'วันที่ ......../......../........'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A box's heading on the pale blue band, as the signature boxes have it */
function BoxHeading({ text, small }: { text: string; small?: boolean }) {
  return (
    <View style={{ alignSelf: 'stretch', alignItems: 'center', paddingVertical: 2.5, backgroundColor: BRAND_TINT }}>
      <Text style={[fs.bold, { color: BRAND_DARK }, small ? { fontSize: TYPE.small } : {}]}>{text}</Text>
    </View>
  );
}

/**
 * The foot of the PO: the standing billing and cheque terms on the left, and every signer in one
 * box on the right, each in a column of their own
 */
export function ConditionsAndSignatures({ title, conditions, signatures }: { title: string; conditions: string[]; signatures: Signer[] }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 6, gap: 6 }}>
      {/* The terms take a little under half the width; the three signers share the rest */}
      <View style={[fs.box, { flex: 0.85 }]}>
        <BoxHeading text={title} />
        <View style={{ paddingHorizontal: 6, paddingVertical: 3 }}>
          {conditions.map((line) => (
            <Text key={line} style={[{ fontSize: TYPE.small }, isSubCondition(line) ? { paddingLeft: 10 } : {}]}>
              {line}
            </Text>
          ))}
        </View>
      </View>
      <View style={[fs.box, { flex: 1.15, flexDirection: 'row' }]}>
        {signatures.map((sig, i) => (
          // One box for the three signers, with no lines between them
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingBottom: 5 }}>
            <BoxHeading text={sig.label} small />
            <View style={{ height: 36, justifyContent: 'flex-end', alignItems: 'center' }}>
              {sig.image ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={sig.image} style={{ maxWidth: 86, maxHeight: 32, objectFit: 'contain' }} />
              ) : sig.name ? (
                <Text style={{ fontSize: TYPE.small }}>{sig.name}</Text>
              ) : null}
            </View>
            {/* No dotted line to sign on: the box itself is the space */}
            <View style={{ height: 3 }} />
            {/* No date under the line: the PO carries its own date in the letterhead */}
            {sig.image && sig.name ? <Text style={{ fontSize: TYPE.small }}>{sig.name}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** The note set for the form in the settings, under the signature boxes; nothing when blank */
export function FormNote({ text }: { text: string }) {
  if (!text.trim()) return null;
  return <Text style={{ marginTop: 5, fontSize: TYPE.small, color: MUTED }}>{text}</Text>;
}
