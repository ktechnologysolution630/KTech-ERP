'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eraser, ImageUp, PenLine, Trash2 } from 'lucide-react';
import { deleteSignatureAction, saveSignatureAction } from './actions';

/** What is saved: wide enough to stay sharp on an A4 signature line */
const OUT_W = 600;
const OUT_H = 200;
const INK = '#0f172a';

/**
 * Draw a signature with a finger, pen or mouse, or bring in a picture of one. It is kept as a
 * transparent PNG so it sits on the paper like ink.
 */
export function SignatureEditor({ current, updatedAt }: { current: string | null; updatedAt: string | null }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const ctx = () => canvas.current?.getContext('2d') ?? null;
  useEffect(() => {
    const c = ctx();
    if (!c) return;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = INK;
    c.lineWidth = 3.2;
  }, []);

  /** Pointer position in the canvas's own pixels, whatever size it is shown at */
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * OUT_W, y: ((e.clientY - box.top) / box.height) * OUT_H };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Keeps the stroke going when the pointer leaves the pad; drawing works without it
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that cannot be captured still draws */
    }
    const p = at(e);
    last.current = p;
    const c = ctx();
    if (!c) return;
    // A tap leaves a dot
    c.beginPath();
    c.arc(p.x, p.y, c.lineWidth / 2, 0, Math.PI * 2);
    c.fillStyle = INK;
    c.fill();
    setHasInk(true);
    setSaved(false);
    setError(null);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = at(e);
    const c = ctx();
    if (!c) return;
    c.beginPath();
    c.moveTo(last.current.x, last.current.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    last.current = p;
  };
  /** Lifting the pen finishes the stroke where it was lifted, even after a flick too quick to report a move */
  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    move(e);
    last.current = null;
  };

  const clear = () => {
    ctx()?.clearRect(0, 0, OUT_W, OUT_H);
    setHasInk(false);
    setError(null);
  };

  /** A photo or scan of a signature: fitted to the pad, with the paper made see-through */
  const upload = async (file: File) => {
    setError(null);
    setSaved(false);
    if (!file.type.startsWith('image/')) {
      setError('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const c = ctx();
      if (!c) return;
      c.clearRect(0, 0, OUT_W, OUT_H);
      const scale = Math.min(OUT_W / bitmap.width, OUT_H / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      c.drawImage(bitmap, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);
      const px = c.getImageData(0, 0, OUT_W, OUT_H);
      for (let i = 0; i < px.data.length; i += 4) {
        const light = (px.data[i]! + px.data[i + 1]! + px.data[i + 2]!) / 3;
        // Paper goes clear, ink stays, and the grey in between fades so edges are not jagged
        if (light > 200) px.data[i + 3] = 0;
        else if (light > 120) px.data[i + 3] = Math.round((px.data[i + 3]! * (200 - light)) / 80);
      }
      c.putImageData(px, 0, 0);
      setHasInk(true);
    } catch {
      setError('เปิดรูปนี้ไม่ได้ กรุณาลองไฟล์ JPG หรือ PNG');
    }
  };

  const save = () => {
    if (!hasInk || !canvas.current) {
      setError('กรุณาเซ็นชื่อในกรอบ หรืออัปโหลดรูปลายเซ็นก่อนบันทึก');
      return;
    }
    const image = canvas.current.toDataURL('image/png');
    setError(null);
    startTransition(async () => {
      const r = await saveSignatureAction(image);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      clear();
      setSaved(true);
      router.refresh();
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      await deleteSignatureAction();
      setSaved(false);
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">ลายเซ็นที่ใช้อยู่</h2>
        {current ? (
          <>
            <div className="flex h-36 items-center justify-center rounded-lg border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current} alt="ลายเซ็นของคุณ" className="max-h-28 max-w-full object-contain" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>{updatedAt ? `บันทึกเมื่อ ${updatedAt}` : ''}</span>
              <button type="button" disabled={pending} onClick={remove} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> ลบลายเซ็น
              </button>
            </div>
          </>
        ) : (
          <p className="flex h-36 items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 text-center text-xs text-slate-500">ยังไม่มีลายเซ็น เอกสารที่คุณจัดทำหรืออนุมัติจะแสดงเฉพาะชื่อและวันที่</p>
        )}
        <p className="text-[11px] leading-relaxed text-slate-500">
          ลายเซ็นนี้จะถูกลงในช่องผู้ขอ ผู้จัดทำ หรือผู้อนุมัติ โดยอัตโนมัติเมื่อคุณส่งหรือกดอนุมัติเอกสารในระบบ ไม่มีใครตั้งหรือใช้ลายเซ็นแทนคุณได้
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <PenLine className="h-4 w-4 text-[#2453d4]" /> {current ? 'เปลี่ยนลายเซ็น' : 'สร้างลายเซ็น'}
        </h2>
        <canvas
          ref={canvas}
          width={OUT_W}
          height={OUT_H}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-label="กรอบเซ็นชื่อ"
          className="w-full cursor-crosshair touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white"
          style={{ aspectRatio: `${OUT_W} / ${OUT_H}` }}
        />
        <p className="text-[11px] text-slate-500">เซ็นชื่อในกรอบด้วยนิ้ว ปากกา หรือเมาส์ หรืออัปโหลดรูปลายเซ็นที่เซ็นบนกระดาษขาว</p>
        {error && (
          <p role="alert" className="text-xs font-medium text-red-600">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-xs font-medium text-emerald-700">
            บันทึกลายเซ็นแล้ว
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Eraser className="h-3.5 w-3.5" /> ล้าง
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <ImageUp className="h-3.5 w-3.5" /> อัปโหลดรูป
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
          </label>
          <button type="button" disabled={pending} onClick={save} className="ml-auto rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50">
            {pending ? 'กำลังบันทึก...' : 'บันทึกลายเซ็น'}
          </button>
        </div>
      </section>
    </div>
  );
}
