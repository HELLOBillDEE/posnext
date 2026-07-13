import { createClient } from '@supabase/supabase-js'
import { getTgSettings } from '@/lib/telegramStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const PAY_LABEL = { cash: 'เงินสด', transfer: 'โอน/QR', credit: 'เชื่อ', mixed: 'ผสม' }

export async function GET(req) {
  // ตรวจ Cron secret (Vercel ส่ง Authorization header)
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const cfg = await getTgSettings()
    if (!cfg) return Response.json({ error: 'Telegram ยังไม่ได้ตั้งค่า' })

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const from  = `${today}T00:00:00+07:00`
    const to    = `${today}T23:59:59+07:00`

    const { data: sales } = await supabase
      .from('sales')
      .select('total, payment_method, status')
      .gte('created_at', from)
      .lte('created_at', to)
      .eq('status', 'completed')

    const { data: settings } = await supabase.from('settings').select('key,value').in('key', ['shop_name'])
    const shopName = settings?.find(r => r.key === 'shop_name')?.value || 'ร้านค้า'

    const total   = (sales || []).reduce((s, r) => s + Number(r.total || 0), 0)
    const count   = (sales || []).length

    // แยกตามวิธีชำระ
    const byMethod = {}
    for (const s of (sales || [])) {
      const m = s.payment_method || 'other'
      byMethod[m] = (byMethod[m] || 0) + Number(s.total || 0)
    }

    const dateStr = new Date().toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric',
    })

    const methodLines = Object.entries(byMethod)
      .map(([m, amt]) => `  • ${PAY_LABEL[m] || m}: ฿${fmt(amt)}`)
      .join('\n')

    const text = [
      `📊 <b>สรุปยอดขายประจำวัน</b>`,
      `🏪 ${shopName}`,
      `📅 ${dateStr}`,
      ``,
      `🧾 ยอดขายรวม: <b>฿${fmt(total)}</b>`,
      `📋 จำนวนบิล: ${count} บิล`,
      methodLines ? `\n💳 แยกตามการชำระ:\n${methodLines}` : null,
    ].filter(l => l !== null).join('\n')

    const res = await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text, parse_mode: 'HTML' }),
    })
    const json = await res.json()
    if (!json.ok) return Response.json({ error: json.description }, { status: 500 })

    return Response.json({ ok: true, total, count })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
