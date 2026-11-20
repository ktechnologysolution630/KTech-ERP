'use client';

/** Replaces the whole page when even the outer layout fails; it brings its own <html> and plain styles */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="th">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h2 style={{ fontSize: 18 }}>เกิดข้อผิดพลาด ระบบโหลดหน้านี้ไม่สำเร็จ</h2>
          <p style={{ color: '#475569', fontSize: 14 }}>ลองใหม่อีกครั้ง หากยังไม่ได้ กรุณาแจ้งผู้ดูแลระบบ</p>
          <button type="button" onClick={() => retry()} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff' }}>
            ลองใหม่
          </button>
        </div>
      </body>
    </html>
  );
}
