/**
 * Picks the fields of a bill out of text read from its picture. Reading is never perfect, so every
 * value is a suggestion for a person to check before anything is saved.
 */
export interface BillFields {
  vendorName: string;
  /** 13-digit tax ids found, the company's own left out */
  taxIds: string[];
  invoiceNo: string;
  /** ISO date, or '' when none was read */
  date: string;
  total: number | null;
  vat: number | null;
  beforeVat: number | null;
}

const THAI_MONTHS: [RegExp, number][] = [
  [/ม\.?\s?ค\.?|มกราคม/, 1],
  [/ก\.?\s?พ\.?|กุมภาพันธ์/, 2],
  [/มี\.?\s?ค\.?|มีนาคม/, 3],
  [/เม\.?\s?ย\.?|เมษายน/, 4],
  [/พ\.?\s?ค\.?|พฤษภาคม/, 5],
  [/มิ\.?\s?ย\.?|มิถุนายน/, 6],
  [/ก\.?\s?ค\.?|กรกฎาคม/, 7],
  [/ส\.?\s?ค\.?|สิงหาคม/, 8],
  [/ก\.?\s?ย\.?|กันยายน/, 9],
  [/ต\.?\s?ค\.?|ตุลาคม/, 10],
  [/พ\.?\s?ย\.?|พฤศจิกายน/, 11],
  [/ธ\.?\s?ค\.?|ธันวาคม/, 12],
];
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const arabic = (s: string) => s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));

function iso(day: number, month: number, year: number): string {
  // Buddhist era, or a two-digit year of either calendar
  let y = year;
  if (y > 2400) y -= 543;
  else if (y < 100) y = y >= 43 ? y + 2500 - 543 : y + 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || y < 2000 || y > 2100) return '';
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return '';
  return d.toISOString().slice(0, 10);
}

export function findDate(text: string): string {
  const t = arabic(text);
  const numeric = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/.exec(t);
  if (numeric) {
    const d = iso(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
    if (d) return d;
  }
  const worded = /(\d{1,2})\s*([ก-๙.\s]{2,12}?)\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (worded) {
    const month = THAI_MONTHS.find(([re]) => re.test(worded[2]!))?.[1];
    if (month) return iso(Number(worded[1]), month, Number(worded[3]));
  }
  return '';
}

/** Money amounts on a line: digits with thousands commas and two decimals */
function amounts(line: string): number[] {
  return [...arabic(line).matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g)].map((m) => Number(`${m[1]!.replace(/,/g, '')}.${m[2]}`));
}

const TOTAL = /รวมทั้งสิ้น|ยอดรวมสุทธิ|จำนวนเงินรวมทั้งสิ้น|ยอดสุทธิ|ยอดชำระ|grand\s*total|net\s*total|total\s*amount/i;
const SUBTOTAL = /รวมเงิน|รวมเป็นเงิน|มูลค่าสินค้า|ราคาไม่รวมภาษี|ก่อนภาษี|sub\s*total|before\s*vat/i;
const VAT = /ภาษีมูลค่าเพิ่ม|vat/i;
const COMPANY = /บริษัท|ห้างหุ้นส่วน|หจก\.?|บจก\.?|ร้าน/;
const INVOICE_NO = /(?:เลขที่(?:ใบกำกับภาษี|เอกสาร)?|invoice\s*no\.?|no\.?|เล่มที่)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9/-]{2,24})/i;

/**
 * The recogniser writes sara am as two marks (ํ then า, a tone mark sometimes between them). Left that
 * way a name looks right but never matches the same name typed on a keyboard.
 */
const tidy = (line: string) =>
  line
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ํ([่-๋]?)า/g, '$1ำ')
    .trim();

export function parseBillText(lines: string[], opts: { ownTaxId?: string; ownName?: string } = {}): BillFields {
  const clean = lines.map(tidy).filter(Boolean);
  const all = clean.join('\n');

  const own = (opts.ownTaxId ?? '').replace(/\D/g, '');
  const taxIds = [...new Set([...arabic(all).matchAll(/(?<!\d)(\d[\d\s-]{11,20}\d)(?!\d)/g)].map((m) => m[1]!.replace(/\D/g, '')).filter((d) => d.length === 13 && d !== own))];

  const ownName = (opts.ownName ?? '').replace(/\s/g, '');
  const vendorName =
    clean.find((l) => COMPANY.test(l) && l.length <= 120 && !(ownName && l.replace(/\s/g, '').includes(ownName.slice(0, 12)))) ?? '';

  const invoiceNo = clean.map((l) => INVOICE_NO.exec(arabic(l))?.[1]).find((v): v is string => !!v && /\d/.test(v)) ?? '';

  const dateLine = clean.find((l) => /วันที่|date/i.test(l) && findDate(l));
  const date = dateLine ? findDate(dateLine) : (clean.map(findDate).find(Boolean) ?? '');

  const last = (re: RegExp, not?: RegExp) => {
    const hits = clean.filter((l) => re.test(l) && !(not && not.test(l))).flatMap((l) => amounts(l).slice(-1));
    return hits.length ? hits : null;
  };
  const totals = last(TOTAL);
  const everything = clean.flatMap(amounts);
  const total = totals ? Math.max(...totals) : everything.length ? Math.max(...everything) : null;
  const vatHits = last(VAT, TOTAL);
  let vat = vatHits ? vatHits[vatHits.length - 1]! : null;
  const subHits = last(SUBTOTAL, TOTAL);
  let beforeVat = subHits ? Math.max(...subHits) : null;
  // The three must agree; two of them give the third
  const round = (n: number) => Math.round(n * 100) / 100;
  if (total !== null && vat !== null && vat >= total) vat = null;
  if (total !== null && vat !== null) beforeVat = round(total - vat);
  else if (total !== null && beforeVat !== null && beforeVat <= total) vat = round(total - beforeVat);
  else if (total !== null) beforeVat = total;

  return { vendorName: vendorName.replace(/\s{2,}/g, ' '), taxIds, invoiceNo, date, total, vat, beforeVat };
}
