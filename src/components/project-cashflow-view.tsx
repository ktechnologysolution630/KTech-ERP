'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  CreditCard,
  Plus,
  ArrowUpRight,
  Receipt,
  Wallet,
  X,
  Scan,
  Scissors,
  Image as ImageIcon,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';

export interface CashflowTransaction {
  id: string;
  date: string;
  thaiDate: string;
  docNo: string;
  type: 'INCOME' | 'EXPENSE';
  partyName: string;
  amount: number;
  status: 'COMPLETED' | 'PENDING';
  category: string;
  note?: string;
}

interface DocItem {
  id: string;
  name: string;
  detail?: string;
  qty: number;
  unit: string;
  price: number;
}

interface ProjectCashflowViewProps {
  projectId: string;
  projectCode: string;
  projectName: string;
}

// Helper: Convert Number to Thai Baht text
function thaiBahtText(num: number): string {
  if (!num || num === 0) return 'ศูนย์บาทถ้วน';

  const digits = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  const convertGroup = (nStr: string): string => {
    let result = '';
    const len = nStr.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(nStr[i], 10);
      const pos = len - i - 1;
      if (digit !== 0) {
        if (pos === 1 && digit === 1) {
          result += 'สิบ';
        } else if (pos === 1 && digit === 2) {
          result += 'ยี่สิบ';
        } else if (pos === 0 && digit === 1 && len > 1 && nStr[len - 2] !== '0') {
          result += 'เอ็ด';
        } else {
          result += digits[digit] + positions[pos];
        }
      }
    }
    return result;
  };

  const parts = num.toFixed(2).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  let bahtStr = '';
  if (integerPart.length > 6) {
    const millions = integerPart.slice(0, integerPart.length - 6);
    const rest = integerPart.slice(integerPart.length - 6);
    bahtStr = convertGroup(millions) + 'ล้าน' + convertGroup(rest);
  } else {
    bahtStr = convertGroup(integerPart);
  }

  if (!bahtStr) bahtStr = 'ศูนย์';
  bahtStr += 'บาท';

  if (decimalPart === '00') {
    bahtStr += 'ถ้วน';
  } else {
    bahtStr += convertGroup(decimalPart) + 'สตางค์';
  }

  return bahtStr;
}

export function ProjectCashflowView({
  projectId,
  projectCode,
  projectName,
}: ProjectCashflowViewProps) {
  // Modal visibility
  const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);

  // Initial transactions matching screenshot
  const [transactions, setTransactions] = useState<CashflowTransaction[]>([
    {
      id: 'tx-1',
      date: '2026-11-03',
      thaiDate: '3 พ.ย. 2569',
      docNo: '001',
      type: 'INCOME',
      partyName: 'บริษัท ลูกค้าตัวอย่าง จำกัด',
      amount: 1070000,
      status: 'COMPLETED',
      category: 'เงินรับล่วงหน้าตามสัญญา (Advance Payment)',
      note: 'เงินรับล่วงหน้า 15% ตามสัญญาจ้างก่อสร้าง',
    },
  ]);

  // Form states for Income (RECEIPT - Image 3)
  const [receiptForm, setReceiptForm] = useState({
    docNo: 'REC-2611-0001',
    date: '03/11/2569',
    rawDate: '2026-11-03',
    refDoc: '',
    customer: 'บริษัท ลูกค้าตัวอย่าง จำกัด',
    address: 'กรุงเทพมหานคร',
    taxId: '-',
    branch: '-',
    contact: '-',
    phone: '-',
    email: '-',
    milestone: 'ค่างวดงานที่ 1',
    accountCategory: 'รายได้จากการรับเหมาก่อสร้าง',
    items: [
      {
        id: 'r-item-1',
        name: 'เงินรับค่างวดงานก่อสร้างงวดที่ 1',
        detail: 'งานเสาเข็มเจาะและฐานรากอาคารสำนักงานตัวอย่าง',
        qty: 1,
        unit: 'งวด',
        price: 1000000,
      },
    ] as DocItem[],
    notes: 'ชำระเงินตามสัญญาจ้างเลขที่ PJ-0001',
    payMethod: 'โอนเงิน',
    bank: 'ธนาคารกสิกรไทย',
    bankBranch: 'สาขาตัวอย่าง',
    accountName: 'บจก. เคเทค คอนสตรัคชั่น',
    accountNo: '123-2-45678-9',
    vatType: '7',
    whtPercent: 0,
    discount: 0,
    adjustItems: false,
  });

  // Form states for Expense (PAYMENT VOUCHER - Image 2)
  const [voucherForm, setVoucherForm] = useState({
    docNo: 'EXP-2611-0001',
    date: '03/11/2569',
    rawDate: '2026-11-03',
    vendor: 'บริษัท ลูกค้าตัวอย่าง จำกัด',
    address: 'กรุงเทพมหานคร',
    taxId: '-',
    branch: '-',
    contact: '-',
    phone: '-',
    email: '-',
    deliveryLocation: 'สถานที่จัดส่ง ไซต์งานโครงการตัวอย่าง',
    accountCategory: 'ค่าวัสดุก่อสร้างและค่าแรง',
    items: [
      {
        id: 'v-item-1',
        name: 'ค่าคอนกรีตผสมเสร็จและงานเจาะเสาเข็ม',
        detail: '',
        qty: 1,
        unit: 'ชุด',
        price: 0,
      },
    ] as DocItem[],
    notes: '',
    payMethod: 'โอนเงิน',
    bank: 'ธนาคารกสิกรไทย',
    bankBranch: 'สาขาตัวอย่าง',
    accountName: 'บจก. เคเทค คอนสตรัคชั่น',
    accountNo: '123-2-45678-9',
    vatType: '7',
    whtPercent: 0,
    discount: 0,
    retentionPercent: 0,
  });

  // KPI Calculations
  const totalIncome = transactions
    .filter((t) => t.type === 'INCOME' && t.status === 'COMPLETED')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = transactions
    .filter((t) => t.type === 'EXPENSE' && t.status === 'COMPLETED')
    .reduce((sum, t) => sum + t.amount, 0);

  const netBalance = totalIncome - totalExpense;
  const profitMarginPercent =
    totalIncome > 0 ? ((netBalance / totalIncome) * 100).toFixed(1) : '0.0';

  const formatBaht = (val: number) => {
    return val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Receipt items calculation
  const receiptSubtotal = receiptForm.items.reduce(
    (sum, item) => sum + item.qty * item.price,
    0,
  );
  const receiptAfterDiscount = Math.max(0, receiptSubtotal - receiptForm.discount);
  const receiptVat = receiptForm.vatType === '7' ? receiptAfterDiscount * 0.07 : 0;
  const receiptGrandTotal = receiptAfterDiscount + receiptVat;

  // Voucher items calculation
  const voucherSubtotal = voucherForm.items.reduce(
    (sum, item) => sum + item.qty * item.price,
    0,
  );
  const voucherAfterDiscount = Math.max(0, voucherSubtotal - voucherForm.discount);
  const voucherVat = voucherForm.vatType === '7' ? voucherAfterDiscount * 0.07 : 0;
  const voucherRetention = (voucherAfterDiscount * voucherForm.retentionPercent) / 100;
  const voucherGrandTotal = voucherAfterDiscount + voucherVat - voucherRetention;

  // Submit Receipt (Create Income)
  const handleSaveReceipt = () => {
    const newTx: CashflowTransaction = {
      id: `tx-${Date.now()}`,
      date: receiptForm.rawDate,
      thaiDate: receiptForm.date,
      docNo: receiptForm.docNo,
      type: 'INCOME',
      partyName: receiptForm.customer,
      amount: receiptGrandTotal > 0 ? receiptGrandTotal : 1070000,
      status: 'COMPLETED',
      category: receiptForm.accountCategory,
      note: receiptForm.notes,
    };
    setTransactions((prev) => [newTx, ...prev]);
    setIsIncomeModalOpen(false);
  };

  // Submit Voucher (Create Expense)
  const handleSaveVoucher = () => {
    const newTx: CashflowTransaction = {
      id: `tx-${Date.now()}`,
      date: voucherForm.rawDate,
      thaiDate: voucherForm.date,
      docNo: voucherForm.docNo,
      type: 'EXPENSE',
      partyName: voucherForm.vendor,
      amount: voucherGrandTotal > 0 ? voucherGrandTotal : 50000,
      status: 'COMPLETED',
      category: voucherForm.accountCategory,
      note: voucherForm.notes,
    };
    setTransactions((prev) => [newTx, ...prev]);
    setIsExpenseModalOpen(false);
  };

  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  return (
    <div className="space-y-4 font-sans text-xs antialiased text-slate-800">
      {/* 1. Header Bar matching screenshot */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">รายรับรายจ่ายโครงการ</h2>
          <p className="text-xs text-slate-400 mt-0.5">สรุปและบันทึกบัญชีการเงินโครงการนี้</p>
        </div>
        <div className="flex items-center gap-2">
          {/* + เพิ่มรายรับ (White with border) */}
          <button
            type="button"
            onClick={() => setIsIncomeModalOpen(true)}
            className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5 text-slate-600 stroke-[2.5]" />
            <span>เพิ่มรายรับ</span>
          </button>

          {/* + เพิ่มรายจ่าย (Blue filled #2453d4) */}
          <button
            type="button"
            onClick={() => setIsExpenseModalOpen(true)}
            className="px-3.5 py-1.5 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 text-white stroke-[2.5]" />
            <span>เพิ่มรายจ่าย</span>
          </button>
        </div>
      </div>

      {/* 2. 4 KPI Financial Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: ได้เงินจริง */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">ได้เงินจริง</span>
            <div className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
              <Receipt className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
              {formatBaht(totalIncome)}
            </div>
          </div>
        </div>

        {/* Card 2: รายได้รวมเดือนนี้ */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">รายได้รวมเดือนนี้</span>
            <div className="w-6 h-6 rounded-full bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center">
              <FileText className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">0.00</div>
          </div>
        </div>

        {/* Card 3: จ่ายจริง */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">จ่ายจริง</span>
            <div className="w-6 h-6 rounded-full bg-red-50 border border-red-200 text-red-600 flex items-center justify-center">
              <CreditCard className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
              {formatBaht(totalExpense)}
            </div>
          </div>
        </div>

        {/* Card 4: คงเหลือสุทธิ */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">คงเหลือสุทธิ</span>
            <div className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
              <Wallet className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
              {formatBaht(netBalance)}
            </div>
          </div>
        </div>
      </div>

      {/* 3. 4 Visual Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Chart 1: รายรับ/รายจ่าย (12 เดือน) */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">รายรับ/รายจ่าย (12 เดือน)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                เปรียบเทียบกระแสเงินสดรายเดือนของโครงการนี้
              </p>
            </div>
            <div className="text-xs font-mono font-semibold text-slate-700">
              รายรับ: <span className="text-blue-600 font-bold">{formatBaht(totalIncome)}</span>
            </div>
          </div>

          <div className="mt-6 h-52 flex flex-col justify-end">
            <div className="relative h-44 w-full flex items-end">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none text-[10px] text-slate-400 font-mono">
                <div className="border-b border-slate-100 flex items-center justify-between pr-2">
                  <span>1.2M</span>
                </div>
                <div className="border-b border-slate-100 flex items-center justify-between pr-2">
                  <span>800k</span>
                </div>
                <div className="border-b border-slate-100 flex items-center justify-between pr-2">
                  <span>400k</span>
                </div>
                <div className="border-b border-slate-200 flex items-center justify-between pr-2">
                  <span>0</span>
                </div>
              </div>

              <div className="w-full h-full flex items-end justify-between pl-8 pr-2 relative z-10">
                {months.map((m, idx) => {
                  const isNov = m === 'พ.ย.';
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full group">
                      {isNov ? (
                        <div
                          className="w-7 sm:w-9 bg-[#2453d4] rounded-t-sm transition-all duration-500 shadow-sm relative group-hover:bg-blue-700"
                          style={{ height: '88%' }}
                        >
                          <div className="opacity-0 group-hover:opacity-100 transition absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20 pointer-events-none font-mono">
                            ฿1,070,000.00
                          </div>
                        </div>
                      ) : (
                        <div className="w-7 sm:w-9 h-0.5 bg-slate-200 rounded-t-sm" />
                      )}
                      <span className="text-[10px] text-slate-400 mt-2 font-medium">{m}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-center gap-6 mt-4 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#2453d4]" />
                <span>รายรับ</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-500" />
                <span>รายจ่าย</span>
              </span>
            </div>
          </div>
        </div>

        {/* Chart 2: กำไรสุทธิ (YTD) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">กำไรสุทธิ (YTD)</div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900 mt-0.5">
              {formatBaht(netBalance)}
            </div>
            <div className="text-xs text-emerald-600 font-semibold mt-0.5 flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>อัตรากำไร {profitMarginPercent}%</span>
            </div>
          </div>

          <div className="mt-4 h-44 relative flex items-end">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 100 50" preserveAspectRatio="none">
              <defs>
                <linearGradient id="greenAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d="M 0 50 L 0 49 L 20 49 L 40 49 L 60 49 L 80 49 Q 90 47, 100 5 L 100 50 Z"
                fill="url(#greenAreaGrad)"
              />
              <path
                d="M 0 49 L 20 49 L 40 49 L 60 49 L 80 49 Q 90 47, 100 5"
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
              />
              <circle cx="100" cy="5" r="2.5" fill="#10b981" />
            </svg>
            <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-100">
              <span>ม.ค.</span>
              <span>มี.ค.</span>
              <span>พ.ค.</span>
              <span>ก.ค.</span>
              <span>ก.ย.</span>
              <span>พ.ย.</span>
            </div>
          </div>
        </div>

        {/* Chart 3: กระแสเงินสดสะสม */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">กระแสเงินสดสะสม</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              เงินสดคงเหลือสะสมตลอดระยะเวลา 12 เดือนล่าสุดของโครงการ
            </p>
          </div>

          <div className="mt-4 h-44 relative flex items-end">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 100 50" preserveAspectRatio="none">
              <defs>
                <linearGradient id="blueAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d="M 0 50 L 0 49 L 20 49 L 40 49 L 60 49 L 80 49 Q 90 46, 100 8 L 100 50 Z"
                fill="url(#blueAreaGrad)"
              />
              <path
                d="M 0 49 L 20 49 L 40 49 L 60 49 L 80 49 Q 90 46, 100 8"
                fill="none"
                stroke="#2563eb"
                strokeWidth="2"
              />
              <circle cx="100" cy="8" r="2.5" fill="#2563eb" />
            </svg>
            <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-100">
              <span>ม.ค.</span>
              <span>มี.ค.</span>
              <span>พ.ค.</span>
              <span>ก.ค.</span>
              <span>ก.ย.</span>
              <span>พ.ย.</span>
            </div>
          </div>
        </div>

        {/* Chart 4: Donut Chart */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">สัดส่วนการเบิกจ่ายตามประเภท</h3>
            <p className="text-xs text-slate-400 mt-0.5">ร้อยละของค่าใช้จ่ายแยกตามหมวดหมู่</p>
          </div>

          <div className="py-4 flex items-center justify-center">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#f1f5f9" strokeWidth="5" />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="5"
                  strokeDasharray="88 88"
                  strokeDashoffset="0"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-mono font-bold text-xs text-white">
                <span className="bg-emerald-600 px-2 py-0.5 rounded-full text-[10px]">
                  100.0%
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>รายรับ</span>
            </span>
            <span className="font-mono font-medium text-slate-800">
              1,070,000.00 - 100.0%
            </span>
          </div>
        </div>
      </div>

      {/* 4. Bottom Table: รายการล่าสุด */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">รายการล่าสุด</h3>
            <p className="text-xs text-slate-400 mt-0.5">{transactions.length} รายการ</p>
          </div>
          <Link
            href="/invoices"
            prefetch={false}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium text-xs transition"
          >
            เปิดบัญชี / การเงิน
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#102d72] text-white">
              <tr>
                <th className="py-3 px-4 font-medium">วันที่</th>
                <th className="py-3 px-4 font-medium">เลขที่</th>
                <th className="py-3 px-4 font-medium">ประเภท</th>
                <th className="py-3 px-4 font-medium">ผู้รับ/ผู้จ่าย</th>
                <th className="py-3 px-4 font-medium text-right">ยอดเงิน</th>
                <th className="py-3 px-4 font-medium text-center">สถานะ</th>
                <th className="py-3 px-4 font-medium text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50 transition">
                  <td className="py-3 px-4 text-slate-600">{tx.thaiDate}</td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-800">{tx.docNo}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        tx.type === 'INCOME'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {tx.type === 'INCOME' ? 'รายรับ' : 'รายจ่าย'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-800 font-medium">{tx.partyName}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                    {formatBaht(tx.amount)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {tx.status === 'COMPLETED' ? 'สมบูรณ์แล้ว' : 'รอดำเนินการ'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      type="button"
                      onClick={() =>
                        alert(`รายละเอียดเอกสาร ${tx.docNo}\n${tx.category}\n${tx.note || ''}`)
                      }
                      className="text-[#2453d4] hover:underline font-medium"
                    >
                      เปิด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* =========================================================================
          MODAL 1: สร้างใบสำคัญรับเงิน (RECEIPT - Image 3 Exact Match)
         ========================================================================= */}
      {isIncomeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-[#f8fafc] rounded-2xl shadow-2xl border border-slate-300 max-w-4xl w-full my-auto flex flex-col max-h-[96vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Top Modal Header */}
            <div className="bg-white px-6 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-900 tracking-tight">สร้างใบสำคัญรับเงิน</h2>
                <p className="text-xs text-slate-400">บันทึกรายรับของโครงการนี้</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsIncomeModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleSaveReceipt}
                  className="px-4 py-1.5 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition"
                >
                  สร้างเอกสาร
                </button>
                <button
                  type="button"
                  onClick={() => setIsIncomeModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-toolbar */}
            <div className="px-6 py-2 bg-slate-100/80 border-b border-slate-200 flex justify-end">
              <button
                type="button"
                className="px-3 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1.5 shadow-2xs"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>ภาษีถูกหัก ณ ที่จ่าย</span>
              </button>
            </div>

            {/* Scrollable Paper Container (Matching Image 3) */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <div className="bg-white border border-slate-300 shadow-md rounded-xs p-6 sm:p-8 space-y-6">
                {/* Header Row: Company Logo Left / Document Title Right */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  {/* Company Logo Left */}
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-[#2453d4] text-white font-bold flex items-center justify-center text-lg shrink-0 shadow-sm">
                      LI
                    </div>
                    <div className="text-xs space-y-0.5 leading-tight">
                      <div className="font-bold text-slate-900 text-sm">Light</div>
                      <div className="text-slate-500">ที่อยู่ : -</div>
                      <div className="text-slate-500">
                        โทรศัพท์ : - · Email :{' '}
                        <span className="text-slate-700">accounting@ktec.local</span>
                      </div>
                      <div className="text-slate-500">เลขประจำตัวผู้เสียภาษีอากร : -</div>
                    </div>
                  </div>

                  {/* Document Title Right */}
                  <div className="text-right space-y-1">
                    <div className="flex items-center justify-end gap-2">
                      <span className="w-7 h-7 rounded-full border border-slate-300 text-[10px] font-bold text-slate-500 flex items-center justify-center">
                        VAT
                      </span>
                      <div>
                        <div className="text-lg font-bold text-slate-900 tracking-tight">ใบเสร็จรับเงิน</div>
                        <div className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">
                          RECEIPT
                        </div>
                      </div>
                    </div>
                    <div className="text-xs space-y-0.5 font-mono pt-1">
                      <div>
                        <span className="text-slate-400 font-sans">เลขที่: </span>
                        <input
                          type="text"
                          value={receiptForm.docNo}
                          onChange={(e) => setReceiptForm({ ...receiptForm, docNo: e.target.value })}
                          className="w-32 text-right border-b border-slate-300 font-bold focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <span className="text-slate-400 font-sans">วันที่: </span>
                        <input
                          type="text"
                          value={receiptForm.date}
                          onChange={(e) => setReceiptForm({ ...receiptForm, date: e.target.value })}
                          className="w-32 text-right border-b border-slate-300 focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <span className="text-slate-400 font-sans">อ้างอิง: </span>
                        <input
                          type="text"
                          placeholder="อ้างอิงเอกสาร"
                          value={receiptForm.refDoc}
                          onChange={(e) => setReceiptForm({ ...receiptForm, refDoc: e.target.value })}
                          className="w-32 text-right border-b border-slate-300 focus:outline-hidden font-sans text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Metadata Two-Column Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-200 text-xs">
                  {/* Left Column: Customer */}
                  <div className="space-y-1.5">
                    <div>
                      <span className="text-slate-500 block text-[11px]">ลูกค้า</span>
                      <select
                        value={receiptForm.customer}
                        onChange={(e) => setReceiptForm({ ...receiptForm, customer: e.target.value })}
                        className="w-full px-2 py-1 border border-slate-300 rounded font-semibold text-slate-800"
                      >
                        <option value="บริษัท ลูกค้าตัวอย่าง จำกัด">
                          บริษัท ลูกค้าตัวอย่าง จำกัด
                        </option>
                        <option value="สำนักงานศาลยุติธรรม">สำนักงานศาลยุติธรรม</option>
                      </select>
                    </div>
                    <div className="text-slate-500">ที่อยู่: {receiptForm.address}</div>
                    <div className="text-slate-500 flex gap-4">
                      <span>เลขประจำตัวผู้เสียภาษี: -</span>
                      <span>สาขา: -</span>
                    </div>
                    <div className="text-slate-500">ผู้ติดต่อ: -</div>
                    <div className="text-slate-500 flex gap-4">
                      <span>โทรศัพท์: -</span>
                      <span>อีเมล: -</span>
                    </div>
                  </div>

                  {/* Right Column: Project Details */}
                  <div className="space-y-1.5">
                    <div>
                      <span className="text-slate-500 block text-[11px]">โครงการ</span>
                      <div className="font-semibold text-slate-900 py-1">{projectName}</div>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">งวดงาน</span>
                      <input
                        type="text"
                        value={receiptForm.milestone}
                        onChange={(e) => setReceiptForm({ ...receiptForm, milestone: e.target.value })}
                        className="w-full px-2 py-1 border border-slate-300 rounded"
                        placeholder="งวดงาน"
                      />
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">หมวดบัญชี</span>
                      <select
                        value={receiptForm.accountCategory}
                        onChange={(e) => setReceiptForm({ ...receiptForm, accountCategory: e.target.value })}
                        className="w-full px-2 py-1 border border-slate-300 rounded"
                      >
                        <option value="รายได้จากการรับเหมาก่อสร้าง">รายได้จากการรับเหมาก่อสร้าง</option>
                        <option value="เงินรับล่วงหน้าตามสัญญา">เงินรับล่วงหน้าตามสัญญา</option>
                        <option value="รายได้เบ็ดเตล็ด">รายได้เบ็ดเตล็ด</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="border border-slate-300 rounded overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-300 text-slate-700">
                      <tr>
                        <th className="py-2 px-3 w-12 text-center">ลำดับ</th>
                        <th className="py-2 px-4">รายการ</th>
                        <th className="py-2 px-3 w-20 text-center">จำนวน</th>
                        <th className="py-2 px-3 w-16 text-center">หน่วย</th>
                        <th className="py-2 px-3 w-28 text-right">ราคาต่อหน่วย</th>
                        <th className="py-2 px-3 w-28 text-right">จำนวนเงิน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {receiptForm.items.map((item, idx) => (
                        <tr key={item.id}>
                          <td className="py-2 px-3 text-center font-mono">{idx + 1}</td>
                          <td className="py-2 px-4">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => {
                                const newItems = [...receiptForm.items];
                                newItems[idx].name = e.target.value;
                                setReceiptForm({ ...receiptForm, items: newItems });
                              }}
                              className="w-full font-medium text-slate-800 border-b border-transparent focus:border-blue-400 focus:outline-hidden"
                            />
                            <input
                              type="text"
                              value={item.detail || ''}
                              onChange={(e) => {
                                const newItems = [...receiptForm.items];
                                newItems[idx].detail = e.target.value;
                                setReceiptForm({ ...receiptForm, items: newItems });
                              }}
                              placeholder="รายละเอียดรายการ"
                              className="w-full text-[11px] text-slate-400 border-b border-transparent focus:border-blue-400 focus:outline-hidden mt-0.5"
                            />
                          </td>
                          <td className="py-2 px-3 text-center font-mono">
                            <input
                              type="number"
                              value={item.qty}
                              onChange={(e) => {
                                const newItems = [...receiptForm.items];
                                newItems[idx].qty = Number(e.target.value);
                                setReceiptForm({ ...receiptForm, items: newItems });
                              }}
                              className="w-16 text-center border border-slate-200 rounded py-0.5"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => {
                                const newItems = [...receiptForm.items];
                                newItems[idx].unit = e.target.value;
                                setReceiptForm({ ...receiptForm, items: newItems });
                              }}
                              className="w-12 text-center border border-slate-200 rounded py-0.5"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            <input
                              type="number"
                              value={item.price}
                              onChange={(e) => {
                                const newItems = [...receiptForm.items];
                                newItems[idx].price = Number(e.target.value);
                                setReceiptForm({ ...receiptForm, items: newItems });
                              }}
                              className="w-24 text-right border border-slate-200 rounded py-0.5 font-mono"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            {formatBaht(item.qty * item.price)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-2 bg-slate-50 border-t border-slate-200 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const nextId = `r-item-${receiptForm.items.length + 1}`;
                        setReceiptForm({
                          ...receiptForm,
                          items: [
                            ...receiptForm.items,
                            { id: nextId, name: '', detail: '', qty: 1, unit: 'งวด', price: 0 },
                          ],
                        });
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ เพิ่มรายการที่ {receiptForm.items.length + 1}</span>
                    </button>
                  </div>
                </div>

                {/* Footer Section: Left Thai Baht & Notes / Right Calculations */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 pt-2">
                  {/* Left (7 Cols) */}
                  <div className="sm:col-span-7 space-y-4">
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-1">จำนวนเงินตัวอักษร</span>
                      <div className="p-2 border border-slate-300 rounded bg-slate-50/60 font-medium text-slate-800">
                        {thaiBahtText(receiptGrandTotal)}
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] text-slate-500 block mb-1">หมายเหตุ</span>
                      <textarea
                        rows={3}
                        value={receiptForm.notes}
                        onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })}
                        className="w-full p-2 border border-slate-300 rounded text-xs focus:outline-hidden"
                      />
                    </div>

                    {/* Bank Details */}
                    <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600 pt-2 border-t border-slate-200">
                      <div>
                        <span className="text-slate-400 block">วิธีชำระเงิน</span>
                        <span className="font-semibold">{receiptForm.payMethod}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">ธนาคาร</span>
                        <span className="font-semibold">{receiptForm.bank}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">สาขา</span>
                        <span>{receiptForm.bankBranch}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">ชื่อบัญชี</span>
                        <span>{receiptForm.accountName}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 block">เลขบัญชี</span>
                        <span className="font-mono font-bold">{receiptForm.accountNo}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right (5 Cols) Calculations */}
                  <div className="sm:col-span-5 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">ประเภท VAT</span>
                      <select
                        value={receiptForm.vatType}
                        onChange={(e) => setReceiptForm({ ...receiptForm, vatType: e.target.value })}
                        className="px-2 py-0.5 border border-slate-300 rounded font-medium"
                      >
                        <option value="7">VAT 7% (แยก VAT)</option>
                        <option value="0">ไม่มี VAT (0%)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">หัก ณ ที่จ่าย (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={receiptForm.whtPercent}
                        onChange={(e) =>
                          setReceiptForm({ ...receiptForm, whtPercent: Number(e.target.value) })
                        }
                        className="w-16 text-right border border-slate-300 rounded py-0.5 px-1 font-mono"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">ส่วนลด</span>
                      <span className="font-mono text-slate-800">
                        {receiptForm.discount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                      <span className="text-slate-600">รวมก่อน VAT</span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatBaht(receiptAfterDiscount)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">ภาษีมูลค่าเพิ่ม 7%</span>
                      <span className="font-mono text-slate-800">{formatBaht(receiptVat)}</span>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t-2 border-slate-700">
                      <span className="font-bold text-slate-900 text-sm">ยอดรวมทั้งสิ้น</span>
                      <span className="font-mono font-bold text-base text-[#2453d4]">
                        ฿{formatBaht(receiptGrandTotal)}
                      </span>
                    </div>

                    <label className="flex items-center gap-2 pt-2 text-[11px] text-slate-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={receiptForm.adjustItems}
                        onChange={(e) =>
                          setReceiptForm({ ...receiptForm, adjustItems: e.target.checked })
                        }
                        className="rounded text-blue-600"
                      />
                      <span>เพิ่มรายการปรับลด/ปรับเพิ่ม</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: สร้างใบสำคัญจ่าย (PAYMENT VOUCHER - Image 2 Exact Match)
         ========================================================================= */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-[#f8fafc] rounded-2xl shadow-2xl border border-slate-300 max-w-4xl w-full my-auto flex flex-col max-h-[96vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Top Modal Header */}
            <div className="bg-white px-6 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-900 tracking-tight">สร้างใบสำคัญจ่าย</h2>
                <p className="text-xs text-slate-400">บันทึกเอกสารรายจ่ายของโครงการนี้</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleSaveVoucher}
                  className="px-4 py-1.5 rounded-lg bg-[#2453d4] hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition"
                >
                  สร้างเอกสาร
                </button>
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-toolbar with AI Bill Scanner, ตัดงบ BOQ, แนบรูป */}
            <div className="px-6 py-2 bg-slate-100/80 border-b border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => alert('เปิดระบบ AI OCR สแกนบิลและดึงรายการลงตารางอัตโนมัติ')}
                className="px-3 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1.5 shadow-2xs"
              >
                <Scan className="w-3.5 h-3.5 text-blue-600" />
                <span>สแกนบิลด้วย AI</span>
              </button>

              <button
                type="button"
                onClick={() => alert('เชื่อมโยงตัดงบประมาณจากตาราง BOQ')}
                className="px-3 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1.5 shadow-2xs"
              >
                <Scissors className="w-3.5 h-3.5 text-emerald-600" />
                <span>ตัดงบ BOQ</span>
              </button>

              <button
                type="button"
                onClick={() => alert('เปิดหน้าต่างแนบภาพสลิปหรือใบเสร็จ')}
                className="px-3 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-[11px] font-medium flex items-center gap-1.5 shadow-2xs"
              >
                <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                <span>แนบรูป</span>
              </button>
            </div>

            {/* Scrollable Paper Container (Matching Image 2) */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <div className="bg-white border border-slate-300 shadow-md rounded-xs p-6 sm:p-8 space-y-6">
                {/* Header Row: Company Logo Left / Document Title Right */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  {/* Company Logo Left */}
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-[#2453d4] text-white font-bold flex items-center justify-center text-lg shrink-0 shadow-sm">
                      LI
                    </div>
                    <div className="text-xs space-y-0.5 leading-tight">
                      <div className="font-bold text-slate-900 text-sm">Light</div>
                      <div className="text-slate-500">ที่อยู่ : -</div>
                      <div className="text-slate-500">
                        โทรศัพท์ : - · Email :{' '}
                        <span className="text-slate-700">accounting@ktec.local</span>
                      </div>
                      <div className="text-slate-500">เลขประจำตัวผู้เสียภาษีอากร : -</div>
                    </div>
                  </div>

                  {/* Document Title Right */}
                  <div className="text-right space-y-1">
                    <div className="flex items-center justify-end gap-2">
                      <span className="w-7 h-7 rounded-full border border-slate-300 text-[10px] font-bold text-slate-500 flex items-center justify-center">
                        VAT
                      </span>
                      <div>
                        <div className="text-lg font-bold text-slate-900 tracking-tight">ใบสำคัญจ่าย</div>
                        <div className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">
                          PAYMENT VOUCHER
                        </div>
                      </div>
                    </div>
                    <div className="text-xs space-y-0.5 font-mono pt-1">
                      <div>
                        <span className="text-slate-400 font-sans">เลขที่: </span>
                        <input
                          type="text"
                          value={voucherForm.docNo}
                          onChange={(e) => setVoucherForm({ ...voucherForm, docNo: e.target.value })}
                          className="w-32 text-right border-b border-slate-300 font-bold focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <span className="text-slate-400 font-sans">วันที่: </span>
                        <input
                          type="text"
                          value={voucherForm.date}
                          onChange={(e) => setVoucherForm({ ...voucherForm, date: e.target.value })}
                          className="w-32 text-right border-b border-slate-300 focus:outline-hidden"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Metadata Two-Column Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-200 text-xs">
                  {/* Left Column: ผู้ขาย / ผู้รับเงิน */}
                  <div className="space-y-1.5">
                    <div>
                      <span className="text-slate-500 block text-[11px]">ผู้ขาย / ผู้รับเงิน</span>
                      <select
                        value={voucherForm.vendor}
                        onChange={(e) => setVoucherForm({ ...voucherForm, vendor: e.target.value })}
                        className="w-full px-2 py-1 border border-slate-300 rounded font-semibold text-slate-800"
                      >
                        <option value="บริษัท ลูกค้าตัวอย่าง จำกัด">
                          บริษัท ลูกค้าตัวอย่าง จำกัด
                        </option>
                        <option value="บจก. ผลิตภัณฑ์และวัตถุก่อสร้าง (CPAC)">
                          บจก. ผลิตภัณฑ์และวัตถุก่อสร้าง (CPAC)
                        </option>
                        <option value="หจก. วัสดุก่อสร้างตัวอย่าง">หจก. วัสดุก่อสร้างตัวอย่าง</option>
                        <option value="ผู้รับเหมาช่วง งานเสาเข็มเจาะ">ผู้รับเหมาช่วง งานเสาเข็มเจาะ</option>
                      </select>
                    </div>
                    <div className="text-slate-500">ที่อยู่: {voucherForm.address}</div>
                    <div className="text-slate-500 flex gap-4">
                      <span>เลขประจำตัวผู้เสียภาษี: -</span>
                      <span>สาขา: -</span>
                    </div>
                    <div className="text-slate-500">ผู้ติดต่อ: -</div>
                    <div className="text-slate-500 flex gap-4">
                      <span>โทรศัพท์: -</span>
                      <span>อีเมล: -</span>
                    </div>
                  </div>

                  {/* Right Column: โครงการ / หมวดบัญชี */}
                  <div className="space-y-1.5">
                    <div>
                      <span className="text-slate-500 block text-[11px]">โครงการ</span>
                      <div className="font-semibold text-slate-900 py-1">{projectName}</div>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">สถานที่จัดส่ง</span>
                      <input
                        type="text"
                        value={voucherForm.deliveryLocation}
                        onChange={(e) =>
                          setVoucherForm({ ...voucherForm, deliveryLocation: e.target.value })
                        }
                        className="w-full px-2 py-1 border border-slate-300 rounded"
                        placeholder="สถานที่จัดส่ง"
                      />
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">หมวดบัญชี</span>
                      <select
                        value={voucherForm.accountCategory}
                        onChange={(e) =>
                          setVoucherForm({ ...voucherForm, accountCategory: e.target.value })
                        }
                        className="w-full px-2 py-1 border border-slate-300 rounded"
                      >
                        <option value="ค่าวัสดุก่อสร้างและค่าแรง">ค่าวัสดุก่อสร้างและค่าแรง</option>
                        <option value="ค่าเครื่องจักรและยานพาหนะ">ค่าเครื่องจักรและยานพาหนะ</option>
                        <option value="ค่าน้ำมันและสาธารณูปโภค">ค่าน้ำมันและสาธารณูปโภค</option>
                        <option value="ค่าใช้จ่ายบริหารไซต์งาน">ค่าใช้จ่ายบริหารไซต์งาน</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="border border-slate-300 rounded overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-300 text-slate-700">
                      <tr>
                        <th className="py-2 px-3 w-12 text-center">ลำดับ</th>
                        <th className="py-2 px-4">รายการ</th>
                        <th className="py-2 px-3 w-20 text-center">จำนวน</th>
                        <th className="py-2 px-3 w-16 text-center">หน่วย</th>
                        <th className="py-2 px-3 w-28 text-right">ราคาต่อหน่วย</th>
                        <th className="py-2 px-3 w-28 text-right">จำนวนเงิน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {voucherForm.items.map((item, idx) => (
                        <tr key={item.id}>
                          <td className="py-2 px-3 text-center font-mono">{idx + 1}</td>
                          <td className="py-2 px-4">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => {
                                const newItems = [...voucherForm.items];
                                newItems[idx].name = e.target.value;
                                setVoucherForm({ ...voucherForm, items: newItems });
                              }}
                              placeholder="ชื่อรายการ"
                              className="w-full font-medium text-slate-800 border-b border-transparent focus:border-blue-400 focus:outline-hidden"
                            />
                          </td>
                          <td className="py-2 px-3 text-center font-mono">
                            <input
                              type="number"
                              value={item.qty}
                              onChange={(e) => {
                                const newItems = [...voucherForm.items];
                                newItems[idx].qty = Number(e.target.value);
                                setVoucherForm({ ...voucherForm, items: newItems });
                              }}
                              className="w-16 text-center border border-slate-200 rounded py-0.5"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => {
                                const newItems = [...voucherForm.items];
                                newItems[idx].unit = e.target.value;
                                setVoucherForm({ ...voucherForm, items: newItems });
                              }}
                              className="w-12 text-center border border-slate-200 rounded py-0.5"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            <input
                              type="number"
                              value={item.price}
                              onChange={(e) => {
                                const newItems = [...voucherForm.items];
                                newItems[idx].price = Number(e.target.value);
                                setVoucherForm({ ...voucherForm, items: newItems });
                              }}
                              className="w-24 text-right border border-slate-200 rounded py-0.5 font-mono"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            {formatBaht(item.qty * item.price)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-2 bg-slate-50 border-t border-slate-200 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const nextId = `v-item-${voucherForm.items.length + 1}`;
                        setVoucherForm({
                          ...voucherForm,
                          items: [
                            ...voucherForm.items,
                            { id: nextId, name: '', qty: 1, unit: 'ชุด', price: 0 },
                          ],
                        });
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ เพิ่มรายการที่ {voucherForm.items.length + 1}</span>
                    </button>
                  </div>
                </div>

                {/* Footer Section: Left Thai Baht & Notes / Right Calculations */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 pt-2">
                  {/* Left (7 Cols) */}
                  <div className="sm:col-span-7 space-y-4">
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-1">จำนวนเงินตัวอักษร</span>
                      <div className="p-2 border border-slate-300 rounded bg-slate-50/60 font-medium text-slate-800">
                        {thaiBahtText(voucherGrandTotal)}
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] text-slate-500 block mb-1">หมายเหตุ</span>
                      <textarea
                        rows={3}
                        value={voucherForm.notes}
                        onChange={(e) => setVoucherForm({ ...voucherForm, notes: e.target.value })}
                        placeholder="ระบุหมายเหตุหรือข้อความเพิ่มเติม..."
                        className="w-full p-2 border border-slate-300 rounded text-xs focus:outline-hidden"
                      />
                    </div>

                    {/* Bank Details */}
                    <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600 pt-2 border-t border-slate-200">
                      <div>
                        <span className="text-slate-400 block">วิธีชำระเงิน</span>
                        <span className="font-semibold">{voucherForm.payMethod}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">ธนาคาร</span>
                        <span className="font-semibold">{voucherForm.bank}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">สาขา</span>
                        <span>{voucherForm.bankBranch}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">ชื่อบัญชี</span>
                        <span>{voucherForm.accountName}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 block">เลขบัญชี</span>
                        <span className="font-mono font-bold">{voucherForm.accountNo}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right (5 Cols) Calculations */}
                  <div className="sm:col-span-5 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">ประเภท VAT</span>
                      <select
                        value={voucherForm.vatType}
                        onChange={(e) => setVoucherForm({ ...voucherForm, vatType: e.target.value })}
                        className="px-2 py-0.5 border border-slate-300 rounded font-medium"
                      >
                        <option value="7">VAT 7% (แยก VAT)</option>
                        <option value="0">ไม่มี VAT (0%)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">หัก ณ ที่จ่าย (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={voucherForm.whtPercent}
                        onChange={(e) =>
                          setVoucherForm({ ...voucherForm, whtPercent: Number(e.target.value) })
                        }
                        className="w-16 text-right border border-slate-300 rounded py-0.5 px-1 font-mono"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">ส่วนลด</span>
                      <span className="font-mono text-slate-800">
                        {voucherForm.discount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">หักประกันผลงาน (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={voucherForm.retentionPercent}
                        onChange={(e) =>
                          setVoucherForm({
                            ...voucherForm,
                            retentionPercent: Number(e.target.value),
                          })
                        }
                        className="w-16 text-right border border-slate-300 rounded py-0.5 px-1 font-mono"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                      <span className="text-slate-600">รวมก่อน VAT</span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatBaht(voucherAfterDiscount)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">ภาษีมูลค่าเพิ่ม 7%</span>
                      <span className="font-mono text-slate-800">{formatBaht(voucherVat)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">
                        หักประกันผลงาน {voucherForm.retentionPercent}%
                      </span>
                      <span className="font-mono text-red-600">
                        -{formatBaht(voucherRetention)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-2 border-t-2 border-slate-700">
                      <span className="font-bold text-slate-900 text-sm">ยอดสุทธิที่ต้องจ่าย</span>
                      <span className="font-mono font-bold text-base text-red-600">
                        ฿{formatBaht(voucherGrandTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
