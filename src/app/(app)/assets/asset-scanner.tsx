'use client';

// Loaded only when someone taps "สแกน QR": the decoder is not needed for the list.
import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Keyboard, ScanLine } from 'lucide-react';
import { Dialog } from './asset-dialog';

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (opts: { formats: string[] }) => Detector;

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'เบราว์เซอร์ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาเปิดสิทธิ์กล้องของเว็บนี้แล้วกดลองใหม่';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'ไม่พบกล้องบนเครื่องนี้ พิมพ์รหัสทรัพย์สินด้านล่างแทนได้';
  if (name === 'NotReadableError') return 'กล้องถูกแอปอื่นใช้อยู่ กรุณาปิดแอปนั้นแล้วกดลองใหม่';
  return 'เปิดกล้องไม่ได้ พิมพ์รหัสทรัพย์สินด้านล่างแทนได้';
}

/**
 * Camera QR scanner. Calls onScan with each decoded text; the parent decides what it means.
 * `message` is shown under the camera (e.g. "not found") while scanning continues.
 * `ignore` is the label just checked: it may still be in view when the scanner reopens.
 */
export function AssetScanner({ onScan, onClose, message, ignore }: { onScan: (text: string) => void; onClose: () => void; message: string | null; ignore?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const ignoreRef = useRef(ignore);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let last = ignoreRef.current ?? '';
    let lastAt = last ? Date.now() + 1500 : 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const NativeDetector = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    const detector = NativeDetector ? new NativeDetector({ formats: ['qr_code'] }) : null;

    const report = (text: string) => {
      // The same label stays in view for many frames: report it once every 2.5 s at most
      const now = Date.now();
      if (text === last && now - lastAt < 2500) return;
      last = text;
      lastAt = now;
      navigator.vibrate?.(60);
      onScanRef.current(text);
    };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          let text: string | null = null;
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue ?? null;
          } else if (ctx) {
            const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (text && !stopped) report(text);
        } catch (err) {
          console.error(err);
        }
      }
      if (!stopped) frame = window.setTimeout(() => void tick(), 200);
    };

    (async () => {
      setCameraError(null);
      setStarting(true);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('เบราว์เซอร์นี้เปิดกล้องไม่ได้ พิมพ์รหัสทรัพย์สินด้านล่างแทนได้');
        setStarting(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setStarting(false);
        void tick();
      } catch (err) {
        if (stopped) return;
        setCameraError(cameraErrorMessage(err));
        setStarting(false);
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attempt]);

  return (
    <Dialog title="สแกน QR ทรัพย์สิน" onClose={onClose}>
      <div className="space-y-3">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-900">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          {!cameraError && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-3/5 w-3/5 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
            </div>
          )}
          {(starting || cameraError) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white">
              <ScanLine className="h-10 w-10 opacity-70" />
              <p>{starting ? 'กำลังเปิดกล้อง...' : cameraError}</p>
              {cameraError && (
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-slate-800">
                  ลองใหม่
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-center text-slate-600">เล็งกล้องไปที่ QR Code บนป้ายทรัพย์สิน ระบบจะเปิดหน้าตรวจเช็คให้เอง</p>
        {message && (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-center font-medium text-amber-800">
            {message}
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onScan(typed);
          }}
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">พิมพ์รหัสทรัพย์สิน</span>
            <Keyboard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="หรือพิมพ์รหัส เช่น AST-6911-0003"
              autoCapitalize="characters"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-brand focus:outline-hidden"
            />
          </label>
          <button type="submit" className="shrink-0 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-blue-700">
            เปิด
          </button>
        </form>
      </div>
    </Dialog>
  );
}
