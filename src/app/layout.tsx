import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="th">
      <body className="antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
