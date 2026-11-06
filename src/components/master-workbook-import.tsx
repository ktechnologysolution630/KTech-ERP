'use client';

import React, { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, FileUp, X } from 'lucide-react';
import { importItemCatalogAction, importVendorDirectoryAction, type DirectoryImportReply } from '@/app/(app)/master/actions';
import { parseMasterWorkbook, UNKNOWN_UNIT, type MasterWorkbookResult } from '@/domain/master-import';
import { EXCEL_LOCK_FILE_MESSAGE, isExcelLockFile, readWorkbook } from '@/lib/read-workbook';
import type { DirectoryImportResult } from '@/server/services/import';

const MAX_LISTED = 8;
const IMPORT_BATCH_SIZE = 50;

const hasFailures = (outcome: { vendors: DirectoryImportResult | null; items: DirectoryImportResult | null }) =>
  [outcome.vendors, outcome.items].some((r) => r && r.errors.length > 0);

function RowList({ rows }: { rows: string[] }) {
  return (
    <ul className="mt-1 list-disc pl-4 font-normal">
      {rows.slice(0, MAX_LISTED).map((r) => (
        <li key={r}>{r}</li>
      ))}
      {rows.length > MAX_LISTED && <li>และอีก {rows.length - MAX_LISTED} แถว</li>}
    </ul>
  );
}

function Outcome({ label, result, link }: { label: string; result: DirectoryImportResult; link: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-900">{label}</span>
        <Link href={link} className="text-[#2453d4] underline">
          ดูรายการ
        </Link>
      </div>
      <p className="mt-0.5 text-slate-600">
        เพิ่มใหม่ {result.created.toLocaleString()} · เติมข้อมูลที่ขาด {result.updated.toLocaleString()} · มีอยู่แล้ว {result.unchanged.toLocaleString()}
      </p>
      {result.errors.length > 0 && (
        <div role="alert" className="mt-1 font-semibold text-red-600">
          ไม่สำเร็จ {result.errors.length} รายการ
          <RowList rows={result.errors.map((e) => e.message)} />
        </div>
      )}
    </div>
  );
}

/** Takes the vendor and item lists out of a purchase order workbook. The file is read in the browser and never changed. */
export function MasterWorkbookImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [review, setReview] = useState<{ fileName: string; found: MasterWorkbookResult } | null>(null);
  const [withVendors, setWithVendors] = useState(true);
  const [withItems, setWithItems] = useState(true);
  const [outcome, setOutcome] = useState<{ vendors: DirectoryImportResult | null; items: DirectoryImportResult | null } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const handleFile = async (file: File) => {
    setReadError(null);
    setIsReading(true);
    try {
      if (isExcelLockFile(file.name)) {
        setReadError(EXCEL_LOCK_FILE_MESSAGE);
        return;
      }
      const sheets = await readWorkbook(file);
      const found = parseMasterWorkbook(sheets);
      if (found.vendors.length === 0 && found.items.length === 0) {
        setReadError(`ไม่พบรายชื่อผู้ขายหรือรายการสินค้าใน "${file.name}" (อ่านได้ ${sheets.length.toLocaleString()} ชีต) ต้องมีหัวตาราง VENDOR กับ TAX ID หรือ รหัสสินค้า กับ รายการสินค้า`);
        return;
      }
      setWithVendors(found.vendors.length > 0);
      setWithItems(found.items.length > 0);
      setOutcome(null);
      setSaveError(null);
      setReview({ fileName: file.name, found });
    } catch (err) {
      console.error(err);
      setReadError(err instanceof Error && err.message === 'PASSWORD' ? 'ไฟล์นี้ตั้งรหัสผ่านไว้ จึงอ่านไม่ได้' : 'อ่านไฟล์ไม่ได้ หากเปิดไฟล์นี้ค้างอยู่ใน Excel ให้ปิดก่อนแล้วลองใหม่');
    } finally {
      setIsReading(false);
    }
  };

  /** Sends a list in small batches: one long request could be cut off by the host partway through, and rows already in are skipped on a retry. */
  const inBatches = async <T,>(rows: T[], label: string, send: (batch: T[]) => Promise<DirectoryImportReply>): Promise<DirectoryImportResult> => {
    const total: DirectoryImportResult = { created: 0, updated: 0, unchanged: 0, errors: [] };
    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      setProgress(`${label} ${start.toLocaleString()} / ${rows.length.toLocaleString()}`);
      const reply = await send(rows.slice(start, start + IMPORT_BATCH_SIZE));
      if (!reply.ok) throw new Error(reply.error);
      total.created += reply.result.created;
      total.updated += reply.result.updated;
      total.unchanged += reply.result.unchanged;
      total.errors.push(...reply.result.errors);
    }
    return total;
  };

  const save = () => {
    if (!review) return;
    setSaveError(null);
    startSaving(async () => {
      let vendors: DirectoryImportResult | null = null;
      let items: DirectoryImportResult | null = null;
      try {
        if (withVendors) vendors = await inBatches(review.found.vendors, 'กำลังนำเข้าผู้ขาย', importVendorDirectoryAction);
        if (withItems) items = await inBatches(review.found.items, 'กำลังนำเข้าสินค้า', importItemCatalogAction);
      } catch (err) {
        console.error(err);
        setSaveError(`นำเข้าไม่ครบ: ${err instanceof Error && err.message ? err.message : 'เชื่อมต่อไม่สำเร็จ'} รายการที่เข้าแล้วยังอยู่ กดนำเข้าไฟล์เดิมซ้ำเพื่อทำต่อได้ ไม่เกิดรายการซ้ำ`);
      }
      setProgress(null);
      setOutcome({ vendors, items });
      router.refresh();
    });
  };

  const found = review?.found;
  const close = () => !isSaving && setReview(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        aria-label="เลือกไฟล์ใบสั่งซื้อเพื่อนำเข้าผู้ขายและสินค้า"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={isReading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        <FileUp className="h-4 w-4" />
        <span>{isReading ? 'กำลังอ่านไฟล์...' : 'นำเข้าผู้ขายและสินค้า'}</span>
      </button>
      {readError && (
        <p role="alert" className="basis-full text-right text-xs font-medium text-red-600">
          {readError}
        </p>
      )}

      {review && found && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="ตรวจสอบก่อนนำเข้าผู้ขายและสินค้า">
          <div className="flex max-h-full w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">ตรวจสอบก่อนนำเข้าผู้ขายและสินค้า</h3>
                <p className="truncate text-slate-500">{review.fileName}</p>
              </div>
              <button type="button" onClick={close} disabled={isSaving} className="text-slate-400 hover:text-slate-600" title="ปิด">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 space-y-3 overflow-y-auto p-5">
              {outcome ? (
                <>
                  {!saveError && !hasFailures(outcome) ? (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" /> นำเข้าเรียบร้อยแล้ว
                    </div>
                  ) : (
                    <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-700">
                      <AlertCircle className="h-4 w-4 shrink-0" /> นำเข้าไม่ครบ กรุณาดูรายละเอียดด้านล่าง
                    </div>
                  )}
                  {outcome.vendors && <Outcome label="ผู้ขาย" result={outcome.vendors} link="/purchasing/vendors" />}
                  {outcome.items && <Outcome label="สินค้า" result={outcome.items} link="/master/items" />}
                  {saveError && (
                    <p role="alert" className="font-medium text-red-600">
                      {saveError}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {found.vendors.length > 0 && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <input type="checkbox" checked={withVendors} onChange={(e) => setWithVendors(e.target.checked)} className="mt-0.5" />
                      <span>
                        <span className="font-semibold text-slate-900">ผู้ขาย {found.vendors.length.toLocaleString()} ราย</span>
                        <span className="mt-0.5 block text-slate-600">
                          นิติบุคคล {found.vendors.filter((v) => v.type === 'COMPANY').length.toLocaleString()} · บุคคลธรรมดา {found.vendors.filter((v) => v.type === 'INDIVIDUAL').length.toLocaleString()} · ระบบออกรหัสให้ ตั้งเครดิต 30 วัน และหัก ณ ที่จ่าย 0% แก้ภายหลังได้
                        </span>
                      </span>
                    </label>
                  )}
                  {found.items.length > 0 && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <input type="checkbox" checked={withItems} onChange={(e) => setWithItems(e.target.checked)} className="mt-0.5" />
                      <span>
                        <span className="font-semibold text-slate-900">สินค้า {found.items.length.toLocaleString()} รายการ</span>
                        <span className="mt-0.5 block text-slate-600">
                          ไฟล์ไม่มีหน่วยในรายการสินค้า จึงใช้หน่วยจากใบสั่งซื้อ {found.poSheetsRead.toLocaleString()} ใบในไฟล์นี้
                        </span>
                      </span>
                    </label>
                  )}

                  {found.itemsWithoutUnit > 0 && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        สินค้า {found.itemsWithoutUnit.toLocaleString()} รายการไม่เคยอยู่ในใบสั่งซื้อของไฟล์นี้ จึงไม่ทราบหน่วย ระบบจะใส่หน่วยว่า &quot;{UNKNOWN_UNIT}&quot; ไว้ก่อน แก้หน่วยในใบขอซื้อแต่ละใบได้
                      </span>
                    </p>
                  )}
                  {found.itemsWithSeveralUnits > 0 && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>สินค้า {found.itemsWithSeveralUnits.toLocaleString()} รายการเคยซื้อด้วยหลายหน่วย ระบบเลือกหน่วยที่ใช้บ่อยที่สุด</span>
                    </p>
                  )}
                  {found.invalidTaxIds.length > 0 && (
                    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-900">
                      เลขผู้เสียภาษีไม่ถูกต้อง {found.invalidTaxIds.length} ราย ระบบจะนำเข้าผู้ขายโดยเว้นเลขนี้ไว้ กรุณาตรวจกับเอกสารจริงก่อนออก 50 ทวิ
                      <RowList rows={found.invalidTaxIds} />
                    </div>
                  )}
                  {[...found.skippedVendors, ...found.skippedItems].length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                      <span className="font-semibold">ข้าม {found.skippedVendors.length + found.skippedItems.length} แถว</span>
                      <RowList rows={[...found.skippedVendors, ...found.skippedItems]} />
                    </div>
                  )}
                  <p className="text-slate-500">ผู้ขายและสินค้าที่มีอยู่แล้วจะไม่ถูกเขียนทับ ผู้ขายจะเติมเฉพาะข้อมูลที่ยังว่าง นำเข้าซ้ำได้ และไฟล์ต้นฉบับไม่ถูกแก้ไข</p>
                  {saveError && (
                    <p role="alert" className="font-medium text-red-600">
                      {saveError}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
              {outcome ? (
                <button type="button" onClick={close} className="rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white hover:bg-[#1c43ab]">
                  ปิด
                </button>
              ) : (
                <>
                  <button type="button" onClick={close} disabled={isSaving} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
                    ยกเลิก
                  </button>
                  <button type="button" onClick={save} disabled={isSaving || (!withVendors && !withItems)} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                    {isSaving ? (progress ?? 'กำลังนำเข้า...') : 'นำเข้า'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
