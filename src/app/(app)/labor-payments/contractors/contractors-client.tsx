'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, X, Search, Phone, Building2, CreditCard, Shield, Percent, Trash2 } from 'lucide-react';
import type { VendorDeleteResult } from '@/server/services/vendor-delete';
import { createContractorAction, deleteContractorsAction } from './actions';

export interface ContractorItem {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  workType: string;
  paymentTerms: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  retention: string;
  whtRate: string;
}

interface ContractorsClientProps {
  initialContractors: ContractorItem[];
  canDelete: boolean;
}

const DELETE_WORD = 'ลบ';

function DeleteContractorsDialog({ targets, onDeleted, onClose }: { targets: ContractorItem[]; onDeleted: (result: VendorDeleteResult) => void; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const r = await deleteContractorsAction(targets.map((t) => t.id));
      if (r.ok) onDeleted(r.result);
      else setError(r.error);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`ลบ ${targets.length} รายการ`}>
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">ลบผู้รับเหมาและผู้ขาย {targets.length} รายการ</h3>
          <button type="button" onClick={onClose} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {targets.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 px-3 py-1.5">
                <span className="shrink-0 font-mono text-[11px] text-slate-500">{t.code}</span>
                <span className="truncate text-slate-800" title={t.name}>
                  {t.name}
                </span>
              </li>
            ))}
          </ul>
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <p className="font-bold">ลบถาวร กู้คืนไม่ได้</p>
            <p className="mt-1">รายชื่อนี้ใช้ร่วมกับหน้าซัพพลายเออร์ จึงจะหายจากทั้งสองหน้า ใบขอเบิก และใบสั่งซื้อ ส่วนรายที่มีเอกสารแล้วระบบจะไม่ลบ และแจ้งให้ทราบ</p>
          </div>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">พิมพ์คำว่า &quot;{DELETE_WORD}&quot; เพื่อยืนยัน</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-red-500 focus:outline-none" />
          </label>
          {error && (
            <p role="alert" className="font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" onClick={confirm} disabled={isPending || typed.trim() !== DELETE_WORD} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {isPending ? 'กำลังลบ...' : `ลบ ${targets.length} รายการ`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContractorsClient({ initialContractors, canDelete }: ContractorsClientProps) {
  const [contractors, setContractors] = useState<ContractorItem[]>(initialContractors);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number; inUse: VendorDeleteResult['inUse'] } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const filtered = contractors.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.workType.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm),
  );

  const selectedRows = contractors.filter((c) => selected.has(c.id));
  const allShownSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleShown = () => setSelected(allShownSelected ? new Set() : new Set(filtered.map((c) => c.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const formData = new FormData(e.currentTarget);
    const res = await createContractorAction(formData);

    if (res.ok) {
      setShowModal(false);
      window.location.reload();
    } else {
      setErrorMsg(res.error || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header matching reference screenshot 2 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">
            ผู้รับเหมาและทีมงาน
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            จัดการข้อมูลผู้รับเหมา เงื่อนไขการจ่าย บัญชีธนาคาร และเอกสารประกอบ
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-3">
          <div className="relative w-48 sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาผู้รับเหมา..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white placeholder-slate-400 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white text-xs font-medium shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่มผู้รับเหมา</span>
          </button>
        </div>
          {canDelete && (
            <button
              type="button"
              disabled={selectedRows.length === 0}
              onClick={() => {
                setDeleteResult(null);
                setDeleting(true);
              }}
              title={selectedRows.length === 0 ? 'ติ๊กเลือกรายการที่จะลบก่อน' : undefined}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              <span>ลบ{selectedRows.length > 0 && ` (${selectedRows.length})`}</span>
            </button>
          )}
        </div>
      </div>

      {deleteResult && (
        <div role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">ลบแล้ว {deleteResult.deleted} รายการ</p>
            <button type="button" onClick={() => setDeleteResult(null)} className="text-slate-400 hover:text-slate-600" title="ปิด">
              <X className="h-4 w-4" />
            </button>
          </div>
          {deleteResult.inUse.length > 0 && (
            <div className="mt-1 text-amber-800">
              ไม่ได้ลบ {deleteResult.inUse.length} รายการ เพราะมีเอกสารอ้างถึงแล้ว
              <ul className="mt-1.5 space-y-1.5">
                {deleteResult.inUse.map((v) => (
                  <li key={v.id}>
                    <div className="font-medium">
                      {v.code} {v.name}
                    </div>
                    <ul className="mt-0.5 list-disc pl-4 text-slate-700">
                      {v.documents.map((doc, i) => (
                        <li key={`${doc.href}-${i}`}>
                          {doc.label}{' '}
                          <Link href={doc.href} className="font-mono text-[#2453d4] underline">
                            {doc.number}
                          </Link>
                          {doc.cancelled && <span className="text-slate-500"> (ยกเลิกแล้ว)</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Main Table Container matching reference Navy header */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102d72] text-white">
                {canDelete && (
                  <th className="w-8 py-3 pl-4">
                    <input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="เลือกทั้งหมดที่แสดง" className="align-middle" />
                  </th>
                )}
                <th className="py-3 px-4 font-medium">ผู้รับเหมา</th>
                <th className="py-3 px-4 font-medium">ผู้ติดต่อ</th>
                <th className="py-3 px-4 font-medium">ประเภทงาน</th>
                <th className="py-3 px-4 font-medium">เงื่อนไขจ่ายเงิน</th>
                <th className="py-3 px-4 font-medium">บัญชีธนาคาร</th>
                <th className="py-3 px-4 font-medium">ประกัน</th>
                <th className="py-3 px-4 font-medium">หัก ณ ที่จ่าย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canDelete ? 8 : 7} className="py-20 text-center text-slate-400 text-sm">
                    ยังไม่มีข้อมูลผู้รับเหมา
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    {canDelete && (
                      <td className="py-3 pl-4">
                        <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} aria-label={`เลือก ${item.name}`} className="align-middle" />
                      </td>
                    )}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{item.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{item.code}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <div>{item.contactPerson || '-'}</div>
                      {item.phone && <div className="text-[10px] text-slate-400">{item.phone}</div>}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                        {item.workType || 'งานทั่วไป'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{item.paymentTerms || 'ตามงวดงาน'}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {item.bankName ? (
                        <div>
                          <div className="font-medium text-slate-700">{item.bankName}</div>
                          <div className="text-[11px] font-mono text-slate-500">{item.bankAccountNo}</div>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{item.retention || '0%'}</td>
                    <td className="py-3 px-4 text-slate-600 font-medium">{item.whtRate || '3%'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleting && selectedRows.length > 0 && (
        <DeleteContractorsDialog
          targets={selectedRows}
          onClose={() => setDeleting(false)}
          onDeleted={({ deletedIds, inUse }) => {
            const gone = new Set(deletedIds);
            setContractors((prev) => prev.filter((c) => !gone.has(c.id)));
            // What could not go stays ticked for nothing; start clean
            setSelected(new Set());
            setDeleteResult({ deleted: deletedIds.length, inUse });
            setDeleting(false);
          }}
        />
      )}

      {/* Modal: เพิ่มผู้รับเหมา */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
              <h3 className="font-semibold text-sm text-slate-800">เพิ่มผู้รับเหมาและทีมงาน</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
              {errorMsg && (
                <div className="p-2.5 rounded-lg bg-red-50 text-red-600 border border-red-200 text-xs">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">รหัสผู้รับเหมา</label>
                  <input
                    type="text"
                    name="code"
                    placeholder="เช่น SUB-001"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">ชื่อผู้รับเหมา / ช่าง *</label>
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="เช่น ช่างสมหมาย งานโครงสร้าง"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">เบอร์โทรศัพท์</label>
                  <input
                    type="text"
                    name="phone"
                    placeholder="08X-XXX-XXXX"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">เลขประจำตัวผู้เสียภาษี (13 หลัก)</label>
                  <input
                    type="text"
                    name="taxId"
                    maxLength={13}
                    placeholder="13 หลัก (ถ้ามี)"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">ธนาคาร</label>
                  <input
                    type="text"
                    name="bankName"
                    placeholder="เช่น กสิกรไทย, กรุงเทพ"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">เลขที่บัญชี</label>
                  <input
                    type="text"
                    name="bankAccountNo"
                    placeholder="เช่น 123-4-56789-0"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">เครดิต / เงื่อนไขจ่ายเงิน (วัน)</label>
                  <input
                    type="number"
                    name="defaultCreditDays"
                    defaultValue={0}
                    placeholder="0 = ตามงวดงาน"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">อัตราหักภาษี ณ ที่จ่าย (%)</label>
                  <select
                    name="defaultWhtRate"
                    defaultValue={3}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value={0}>0% (ไม่หัก)</option>
                    <option value={1}>1% (ค่าขนส่ง)</option>
                    <option value={2}>2% (ค่าโฆษณา)</option>
                    <option value={3}>3% (ค่าบริการ / ค่าแรงช่าง)</option>
                    <option value={5}>5% (ค่าเช่า)</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-1.5 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white font-medium transition disabled:opacity-50"
                >
                  {loading ? 'กำลังบันทึก...' : 'บันทึกผู้รับเหมา'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
