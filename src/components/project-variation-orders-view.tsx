'use client';

import React, { useState } from 'react';
import {
  FilePlus,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Paperclip,
  Download,
  Printer,
  Calendar,
  Building2,
  DollarSign,
  User,
  X,
  Eye,
  Check,
  Edit2,
  Trash2,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

export interface VariationOrderItem {
  id: string;
  code: string;
  title: string;
  reason: string;
  category: string;
  requestDate: string;
  approvedBy: string;
  amount: number;
  timeExtensionDays: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  attachmentsCount?: number;
  breakdownItems?: {
    id: string;
    description: string;
    qty: number;
    unit: string;
    unitPrice: number;
    total: number;
  }[];
}

interface ProjectVariationOrdersViewProps {
  projectId: string;
  projectCode?: string;
  projectName?: string;
}

export function ProjectVariationOrdersView({
  projectId,
  projectCode = 'PJ-0001',
  projectName = 'อาคารสำนักงานตัวอย่าง',
}: ProjectVariationOrdersViewProps) {
  // Initial items based on the user's screenshot
  const [voList, setVoList] = useState<VariationOrderItem[]>([
    {
      id: 'vo-1',
      code: 'VO-001',
      title: 'ปรับเพิ่มความลึกเสาเข็มจาก 21 ม. เป็น 24 ม. ตามสภาพชั้นดินจริง',
      reason: 'จากการทดสอบ Boring Test หน้างาน พบชั้นทรายแน่นที่ระดับลึกกว่าที่กำหนดในแบบเดิม 3 เมตร จำเป็นต้องเพิ่มความยาวเสาเข็มเพื่อความปลอดภัยของโครงสร้างอาคาร',
      category: 'งานฐานรากและโครงสร้างใต้ดิน',
      requestDate: '2026-09-20',
      approvedBy: 'ผู้ควบคุมงานอาคารฯ',
      amount: 255000,
      timeExtensionDays: 7,
      status: 'APPROVED',
      attachmentsCount: 3,
      breakdownItems: [
        {
          id: 'b-1',
          description: 'ค่าต่อเสาเข็มเจาะและปลอกเหล็กเพิ่ม 3.00 ม. (จํานวน 16 ต้น)',
          qty: 16,
          unit: 'ต้น',
          unitPrice: 12000,
          total: 192000,
        },
        {
          id: 'b-2',
          description: 'ค่าน้ำยาเคมีประสานและทดสอบ Seismic Integrity Test เพิ่มเติม',
          qty: 1,
          unit: 'เหมา',
          unitPrice: 63000,
          total: 63000,
        },
      ],
    },
    {
      id: 'vo-2',
      code: 'VO-002',
      title: 'งานเสริมเหล็กโครงสร้างห้องมั่นคงชั้นใต้ดิน',
      reason: 'ผู้ว่าจ้างขอปรับปรุงมาตรฐานความปลอดภัยของห้องเก็บสำนวนคดีและของกลางตามระเบียบใหม่ของสำนักงานศาลยุติธรรม',
      category: 'งานโครงสร้างคอนกรีตเสริมเหล็ก',
      requestDate: '2026-10-12',
      approvedBy: 'รออนุมัติจากสำนักการโยธา',
      amount: 148000,
      timeExtensionDays: 5,
      status: 'PENDING',
      attachmentsCount: 2,
      breakdownItems: [
        {
          id: 'b-3',
          description: 'เหล็กข้ออ้อย DB20 SD40 เสริมผนังกันเจาะสองชั้น',
          qty: 3.2,
          unit: 'ตัน',
          unitPrice: 32000,
          total: 102400,
        },
        {
          id: 'b-4',
          description: 'ค่าแรงผูกเหล็กและติดตั้งแผ่นเหล็กหนา 6 มม.',
          qty: 1,
          unit: 'เหมา',
          unitPrice: 45600,
          total: 45600,
        },
      ],
    },
  ]);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedVo, setSelectedVo] = useState<VariationOrderItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Form State for New VO
  const [newVoForm, setNewVoForm] = useState({
    code: `VO-00${voList.length + 1}`,
    title: '',
    reason: '',
    category: 'งานฐานรากและโครงสร้างใต้ดิน',
    requestDate: new Date().toISOString().split('T')[0],
    approvedBy: 'ผู้ควบคุมงานอาคารฯ',
    amount: 0,
    timeExtensionDays: 0,
    breakdownItems: [
      {
        id: 'item-1',
        description: '',
        qty: 1,
        unit: 'งาน',
        unitPrice: 0,
        total: 0,
      },
    ],
  });

  // Calculate VO Statistics
  const totalApprovedAmount = voList
    .filter((v) => v.status === 'APPROVED')
    .reduce((sum, v) => sum + v.amount, 0);

  const totalPendingAmount = voList
    .filter((v) => v.status === 'PENDING')
    .reduce((sum, v) => sum + v.amount, 0);

  const totalTimeExtension = voList
    .filter((v) => v.status === 'APPROVED')
    .reduce((sum, v) => sum + v.timeExtensionDays, 0);

  // Filtered List
  const filteredList = voList.filter((item) => {
    const matchesSearch =
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.approvedBy.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleOpenCreateModal = () => {
    setNewVoForm({
      code: `VO-00${voList.length + 1}`,
      title: '',
      reason: '',
      category: 'งานฐานรากและโครงสร้างใต้ดิน',
      requestDate: new Date().toISOString().split('T')[0],
      approvedBy: 'ผู้ควบคุมงานอาคารฯ',
      amount: 0,
      timeExtensionDays: 0,
      breakdownItems: [
        {
          id: `item-${Date.now()}`,
          description: '',
          qty: 1,
          unit: 'งาน',
          unitPrice: 0,
          total: 0,
        },
      ],
    });
    setIsCreateModalOpen(true);
  };

  const handleAddBreakdownItem = () => {
    setNewVoForm((prev) => ({
      ...prev,
      breakdownItems: [
        ...prev.breakdownItems,
        {
          id: `item-${Date.now()}`,
          description: '',
          qty: 1,
          unit: 'งาน',
          unitPrice: 0,
          total: 0,
        },
      ],
    }));
  };

  const handleUpdateBreakdownItem = (
    index: number,
    field: string,
    value: string | number,
  ) => {
    setNewVoForm((prev) => {
      const updated = [...prev.breakdownItems];
      const target = { ...updated[index], [field]: value };
      if (field === 'qty' || field === 'unitPrice') {
        target.total = Number(target.qty) * Number(target.unitPrice);
      }
      updated[index] = target;

      const sumTotal = updated.reduce((acc, curr) => acc + curr.total, 0);
      return {
        ...prev,
        breakdownItems: updated,
        amount: sumTotal,
      };
    });
  };

  const handleRemoveBreakdownItem = (index: number) => {
    if (newVoForm.breakdownItems.length <= 1) return;
    setNewVoForm((prev) => {
      const updated = prev.breakdownItems.filter((_, i) => i !== index);
      const sumTotal = updated.reduce((acc, curr) => acc + curr.total, 0);
      return {
        ...prev,
        breakdownItems: updated,
        amount: sumTotal,
      };
    });
  };

  const handleSaveNewVo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVoForm.title.trim()) return;

    const newVo: VariationOrderItem = {
      id: `vo-${Date.now()}`,
      code: newVoForm.code,
      title: newVoForm.title.trim(),
      reason: newVoForm.reason.trim(),
      category: newVoForm.category,
      requestDate: newVoForm.requestDate,
      approvedBy: newVoForm.approvedBy,
      amount: Number(newVoForm.amount) || 0,
      timeExtensionDays: Number(newVoForm.timeExtensionDays) || 0,
      status: 'PENDING',
      attachmentsCount: 1,
      breakdownItems: newVoForm.breakdownItems,
    };

    setVoList((prev) => [newVo, ...prev]);
    setIsCreateModalOpen(false);
  };

  const handleViewVoDetail = (vo: VariationOrderItem) => {
    setSelectedVo(vo);
    setIsDetailModalOpen(true);
  };

  const handleToggleStatus = (id: string, newStatus: 'APPROVED' | 'PENDING' | 'REJECTED') => {
    setVoList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item)),
    );
    if (selectedVo && selectedVo.id === id) {
      setSelectedVo((prev) => (prev ? { ...prev, status: newStatus } : null));
    }
  };

  return (
    <div className="space-y-4">
      {/* 4 Summary Cards for VO */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1">
          <div className="text-xs font-medium text-slate-500">มูลค่างานเพิ่มอนุมัติแล้ว</div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-600">
            +฿{totalApprovedAmount.toLocaleString('th-TH')}
          </div>
          <div className="text-[11px] text-slate-400">อนุมัติแล้ว 1 รายการ</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>รอพิจารณาอนุมัติ</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-amber-600">
            +฿{totalPendingAmount.toLocaleString('th-TH')}
          </div>
          <div className="text-[11px] text-slate-400">อยู่ระหว่างตรวจเอกสาร</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>ขยายเวลาทำงาน</span>
            <Calendar className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-blue-600">
            +{totalTimeExtension} วัน
          </div>
          <div className="text-[11px] text-slate-400">ปรับขยายตามสัญญา</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>รายการ VO ทั้งหมด</span>
            <FileText className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
            {voList.length} รายการ
          </div>
          <div className="text-[11px] text-slate-400">อัตราอนุมัติ 50%</div>
        </div>
      </div>

      {/* Main Table Card (Matching reference Screenshot Exactly) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {/* Header Bar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              ทะเบียนงานเพิ่ม/ลด (Variation Orders)
            </h3>
            <p className="text-xs text-slate-500">
              บันทึกข้อตกลงแก้ไขเปลี่ยนแปลงสัญญางานก่อสร้าง
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="px-3.5 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700 transition shadow-2xs flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>+ บันทึกงานเพิ่ม/ลด (VO)</span>
            </button>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="ค้นหารหัส VO, รายละเอียด..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border-none outline-hidden text-xs text-slate-800"
            />
          </div>

          <div className="flex items-center gap-1">
            {(['ALL', 'PENDING', 'APPROVED'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  statusFilter === st
                    ? 'bg-[#2453d4] text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {st === 'ALL' ? 'ทั้งหมด' : st === 'PENDING' ? 'รออนุมัติ' : 'อนุมัติแล้ว'}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table with reference Navy Header */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#102d72] text-white">
              <tr>
                <th className="py-3 px-4 font-semibold w-24">รหัส VO</th>
                <th className="py-3 px-4 font-semibold">รายละเอียดงาน</th>
                <th className="py-3 px-4 font-semibold w-28">วันที่เสนอ</th>
                <th className="py-3 px-4 font-semibold w-48">ผู้อนุมัติ/ตรวจรับ</th>
                <th className="py-3 px-4 font-semibold text-right w-36">มูลค่าเพิ่ม/ลด</th>
                <th className="py-3 px-4 font-semibold text-center w-28">สถานะ</th>
                <th className="py-3 px-3 text-center w-20">เปิดดู</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredList.map((vo) => (
                <tr key={vo.id} className="hover:bg-blue-50/30 transition">
                  <td className="py-3 px-4 font-mono font-bold">
                    <button
                      type="button"
                      onClick={() => handleViewVoDetail(vo)}
                      className="text-blue-600 hover:underline hover:text-blue-800"
                    >
                      {vo.code}
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{vo.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>หมวด: {vo.category}</span>
                      {vo.timeExtensionDays > 0 && (
                        <span>• ขอขยายเวลา +{vo.timeExtensionDays} วัน</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">{vo.requestDate}</td>
                  <td className="py-3 px-4 text-slate-700">{vo.approvedBy}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                    +฿{vo.amount.toLocaleString('th-TH')}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-semibold ${
                        vo.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : vo.status === 'REJECTED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {vo.status === 'APPROVED'
                        ? 'อนุมัติแล้ว'
                        : vo.status === 'REJECTED'
                          ? 'ไม่อนุมัติ'
                          : 'รออนุมัติ'}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleViewVoDetail(vo)}
                      className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition"
                      title="ดูรายละเอียดใบขออนุมัติงานเพิ่ม/ลด"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: สร้างใบขออนุมัติงานเพิ่ม/ลด (Variation Order Form) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
            <div className="px-6 py-4 bg-[#102d72] text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">บันทึกงานเพิ่ม/ลด (Variation Order)</h3>
                <p className="text-xs text-blue-200">
                  แบบฟอร์มขออนุมัติการแก้ไขเปลี่ยนแปลงรายการงานก่อสร้างและงบประมาณ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-blue-200 hover:text-white hover:bg-blue-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNewVo} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">รหัสเอกสาร VO</label>
                  <input
                    type="text"
                    required
                    value={newVoForm.code}
                    onChange={(e) => setNewVoForm({ ...newVoForm, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono font-bold bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">วันที่เสนอ *</label>
                  <input
                    type="date"
                    required
                    value={newVoForm.requestDate}
                    onChange={(e) => setNewVoForm({ ...newVoForm, requestDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">หมวดงานหลัก</label>
                  <select
                    value={newVoForm.category}
                    onChange={(e) => setNewVoForm({ ...newVoForm, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  >
                    <option value="งานฐานรากและโครงสร้างใต้ดิน">งานฐานรากและโครงสร้างใต้ดิน</option>
                    <option value="งานโครงสร้างคอนกรีตเสริมเหล็ก">งานโครงสร้างคอนกรีตเสริมเหล็ก</option>
                    <option value="งานสถาปัตยกรรมและตกแต่ง">งานสถาปัตยกรรมและตกแต่ง</option>
                    <option value="งานระบบไฟฟ้าและสุขาภิบาล">งานระบบไฟฟ้าและสุขาภิบาล</option>
                    <option value="งานปรับปรุงภูมิทัศน์">งานปรับปรุงภูมิทัศน์</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">ชื่อรายการ / วัตถุประสงค์งานที่ขอเปลี่ยนแปลง *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น เสริมเหล็กพิเศษผนังลิฟต์และทางเดินหนีไฟ"
                  value={newVoForm.title}
                  onChange={(e) => setNewVoForm({ ...newVoForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-medium"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">เหตุผลความจำเป็นทางวิศวกรรม / ข้อตกลงแก้ไขสัญญา</label>
                <textarea
                  rows={2}
                  placeholder="ระบุเหตุผล เช่น สภาพชั้นดิน, การปรับแบบตามความต้องการของผู้ว่าจ้าง, การปรับขนาดวัสดุ..."
                  value={newVoForm.reason}
                  onChange={(e) => setNewVoForm({ ...newVoForm, reason: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              {/* Itemized Breakdown Table */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">ตารางประมาณการราคาและรายการงาน</span>
                  <button
                    type="button"
                    onClick={handleAddBreakdownItem}
                    className="text-blue-600 hover:underline font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>เพิ่มรายการย่อย</span>
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3 text-left">รายการ</th>
                        <th className="py-2 px-2 text-right w-16">จำนวน</th>
                        <th className="py-2 px-2 text-left w-16">หน่วย</th>
                        <th className="py-2 px-2 text-right w-24">ราคา/หน่วย</th>
                        <th className="py-2 px-3 text-right w-24">รวมเงิน</th>
                        <th className="py-2 px-2 text-center w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {newVoForm.breakdownItems.map((item, idx) => (
                        <tr key={item.id}>
                          <td className="p-2">
                            <input
                              type="text"
                              required
                              placeholder="รายละเอียดงาน"
                              value={item.description}
                              onChange={(e) =>
                                handleUpdateBreakdownItem(idx, 'description', e.target.value)
                              }
                              className="w-full px-2 py-1 border border-slate-200 rounded"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.qty}
                              onChange={(e) =>
                                handleUpdateBreakdownItem(idx, 'qty', Number(e.target.value))
                              }
                              className="w-full px-1.5 py-1 border border-slate-200 rounded text-right font-mono"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) =>
                                handleUpdateBreakdownItem(idx, 'unit', e.target.value)
                              }
                              className="w-full px-1.5 py-1 border border-slate-200 rounded"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.unitPrice}
                              onChange={(e) =>
                                handleUpdateBreakdownItem(idx, 'unitPrice', Number(e.target.value))
                              }
                              className="w-full px-1.5 py-1 border border-slate-200 rounded text-right font-mono"
                            />
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-slate-800">
                            {item.total.toLocaleString('th-TH')}
                          </td>
                          <td className="p-2 text-center">
                            {newVoForm.breakdownItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveBreakdownItem(idx)}
                                className="text-slate-400 hover:text-rose-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-bold border-t border-slate-200">
                        <td colSpan={4} className="py-2 px-3 text-right">
                          รวมมูลค่างานเพิ่ม/ลดทั้งสิ้น:
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-blue-600 text-sm">
                          +฿{newVoForm.amount.toLocaleString('th-TH')}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Time and Approver fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">ขอขยายเวลาก่อสร้าง (วัน)</label>
                  <input
                    type="number"
                    min="0"
                    value={newVoForm.timeExtensionDays}
                    onChange={(e) =>
                      setNewVoForm({
                        ...newVoForm,
                        timeExtensionDays: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">ผู้มีอำนาจตรวจรับ / อนุมัติ</label>
                  <input
                    type="text"
                    value={newVoForm.approvedBy}
                    onChange={(e) =>
                      setNewVoForm({ ...newVoForm, approvedBy: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#2453d4] text-white font-semibold hover:bg-blue-700 transition"
                >
                  บันทึกขออนุมัติ VO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: เอกสารใบคำขออนุมัติงานเพิ่ม/ลด (Official VO Document Viewer) */}
      {isDetailModalOpen && selectedVo && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
            {/* Top Toolbar */}
            <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-sm">ใบคำขออนุมัติงานเพิ่ม/ลด (CHANGE ORDER)</span>
                <span className="font-mono text-xs text-slate-400">({selectedVo.code})</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-300 hover:text-white flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>พิมพ์</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDetailModalOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Document Content (A4 style) */}
            <div className="p-8 space-y-6 text-xs text-slate-800">
              {/* Header Box */}
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">
                    ใบคำขอแก้ไขเปลี่ยนแปลงสัญญาและงานก่อสร้าง (VO)
                  </h2>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    โครงการ: {projectName} ({projectCode})
                  </p>
                </div>
                <div className="text-right font-mono">
                  <div className="text-sm font-bold text-blue-600">{selectedVo.code}</div>
                  <div className="text-slate-400 text-[11px]">วันที่: {selectedVo.requestDate}</div>
                </div>
              </div>

              {/* Status and Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-400 block">สถานะปัจจุบัน</span>
                  <span
                    className={`font-bold inline-block px-2 py-0.5 rounded text-[10px] mt-0.5 ${
                      selectedVo.status === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : selectedVo.status === 'REJECTED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {selectedVo.status === 'APPROVED'
                      ? 'อนุมัติแล้ว'
                      : selectedVo.status === 'REJECTED'
                        ? 'ไม่อนุมัติ'
                        : 'รออนุมัติ'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">มูลค่างาน</span>
                  <span className="font-mono font-bold text-sm text-slate-900 mt-0.5 block">
                    +฿{selectedVo.amount.toLocaleString('th-TH')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">ขอขยายเวลา</span>
                  <span className="font-mono font-bold text-sm text-blue-600 mt-0.5 block">
                    +{selectedVo.timeExtensionDays} วัน
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">ผู้อนุมัติ/ตรวจรับ</span>
                  <span className="font-medium text-slate-800 text-[11px] mt-0.5 block">
                    {selectedVo.approvedBy}
                  </span>
                </div>
              </div>

              {/* Scope & Reason */}
              <div className="space-y-3">
                <div>
                  <h4 className="font-bold text-slate-900 mb-1">รายละเอียดงานที่ขอเปลี่ยนแปลง:</h4>
                  <p className="p-3 bg-slate-50 rounded border border-slate-200 text-slate-700">
                    {selectedVo.title}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-900 mb-1">เหตุผลความจำเป็นและข้อเท็จจริงทางเทคนิค:</h4>
                  <p className="p-3 bg-slate-50 rounded border border-slate-200 text-slate-700 leading-relaxed">
                    {selectedVo.reason || 'ปรับปรุงแก้ไขตามมติที่ประชุมตรวจการจ้าง'}
                  </p>
                </div>
              </div>

              {/* Itemized breakdown table */}
              {selectedVo.breakdownItems && selectedVo.breakdownItems.length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">ตารางแจกแจงรายการและราคา:</h4>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-[#102d72] text-white">
                        <tr>
                          <th className="py-2 px-3 text-left">รายการ</th>
                          <th className="py-2 px-3 text-right">จำนวน</th>
                          <th className="py-2 px-3 text-left">หน่วย</th>
                          <th className="py-2 px-3 text-right">ราคา/หน่วย</th>
                          <th className="py-2 px-3 text-right">รวมเงิน (บาท)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {selectedVo.breakdownItems.map((item) => (
                          <tr key={item.id}>
                            <td className="py-2 px-3 font-sans text-slate-800">{item.description}</td>
                            <td className="py-2 px-3 text-right">{item.qty}</td>
                            <td className="py-2 px-3 text-left font-sans">{item.unit}</td>
                            <td className="py-2 px-3 text-right">{item.unitPrice.toLocaleString('th-TH')}</td>
                            <td className="py-2 px-3 text-right font-bold text-slate-900">
                              {item.total.toLocaleString('th-TH')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 font-bold border-t border-slate-200">
                          <td colSpan={4} className="py-2 px-3 text-right font-sans">
                            รวมมูลค่าทั้งสิ้น:
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-sm text-blue-600">
                            +฿{selectedVo.amount.toLocaleString('th-TH')}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* Signatures box */}
              <div className="pt-6 border-t border-slate-200 grid grid-cols-2 gap-8 text-center text-xs">
                <div className="space-y-12">
                  <span className="text-slate-500">ลงชื่อ ผู้เสนอขอเปลี่ยนแปลง (ผู้รับจ้าง)</span>
                  <div className="border-b border-slate-300 w-48 mx-auto" />
                  <span className="text-slate-400 text-[11px] block">( นายสมชาย ตัวอย่าง )</span>
                </div>
                <div className="space-y-12">
                  <span className="text-slate-500">ลงชื่อ ผู้มีอำนาจอนุมัติ (ผู้ว่าจ้าง/ผู้ควบคุมงาน)</span>
                  <div className="border-b border-slate-300 w-48 mx-auto" />
                  <span className="text-slate-400 text-[11px] block">
                    ( {selectedVo.approvedBy} )
                  </span>
                </div>
              </div>

              {/* Quick Status Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(selectedVo.id, 'APPROVED')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>อนุมัติงาน VO นี้</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(selectedVo.id, 'REJECTED')}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 transition flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>ไม่อนุมัติ</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsDetailModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg border border-slate-200 font-medium text-slate-600 hover:bg-slate-50"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
