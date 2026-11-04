'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, CheckCircle2, LocateFixed, MapPin, RefreshCw, TriangleAlert } from 'lucide-react';
import { INSPECTION_RESULT_LABELS, mapEmbedUrl, type CheckLocation, type InspectionResult } from '@/domain/asset';
import { shrinkPhoto } from '@/lib/shrink-photo';
import type { AssetRow } from '@/server/services/assets';
import { Dialog } from './asset-dialog';
import { confirmAssetCheckAction } from './actions';

type Step = 'PHOTO' | 'MAP' | 'CONFIRM' | 'DONE';

const STEPS: { key: Step; label: string }[] = [
  { key: 'PHOTO', label: 'ถ่ายรูป' },
  { key: 'MAP', label: 'ยืนยันตำแหน่ง' },
  { key: 'CONFIRM', label: 'ยืนยันสถานะ' },
];
const PROBLEM_RESULTS: InspectionResult[] = ['DAMAGED', 'REPAIR', 'MISSING'];
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
/** Just under the server action limit in next.config.ts */
const MAX_PHOTO_BYTES = 4.5 * 1024 * 1024;

const primaryButton = 'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2453d4] px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60';
const secondaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60';

function locationErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return 'เบราว์เซอร์ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาเปิดสิทธิ์ตำแหน่งของเว็บนี้แล้วกดลองใหม่';
  if (err.code === err.TIMEOUT) return 'หาตำแหน่งไม่ทัน กรุณาออกไปที่โล่งแล้วกดลองใหม่';
  return 'หาตำแหน่งไม่ได้ กรุณาเปิด GPS ของเครื่องแล้วกดลองใหม่';
}

function StepBar({ current }: { current: Step }) {
  const currentIndex = current === 'DONE' ? STEPS.length : STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="mb-4 grid grid-cols-3 gap-2">
      {STEPS.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={s.key} aria-current={active ? 'step' : undefined} className={`flex flex-col items-center gap-1 text-center text-[11px] font-medium ${active ? 'text-[#2453d4]' : done ? 'text-emerald-700' : 'text-slate-400'}`}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${active ? 'border-[#2453d4] bg-blue-50' : done ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200'}`}>
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

function PhotoStep({ preview, busy, onPick, onNext }: { preview: string | null; busy: boolean; onPick: (file: File | undefined) => void; onNext: () => void }) {
  return (
    <div className="space-y-3">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="รูปยืนยันทรัพย์สิน" className="max-h-72 w-full rounded-lg border border-slate-200 object-contain" />
      ) : (
        <p className="text-slate-600">ถ่ายรูปทรัพย์สินให้เห็นชัดเจน ถ้าหาไม่พบให้ถ่ายจุดที่เคยเก็บไว้</p>
      )}
      <label className={`${preview ? secondaryButton : primaryButton} w-full cursor-pointer focus-within:ring-2 focus-within:ring-[#2453d4] ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="ถ่ายรูปยืนยัน"
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Camera className="h-5 w-5" /> {busy ? 'กำลังเตรียมรูป...' : preview ? 'ถ่ายใหม่' : 'ถ่ายรูปยืนยัน'}
      </label>
      {preview && !busy && (
        <button type="button" onClick={onNext} className={primaryButton}>
          ใช้รูปนี้
        </button>
      )}
    </div>
  );
}

function MapStep({ location, locating, error, onLocate, onConfirm, onBack }: { location: CheckLocation | null; locating: boolean; error: string | null; onLocate: () => void; onConfirm: () => void; onBack: () => void }) {
  return (
    <div className="space-y-3">
      {location && (
        <>
          <iframe title="แผนที่ตำแหน่งปัจจุบัน" src={mapEmbedUrl(location)} className="h-60 w-full rounded-lg border border-slate-200" />
          <p className="flex items-start gap-1.5 text-slate-600">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-mono">
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </span>{' '}
              (คลาดเคลื่อนประมาณ {Math.round(location.accuracyMeters)} เมตร)
            </span>
          </p>
        </>
      )}
      {locating && <p className="py-6 text-center text-slate-500">กำลังหาตำแหน่งปัจจุบัน...</p>}
      {error && (
        <p role="alert" className="font-medium text-red-600">
          {error}
        </p>
      )}
      {location && !locating && (
        <button type="button" onClick={onConfirm} className={primaryButton}>
          <LocateFixed className="h-5 w-5" /> ยืนยันตำแหน่งนี้
        </button>
      )}
      <div className="flex justify-between gap-2">
        <button type="button" onClick={onBack} className={secondaryButton}>
          ย้อนกลับ
        </button>
        <button type="button" onClick={onLocate} disabled={locating} className={secondaryButton}>
          <RefreshCw className="h-3.5 w-3.5" /> {error ? 'ลองใหม่' : 'หาตำแหน่งใหม่'}
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({ preview, location, busy, error, onSubmit, onBack }: { preview: string; location: CheckLocation; busy: boolean; error: string | null; onSubmit: (result: InspectionResult, note: string) => void; onBack: () => void }) {
  const [reportingProblem, setReportingProblem] = useState(false);
  const [result, setResult] = useState<InspectionResult>('DAMAGED');
  const [note, setNote] = useState('');
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="รูปยืนยันทรัพย์สิน" className="h-16 w-16 shrink-0 rounded object-cover" />
        <div className="min-w-0 space-y-1 text-slate-600">
          <p className="flex items-center gap-1 font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" /> ถ่ายรูปและยืนยันตำแหน่งแล้ว
          </p>
          <p className="truncate font-mono text-[11px]">
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="font-medium text-red-600">
          {error}
        </p>
      )}
      {!reportingProblem ? (
        <>
          <button type="button" disabled={busy} onClick={() => onSubmit('GOOD', '')} className={`${primaryButton} bg-emerald-600 py-4 text-base hover:bg-emerald-700`}>
            <CheckCircle2 className="h-5 w-5" /> {busy ? 'กำลังบันทึก...' : 'Active'}
          </button>
          <p className="text-center text-slate-500">กด Active เมื่อทรัพย์สินอยู่ครบและใช้งานได้ตามปกติ</p>
          <div className="flex justify-between gap-2">
            <button type="button" onClick={onBack} disabled={busy} className={secondaryButton}>
              ย้อนกลับ
            </button>
            <button type="button" onClick={() => setReportingProblem(true)} disabled={busy} className={`${secondaryButton} text-amber-800`}>
              <TriangleAlert className="h-3.5 w-3.5" /> พบปัญหา
            </button>
          </div>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(result, note);
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            {PROBLEM_RESULTS.map((r) => (
              <label key={r} className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 font-semibold focus-within:ring-2 focus-within:ring-[#2453d4] ${result === r ? 'border-amber-600 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                <input type="radio" name="check-problem" value={r} checked={result === r} onChange={() => setResult(r)} className="sr-only" />
                {INSPECTION_RESULT_LABELS[r]}
              </label>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">
              รายละเอียด <span className="text-red-500">*</span>
            </span>
            <textarea required rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#2453d4] focus:outline-hidden" />
          </label>
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setReportingProblem(false)} disabled={busy} className={secondaryButton}>
              ย้อนกลับ
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
              {busy ? 'กำลังบันทึก...' : 'บันทึกปัญหา'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The on-site check. Nothing is saved until the last step, so leaving part way records nothing. */
export function AssetCheckDialog({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const [step, setStep] = useState<Step>('PHOTO');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [location, setLocation] = useState<CheckLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedResult, setSavedResult] = useState<InspectionResult | null>(null);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreparing(true);
    const shrunk = await shrinkPhoto(file);
    setPreparing(false);
    if (!PHOTO_TYPES.includes(shrunk.type)) setError('เปิดรูปนี้ไม่ได้ กรุณาถ่ายใหม่เป็น JPG หรือ PNG');
    else if (shrunk.size > MAX_PHOTO_BYTES) setError('รูปมีขนาดใหญ่เกินไป กรุณาถ่ายใหม่');
    else setPhoto(shrunk);
  };

  const locate = useCallback(() => {
    setError(null);
    setLocation(null);
    if (!navigator.geolocation) {
      setError('เครื่องหรือเบราว์เซอร์นี้ระบุตำแหน่งไม่ได้ กรุณาใช้มือถือที่เปิด GPS');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy });
        setLocating(false);
      },
      (err) => {
        setError(locationErrorMessage(err));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, []);

  const goToMap = () => {
    setStep('MAP');
    if (!location) locate();
  };

  const submit = (result: InspectionResult, note: string) => {
    if (!photo || !location) return;
    setError(null);
    const form = new FormData();
    form.set('photo', photo);
    form.set('result', result);
    form.set('note', note);
    form.set('latitude', String(location.latitude));
    form.set('longitude', String(location.longitude));
    form.set('accuracyMeters', String(location.accuracyMeters));
    startSaving(async () => {
      try {
        const r = await confirmAssetCheckAction(asset.id, form);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setSavedResult(result);
        setStep('DONE');
        router.refresh();
      } catch (err) {
        console.error(err);
        setError('บันทึกไม่สำเร็จ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่');
      }
    });
  };

  return (
    <Dialog title={`ตรวจเช็ค ${asset.code} ${asset.name}`} onClose={onClose} busy={isSaving}>
      <StepBar current={step} />
      {step === 'PHOTO' && (
        <>
          <PhotoStep preview={preview} busy={preparing} onPick={(f) => void pickPhoto(f)} onNext={goToMap} />
          {error && (
            <p role="alert" className="mt-3 font-medium text-red-600">
              {error}
            </p>
          )}
        </>
      )}
      {step === 'MAP' && <MapStep location={location} locating={locating} error={error} onLocate={locate} onConfirm={() => setStep('CONFIRM')} onBack={() => setStep('PHOTO')} />}
      {step === 'CONFIRM' && preview && location && <ConfirmStep preview={preview} location={location} busy={isSaving} error={error} onSubmit={submit} onBack={() => setStep('MAP')} />}
      {step === 'DONE' && (
        <div className="space-y-3 py-4 text-center">
          {savedResult === 'GOOD' ? <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /> : <TriangleAlert className="mx-auto h-12 w-12 text-amber-600" />}
          <p className="text-base font-bold text-slate-900">{savedResult === 'GOOD' ? 'สถานะ Active แล้ว' : `บันทึกผล "${savedResult && INSPECTION_RESULT_LABELS[savedResult]}" แล้ว`}</p>
          <button type="button" onClick={onClose} className={primaryButton}>
            ปิด
          </button>
        </div>
      )}
    </Dialog>
  );
}
