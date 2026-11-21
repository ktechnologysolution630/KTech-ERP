import type { Metadata } from 'next';
import { Inter, Noto_Sans_Thai } from 'next/font/google';
import './globals.css';

// Inter stands in for SF Pro on Windows/Android; Noto Sans Thai is the loopless Thai face closest to Apple's
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const notoThai = Noto_Sans_Thai({ subsets: ['thai'], variable: '--font-thai', display: 'swap' });

export const metadata: Metadata = {
  title: 'K Tec ERP - ระบบจัดซื้อและจ่ายเงิน',
  description: 'ระบบจัดซื้อและจ่ายเงินสำหรับงานรับเหมาก่อสร้าง',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${inter.variable} ${notoThai.variable}`}>
      <body className="antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
