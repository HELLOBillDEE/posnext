'use client'
export default function ScannerSetupPage() {
  const cards = [
    {
      step: 1,
      title: 'เปิดโหมด Bluetooth',
      desc: 'สแกนก่อน เพื่อให้เครื่องเข้าสู่โหมด Bluetooth',
      img: '/scanner/bt-mode.png',
      color: '#1e40af',
    },
    {
      step: 2,
      title: 'ตั้งเป็น Bluetooth HID',
      desc: 'Scanner จะทำงานเหมือนคีย์บอร์ด ไม่ต้องติดตั้ง app',
      img: '/scanner/bt-hid.png',
      color: '#065f46',
    },
    {
      step: 3,
      title: 'ล้างการจับคู่เดิม',
      desc: 'สแกนเพื่อลบ Bluetooth เดิมออก แล้วจับคู่ใหม่กับ iPad',
      img: '/scanner/bt-clear.png',
      color: '#7c2d12',
    },
    {
      step: 4,
      title: 'iOS: เปิด/ปิด Keyboard',
      desc: 'กดปุ่ม Scan 2 ครั้งติดกัน หรือสแกน barcode นี้',
      img: '/scanner/bt-ios.png',
      color: '#4c1d95',
    },
  ]

  return (
    <div style={{ minHeight: '100svh', background: '#f8fafc', padding: '24px 16px', fontFamily: 'var(--font-kanit), sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📡</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>ตั้งค่า Scanner Bluetooth</h1>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>Worrex W-6301 · สแกน barcode ตามลำดับ</p>
        </div>

        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 12, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#78350f' }}>
          <strong>วิธีเชื่อมกับ iPad ใหม่:</strong> สแกน ขั้นที่ 1 → 2 → 3 จากนั้นไปที่ การตั้งค่า → Bluetooth ของ iPad แล้วเลือก "BarCode Scanner HID"
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cards.map(c => (
            <div key={c.step} style={{
              background: 'white',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 1px 8px rgba(0,0,0,0.08)',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ background: c.color, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: 'white', flexShrink: 0,
                }}>
                  {c.step}
                </div>
                <div>
                  <div style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>{c.title}</div>
                  <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 1 }}>{c.desc}</div>
                </div>
              </div>
              <div style={{ padding: '20px 16px', display: 'flex', justifyContent: 'center', background: '#fff' }}>
                <img
                  src={c.img}
                  alt={c.title}
                  style={{ width: '100%', maxWidth: 320, imageRendering: 'pixelated' }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#14532d' }}>
          <strong>💡 ทิปส์:</strong> ถ้า Scanner กะพริบ = ยังไม่ได้เชื่อม | ไฟคงที่ = เชื่อมแล้ว<br />
          กดปุ่ม Scan 2 ครั้งติดกัน = เปิด/ปิด Keyboard บน iOS
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 20 }}>
          ข้อมูลจาก NETUM W6-X Manual · ใช้ได้กับ Worrex W-6301
        </p>
      </div>
    </div>
  )
}
