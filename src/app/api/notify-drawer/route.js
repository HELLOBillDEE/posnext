import { notifyDrawer } from '@/lib/telegramStaff'

export async function POST(req) {
  try {
    const body = await req.json()
    const { employeeName, shopName, note } = body

    notifyDrawer({ employeeName, shopName, note }).catch(e => console.error('[notify-drawer]', e?.message))

    const timeStr = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
    const caption = `🔓 เปิดลิ้นชัก — ${employeeName || 'แอดมิน'}  🕐 ${timeStr}`

    // fire-and-forget: ถ่ายภาพส่ง Telegram (ทำได้เพราะรันบน local PM2 ในวง LAN เดียวกับกล้อง)
    fetch(new URL('/api/camera-snapshot', req.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption }),
    }).catch(e => console.error('[camera-snapshot]', e?.message))

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
