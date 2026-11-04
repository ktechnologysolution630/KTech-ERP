'use client';

// Kept apart from the page: the QR and Excel libraries are large, and people scanning a label on site need neither.
import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { SpreadsheetImportBox } from '@/components/spreadsheet-import-box';
import { ASSET_IMPORT_COLUMNS } from '@/domain/asset';
import { downloadWorkbook } from '@/lib/spreadsheet';
import type { AssetRow } from '@/server/services/assets';
import { Dialog } from './asset-dialog';
import { importAssetsAction } from './actions';

type LabelImages = Record<string, string>;

function LabelGrid({ assets, images }: { assets: AssetRow[]; images: LabelImages }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {assets.map((a) => (
        <div key={a.id} className="keep-together flex items-center gap-2 rounded border border-dashed border-slate-300 bg-white p-2 text-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[a.id]} alt={`QR ${a.code}`} className="h-[24mm] w-[24mm] shrink-0" />
          <div className="min-w-0 text-[10px] leading-snug">
            <div className="font-mono font-bold">{a.code}</div>
            <div className="line-clamp-3 break-words">{a.name}</div>
            {a.serialNo && <div className="truncate text-slate-600">{a.serialNo}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LabelsDialog({ assets, onClose }: { assets: AssetRow[]; onClose: () => void }) {
  const [images, setImages] = useState<LabelImages | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    // The address comes from the browser, so labels point at whichever site they were printed from
    const entries = assets.map(async (a) => [a.id, await QRCode.toDataURL(`${window.location.origin}/assets?asset=${a.id}`, { width: 320, margin: 1 })] as const);
    Promise.all(entries)
      .then((pairs) => current && setImages(Object.fromEntries(pairs)))
      .catch((err: unknown) => {
        console.error(err);
        if (current) setError('สร้าง QR Code ไม่สำเร็จ กรุณาลองใหม่');
      });
    return () => {
      current = false;
    };
  }, [assets]);

  return (
    <Dialog title={`พิมพ์ QR Code ${assets.length} รายการ`} onClose={onClose} wide>
      {error ? (
        <p role="alert" className="font-medium text-red-600">
          {error}
        </p>
      ) : !images ? (
        <p className="py-8 text-center text-slate-500">กำลังสร้าง QR Code...</p>
      ) : (
        <div className="space-y-3">
          <p className="text-slate-500">สแกนด้วยกล้องมือถือเพื่อเปิดหน้าตรวจเช็คของทรัพย์สินชิ้นนั้น ผู้สแกนต้องมีบัญชีในระบบ</p>
          <LabelGrid assets={assets} images={images} />
          <div className="flex justify-end">
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white hover:bg-blue-700">
              <Printer className="h-4 w-4" /> พิมพ์
            </button>
          </div>
          <PrintRoot>
            <LabelGrid assets={assets} images={images} />
          </PrintRoot>
        </div>
      )}
    </Dialog>
  );
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const columns = Object.values(ASSET_IMPORT_COLUMNS);
  return (
    <Dialog title="นำเข้าทรัพย์สินจาก Excel" onClose={onClose} wide>
      <div className="space-y-3">
        <SpreadsheetImportBox title="เลือกไฟล์ทะเบียนทรัพย์สิน" hint={`ต้องมีคอลัมน์ ${ASSET_IMPORT_COLUMNS.name} ส่วนคอลัมน์อื่นเว้นว่างได้`} onImportRows={importAssetsAction} />
        <ul className="list-disc space-y-1 pl-4 text-slate-600">
          <li>ระบบออกรหัสทรัพย์สินให้เอง และไม่รับแถวที่หมายเลขเครื่อง/ทะเบียนซ้ำกับของเดิม จึงไม่ซ้ำแม้นำเข้าไฟล์เดิมอีกครั้ง ยกเว้นแถวที่ไม่มีหมายเลข</li>
          <li>เว้นรหัสโครงการไว้ หมายถึงอยู่ที่สำนักงาน</li>
          <li>วันที่ซื้อใช้รูปแบบ 2026-11-04 หรือ 4/11/2569 ก็ได้</li>
          <li>ถ้าใส่อายุการใช้งาน ต้องใส่วันที่ซื้อด้วย</li>
        </ul>
        <button
          type="button"
          onClick={() => void downloadWorkbook('asset-import-template.xlsx', columns, [])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-4 w-4" /> ดาวน์โหลดไฟล์ตัวอย่าง
        </button>
      </div>
    </Dialog>
  );
}

export function exportDepreciation(rows: AssetRow[], today: string): Promise<void> {
  return downloadWorkbook(
    `asset-depreciation-${today}.xlsx`,
    ['รหัส', 'ชื่อทรัพย์สิน', 'หมวด', 'วันที่ซื้อ', 'มูลค่า', 'มูลค่าซาก', 'อายุ (ปี)', 'ค่าเสื่อมต่อปี', 'ค่าเสื่อมปีนี้', 'ค่าเสื่อมสะสม', 'มูลค่าตามบัญชี'],
    rows.map((r) => [
      r.code,
      r.name,
      r.category,
      r.purchaseDate ?? '',
      r.purchaseValue ?? 0,
      r.salvageValue ?? 0,
      r.usefulLifeYears ?? '',
      r.depreciation?.perYear ?? '',
      r.depreciation?.thisYear ?? '',
      r.depreciation?.accumulated ?? '',
      r.depreciation?.bookValue ?? '',
    ]),
  );
}
