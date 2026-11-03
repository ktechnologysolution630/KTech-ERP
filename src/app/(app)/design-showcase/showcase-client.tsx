'use client';

import React, { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import {
  Sparkles,
  Layers,
  Cpu,
  Zap,
  CheckCircle2,
  TrendingUp,
  Package,
  ShoppingCart,
  FileText,
  DollarSign,
  ChevronRight,
  Shield,
  Eye,
  Activity,
  Maximize2,
} from 'lucide-react';
import { animateStaggerEntrance, isLowSpecDevice } from '@/lib/gsap-smooth';

type DesignStyleKey = 'crystal' | 'navy' | 'onyx' | 'titanium' | 'emerald';

interface DesignStyleInfo {
  key: DesignStyleKey;
  number: string;
  nameTh: string;
  nameEn: string;
  tagline: string;
  accentColor: string;
  badgeBg: string;
  bgGradient: string;
  cardClass: string;
  tableHeaderClass: string;
  buttonClass: string;
  description: string;
  pros: string[];
}

const DESIGN_STYLES: DesignStyleInfo[] = [
  {
    key: 'crystal',
    number: 'แบบที่ 1',
    nameTh: 'Crystal Clean (Aerospace White Glass)',
    nameEn: 'มินิมอลโมเดิร์น กระจกใสคริสตัล',
    tagline: 'คลีน สบายตา ใช้ทรัพยากร GPU น้อยที่สุด โหลดไวทันใจ',
    accentColor: '#2453d4',
    badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
    bgGradient: 'bg-gradient-to-br from-[#f8fafc] via-[#f1f5f9] to-[#e2e8f0]',
    cardClass: 'liquid-glass-clean text-slate-800',
    tableHeaderClass: 'bg-[#102d72] text-white',
    buttonClass: 'bg-[#2453d4] hover:bg-blue-700 text-white shadow-xs',
    description:
      'ออกแบบโดยเน้นความโปร่งแสงแบบคริสตัล ใช้ขอบเส้นเงา 1px และ Blur 8px ระดับเบาพิเศษ ไม่กินแรมการ์ดจอ เหมาะสำหรับการทำงานเอกสารจัดซื้อทั้งวันโดยไม่ล้าสายตา',
    pros: [
      'ใช้ VRAM การ์ดจอน้อยที่สุด (< 15MB)',
      'การันตี 60 FPS บน Intel UHD Graphics / AMD Vega',
      'ค่าความคมชัดของฟอนต์ภาษาไทยสูงสุด (High Contrast Ratio 12:1)',
    ],
  },
  {
    key: 'navy',
    number: 'แบบที่ 2',
    nameTh: 'Deep Navy Aurora Glass (Executive Navy)',
    nameEn: 'สีกรมท่าลึก กึ่งโปร่งแสง หรูหราทันสมัย',
    tagline: 'มิติความลึกพรีเมียม สไตล์ห้องประชุมผู้บริหารและการเงิน',
    accentColor: '#38bdf8',
    badgeBg: 'bg-sky-950 text-sky-300 border-sky-800',
    bgGradient: 'bg-gradient-to-br from-[#06122c] via-[#0a192f] to-[#0f2757]',
    cardClass: 'liquid-glass-navy text-slate-100',
    tableHeaderClass: 'bg-[#06122c]/90 text-sky-200 border-b border-sky-500/20',
    buttonClass: 'bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-md',
    description:
      'ใช้โทนสีกรมท่า Midnight Blue ผสมผสานขอบแสงประกาย Aurora ให้ความรู้สึกมั่นคง น่าเชื่อถือ มีอำนาจในการตัดสินใจ เหมาะสำหรับหน้าอนุมัติจัดซื้อและงบการเงิน',
    pros: [
      'ดึงดูดสายตาไปยังตัวเลขสำคัญและงบประมาณการเงิน',
      'ขอบแก้วเรืองแสงแบบ Inner Glow สวยงามพรีเมียม',
      'คำนวณเฉดสีโดยไม่ใช้ Multi-pass Blur ซ้ำซ้อน ประหยัดพลังงาน',
    ],
  },
  {
    key: 'onyx',
    number: 'แบบที่ 3',
    nameTh: 'Onyx Holographic Glass (Dark Luxury Tech)',
    nameEn: 'ดาร์กโหมด ลิควิดกลาส โฮโลกราฟิก',
    tagline: 'มืดสนิท ล้ำยุค ถนอมสายตา สำหรับไซต์งานและผู้เชี่ยวชาญ',
    accentColor: '#10b981',
    badgeBg: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    bgGradient: 'bg-gradient-to-br from-[#09090b] via-[#121215] to-[#18181b]',
    cardClass: 'liquid-glass-onyx text-zinc-100',
    tableHeaderClass: 'bg-zinc-900/90 text-emerald-400 border-b border-zinc-800',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs',
    description:
      'สไตล์ Stark Industries & Bloomberg Terminal สำหรับผู้ที่ชื่นชอบหน้าจอดาร์กโหมด ลดแสงสีฟ้าและลดความเมื่อยล้าสายตา ขอบการ์ดมีประกายเส้นโฮโลกราฟิกคมกริบ',
    pros: [
      'ประหยัดพลังงานจอภาพ OLED / IPS สูงสุด 40%',
      'มองเห็นตัวเลข สถานะสต็อก และการแจ้งเตือนเตือนภัยชัดเจนทันที',
      'Shader แสงขอบเบาพิเศษ ทำงานลื่นไหลแม้เปิดทิ้งไว้หลายชั่วโมง',
    ],
  },
  {
    key: 'titanium',
    number: 'แบบที่ 4',
    nameTh: 'Titanium Industrial Glass (Civil Engineering)',
    nameEn: 'ไทเทเนียมวิศวกรรมก่อสร้าง เรียบหรูแข็งแกร่ง',
    tagline: 'ความแม่นยำทางวิศวกรรม แข็งแกร่ง รองรับข้อมูลตารางหนาแน่น',
    accentColor: '#d97706',
    badgeBg: 'bg-amber-50 text-amber-800 border-amber-300',
    bgGradient: 'bg-gradient-to-br from-[#f1f5f9] via-[#e2e8f0] to-[#cbd5e1]',
    cardClass: 'liquid-glass-titanium text-slate-800',
    tableHeaderClass: 'bg-[#334155] text-amber-300 border-b border-slate-400',
    buttonClass: 'bg-[#334155] hover:bg-slate-700 text-white shadow-xs',
    description:
      'โทนสีโลหะเทาไทเทเนียมและแพลทินัม สะท้อนความแข็งแรงของอุตสาหกรรมก่อสร้าง วิศวกรรมโยธา ผสานตารางข้อมูลที่กระชับ อ่านค่างวดงานและ PO ได้ชัดเจนที่สุด',
    pros: [
      'เหมาะอย่างยิ่งสำหรับตาราง Excel และรายการวัสดุกว่า 100 บรรทัด',
      'มิติขอบเหลี่ยมแบบ Bevel ชัดเจน ดูมีระเบียบและเสถียรภาพ',
      'ไม่มีภาพกราฟิกฉูดฉาด ประหยัด RAM แล็ปท็อปหน้างานอย่างยอดเยี่ยม',
    ],
  },
  {
    key: 'emerald',
    number: 'แบบที่ 5',
    nameTh: 'Emerald Horizon Glass (Eco & Sustainable)',
    nameEn: 'กรีนเอเมอรัลด์ กระจกมรกตใส สดชื่นมีพลัง',
    tagline: 'สีเขียวมรกตสะท้อนความยั่งยืน กำไร และความก้าวหน้าโครงการ',
    accentColor: '#059669',
    badgeBg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    bgGradient: 'bg-gradient-to-br from-[#f0fdf4] via-[#f8fafc] to-[#e6f4ea]',
    cardClass: 'liquid-glass-emerald text-slate-800',
    tableHeaderClass: 'bg-[#064e3b] text-emerald-100',
    buttonClass: 'bg-[#059669] hover:bg-emerald-700 text-white shadow-xs',
    description:
      'การผสมผสานระหว่างสีขาวไข่มุกและกระจกเคลือบประกายมรกต ให้บรรยากาศการทำงานที่สบายตา ผ่อนคลาย และสื่อถึงการก่อสร้างที่เป็นมิตรต่อสิ่งแวดล้อมและงบประมาณที่เป็นบวก',
    pros: [
      'สร้างความรู้สึกสดชื่น ผ่อนคลายระหว่างการตรวจทานตัวเลข',
      'สีเขียวมรกตนำสายตาสู่ความก้าวหน้า (%) ของแต่ละงวดงาน',
      'เบาเครื่อง สบายตา และดูทันสมัยระดับสากล',
    ],
  },
];

export function ShowcaseClient() {
  const [activeKey, setActiveKey] = useState<DesignStyleKey>('crystal');
  const [isLowSpec, setIsLowSpec] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const currentStyle = DESIGN_STYLES.find((s) => s.key === activeKey) || DESIGN_STYLES[0];

  useEffect(() => {
    setIsLowSpec(isLowSpecDevice());
  }, []);

  // Trigger GSAP entrance animation when switching styles
  useEffect(() => {
    if (!cardsRef.current) return;
    const cards = cardsRef.current.querySelectorAll('.animate-target');
    animateStaggerEntrance(cards, { y: 14, stagger: 0.05, duration: 0.3 });
  }, [activeKey]);

  return (
    <div className={`min-h-screen transition-colors duration-500 ${currentStyle.bgGradient} p-4 md:p-8 font-sans`}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Floating Glass Navigation Header */}
        <div className={`p-5 rounded-2xl ${currentStyle.cardClass} flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300`}>
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${currentStyle.badgeBg}`}>
                LIQUID GLASS & GSAP DESIGN LAB
              </span>
              <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100/80 text-emerald-800 font-medium">
                <Zap className="w-3 h-3 text-emerald-600" />
                <span>60 FPS Optimized (iGPU & 8GB RAM)</span>
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold mt-1.5 flex items-center gap-2">
              <span>5 รูปแบบการออกแบบหน้าเว็บ (Liquid Glass Styles)</span>
            </h1>
            <p className="text-xs opacity-75 mt-0.5">
              คลิกเลือกรูปแบบด้านล่างเพื่อเปรียบเทียบโทนสี แสงสะท้อนลิควิดกลาส และความลื่นไหลในการแสดงผล
            </p>
          </div>

          {/* Quick Hardware Spec Badge */}
          <div className="flex items-center gap-3 shrink-0 text-xs p-2.5 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
            <Cpu className="w-4 h-4 text-blue-500 shrink-0" />
            <div>
              <div className="font-semibold">ระบบเร่งความเร็ว GPU อัตโนมัติ</div>
              <div className="text-[10px] opacity-70">
                {isLowSpec ? 'โหมดประหยัดพลังงาน: เปิดใช้งาน' : 'โหมดเต็มประสิทธิภาพ: 60 FPS'}
              </div>
            </div>
          </div>
        </div>

        {/* 5 Style Selector Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {DESIGN_STYLES.map((style) => {
            const isSelected = style.key === activeKey;
            return (
              <button
                key={style.key}
                type="button"
                onClick={() => setActiveKey(style.key)}
                className={`p-3.5 rounded-xl text-left transition-all duration-200 border relative overflow-hidden select-none ${
                  isSelected
                    ? 'ring-2 ring-blue-500 shadow-md scale-[1.02] bg-white dark:bg-zinc-800 border-transparent font-bold'
                    : 'bg-white/60 dark:bg-zinc-900/40 hover:bg-white dark:hover:bg-zinc-800 border-slate-200/80 dark:border-zinc-700/60 opacity-80 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                    {style.number}
                  </span>
                  {isSelected && (
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                  )}
                </div>
                <div className="text-xs font-bold truncate text-slate-900 dark:text-white">
                  {style.nameTh.split('(')[0]}
                </div>
                <div className="text-[10px] opacity-70 mt-1 line-clamp-1">
                  {style.nameEn}
                </div>
              </button>
            );
          })}
        </div>

        {/* Style Deep-Dive Banner */}
        <div className={`p-6 rounded-2xl ${currentStyle.cardClass} space-y-4`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-black/10 dark:border-white/10">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-sky-400">
                {currentStyle.number} : {currentStyle.nameEn}
              </div>
              <h2 className="text-lg md:text-xl font-bold mt-0.5">
                {currentStyle.nameTh}
              </h2>
              <p className="text-xs opacity-80 mt-1">
                {currentStyle.description}
              </p>
            </div>
            <button
              type="button"
              className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${currentStyle.buttonClass}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>เลือกใช้งานสไตล์นี้</span>
            </button>
          </div>

          {/* Key Advantages */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {currentStyle.pros.map((pro, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 p-2.5 rounded-lg bg-black/5 dark:bg-white/5 text-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span className="opacity-90">{pro}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Live Interactive ERP Preview in Selected Style */}
        <div ref={cardsRef} className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider opacity-70 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              <span>ตัวอย่างการแสดงผลระบบจริง (Live Interactive Demo)</span>
            </h3>
            <span className="text-[11px] opacity-60">
              ทดสอบ GSAP Micro-stagger & Smooth Hover
            </span>
          </div>

          {/* 4 KPI Glass Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`p-4 rounded-xl ${currentStyle.cardClass} animate-target space-y-2`}>
              <div className="flex items-center justify-between text-xs opacity-75">
                <span>ยอดสั่งซื้อทั้งหมด (PO)</span>
                <ShoppingCart className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-xl font-bold font-mono">฿1,425,800.00</div>
              <div className="text-[11px] text-emerald-600 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                <span>+12.4% เทียบกับเดือนก่อน</span>
              </div>
            </div>

            <div className={`p-4 rounded-xl ${currentStyle.cardClass} animate-target space-y-2`}>
              <div className="flex items-center justify-between text-xs opacity-75">
                <span>เอกสารรออนุมัติ</span>
                <Shield className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-xl font-bold font-mono">6 ฉบับ</div>
              <div className="text-[11px] opacity-70">
                PR: 4 รายการ • PO: 2 รายการ
              </div>
            </div>

            <div className={`p-4 rounded-xl ${currentStyle.cardClass} animate-target space-y-2`}>
              <div className="flex items-center justify-between text-xs opacity-75">
                <span>วัสดุรอรับเข้าไซต์งาน</span>
                <Package className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-xl font-bold font-mono">8 โครงการ</div>
              <div className="text-[11px] text-blue-600 flex items-center gap-1">
                <span>พร้อมตรวจรับของวันนี้</span>
              </div>
            </div>

            <div className={`p-4 rounded-xl ${currentStyle.cardClass} animate-target space-y-2`}>
              <div className="flex items-center justify-between text-xs opacity-75">
                <span>งวดงานจ่ายถัดไป (PRV)</span>
                <DollarSign className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-xl font-bold font-mono">฿380,000.00</div>
              <div className="text-[11px] opacity-70">
                ครบกำหนดใน 5 วันข้างหน้า
              </div>
            </div>
          </div>

          {/* Interactive Liquid Glass Data Table */}
          <div className={`rounded-xl ${currentStyle.cardClass} overflow-hidden shadow-xs animate-target`}>
            <div className="p-4 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-sm">รายการจัดซื้อและงวดงานล่าสุด</h4>
                <p className="text-[11px] opacity-70">
                  ตารางแสดงผล Liquid Glass คมชัด ไร้อาการกระตุกขณะ Scroll
                </p>
              </div>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${currentStyle.buttonClass}`}
              >
                + ออกใบขอซื้อ (PR)
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={currentStyle.tableHeaderClass}>
                    <th className="py-3 px-4 font-medium">เลขที่เอกสาร</th>
                    <th className="py-3 px-4 font-medium">โครงการ</th>
                    <th className="py-3 px-4 font-medium">ซัพพลายเออร์ / ผู้รับเหมา</th>
                    <th className="py-3 px-4 font-medium text-right">มูลค่ารวม</th>
                    <th className="py-3 px-4 font-medium text-center">สถานะ</th>
                    <th className="py-3 px-4 font-medium text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  <tr className="hover:bg-black/5 dark:hover:bg-white/5 transition">
                    <td className="py-3 px-4 font-mono font-medium text-blue-600 dark:text-sky-400">
                      PO-2026-0042
                    </td>
                    <td className="py-3 px-4">อาคารสำนักงานทองหล่อ (TL-01)</td>
                    <td className="py-3 px-4">บจก. เหล็กสยามอุตสาหกรรม</td>
                    <td className="py-3 px-4 text-right font-mono font-medium">฿245,000.00</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                        รอรับสินค้า
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-blue-600 dark:text-sky-400 hover:underline cursor-pointer">
                        ดูรายละเอียด →
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-black/5 dark:hover:bg-white/5 transition">
                    <td className="py-3 px-4 font-mono font-medium text-blue-600 dark:text-sky-400">
                      PRV-2026-0018
                    </td>
                    <td className="py-3 px-4">โครงการบ้านพักตากอากาศ หัวหิน (HH-02)</td>
                    <td className="py-3 px-4">ทีมช่างสมชาย (งานโครงสร้าง)</td>
                    <td className="py-3 px-4 text-right font-mono font-medium">฿120,000.00</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                        อนุมัติจ่ายแล้ว
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-blue-600 dark:text-sky-400 hover:underline cursor-pointer">
                        ดูรายละเอียด →
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-black/5 dark:hover:bg-white/5 transition">
                    <td className="py-3 px-4 font-mono font-medium text-blue-600 dark:text-sky-400">
                      PR-2026-0089
                    </td>
                    <td className="py-3 px-4">สำนักงานใหญ่ เค เทค (HQ-01)</td>
                    <td className="py-3 px-4">บจก. สีเดลต้า คอนสตรัคชั่น</td>
                    <td className="py-3 px-4 text-right font-mono font-medium">฿68,500.00</td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                        รออนุมัติ
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-blue-600 dark:text-sky-400 hover:underline cursor-pointer">
                        ดูรายละเอียด →
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
