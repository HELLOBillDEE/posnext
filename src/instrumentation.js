import net from 'net'

function tcpSend(ip, port, bytes) {
  return new Promise(resolve => {
    const s = new net.Socket()
    let done = false
    const finish = () => { if (!done) { done = true; s.destroy(); resolve() } }
    s.setTimeout(5000)
    s.connect(Number(port) || 9100, ip, () => {
      s.write(bytes, () => s.end())
    })
    s.on('close', finish)
    s.on('timeout', finish)
    s.on('error', finish)
  })
}

// ESC @ — init receipt printer (ไม่พิม)
const RECEIPT_WAKE = Buffer.from([0x1B, 0x40])
// SIZE+GAP — ตั้งค่า label barcode printer (ไม่พิม)
const BARCODE_WAKE = Buffer.from('SIZE 100 mm, 25 mm\r\nGAP 2 mm, 0 mm\r\n')

// โหลด IP เครื่องพิมจาก Supabase settings (pos schema)
async function loadPrinterIPs() {
  try {
    const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return null

    const res = await fetch(
      `${url}/rest/v1/settings?select=key,value&key=in.(printer_barcode,printer_receipt)`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'pos' } }
    )
    if (!res.ok) return null

    const rows = await res.json()
    const map  = Object.fromEntries(rows.map(r => [r.key, r.value]))

    const printers = []
    for (const k of ['printer_barcode', 'printer_receipt']) {
      if (!map[k]) continue
      const cfg = JSON.parse(map[k])
      if (cfg?.ip) printers.push({ ip: cfg.ip, port: Number(cfg.port) || 9100, isBarcode: k === 'printer_barcode' })
    }
    return printers.length ? printers : null
  } catch {
    return null
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // ค่า default — ใช้ถ้า Supabase ยังไม่พร้อม
  let printers = [
    { ip: '192.168.2.48', port: 9100, isBarcode: true  },
    { ip: '192.168.2.88', port: 9100, isBarcode: false },
  ]

  async function refresh() {
    const loaded = await loadPrinterIPs()
    if (loaded) printers = loaded
  }

  function ping() {
    printers.forEach(p => {
      // barcode: connect-only (ไม่ส่ง TSPL เพราะอาจทำให้ printer reset)
      // receipt: ส่ง ESC @ เพื่อ wake
      const bytes = p.isBarcode ? null : RECEIPT_WAKE
      tcpSend(p.ip, p.port, bytes ?? Buffer.alloc(0)).catch(() => {})
    })
  }

  // โหลด config และเริ่ม ping ทันทีหลัง server start
  await refresh()
  ping()

  // Ping ทุก 90 วิ — ถี่พอป้องกัน WiFi sleep ของ printer
  setInterval(ping, 90 * 1000)

  // Refresh config ทุก 1 ชม. — รองรับถ้า IP เปลี่ยน
  setInterval(refresh, 60 * 60 * 1000)
}
