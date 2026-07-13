import { createClient } from '@supabase/supabase-js'
import { getTgSettings } from '@/lib/telegramStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '-'
const PAY_LABEL = { cash: 'เงินสด', transfer: 'โอน/QR', credit: 'เชื่อ', mixed: 'ผสม' }

export async function GET(req) {
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const cfg = await getTgSettings()
    if (!cfg) return Response.json({ error: 'Telegram ยังไม่ได้ตั้งค่า' })

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const from  = `${today}T00:00:00+07:00`
    const to    = `${today}T23:59:59+07:00`

    const [{ data: sales }, { data: shifts }, { data: drawers }, { data: settings }] = await Promise.all([
      supabase.from('sales').select('total, payment_method').gte('created_at', from).lte('created_at', to).eq('status', 'completed'),
      supabase.from('shifts').select('*').gte('opened_at', from).lte('opened_at', to).order('opened_at'),
      supabase.from('drawer_logs').select('amount, note').gte('opened_at', from).lte('opened_at', to),
      supabase.from('settings').select('key,value').in('key', ['shop_name']),
    ])

    const shopName = settings?.find(r => r.key === 'shop_name')?.value || 'ร้านค้า'
    const dateStr  = new Date().toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric',
    })

    // ยอดขายรวม
    const salesTotal = (sales || []).reduce((s, r) => s + Number(r.total || 0), 0)
    const salesCount = (sales || []).length
    const byMethod   = {}
    for (const s of (sales || [])) {
      const m = s.payment_method || 'other'
      byMethod[m] = (byMethod[m] || 0) + Number(s.total || 0)
    }

    // เงินเข้า/ออกเก๊ะ
    const drawerIn  = (drawers || []).filter(d => (d.note||'').includes('รับเงินเข้า')).reduce((s,d) => s + Number(d.amount||0), 0)
    const drawerOut = (drawers || []).filter(d => (d.note||'').includes('เบิกเงินออก')).reduce((s,d) => s + Number(d.amount||0), 0)

    // กะทำงาน
    const shiftLines = (shifts || []).map((sh, i) => {
      const lines = [`🔷 กะ ${i + 1}${sh.cashier_name ? ` — ${sh.cashier_name}` : ''}`]
      lines.push(`  เปิด ${fmtTime(sh.opened_at)} | เงินต้นกะ ฿${fmt(sh.opening_cash)}`)
      if (sh.closed_at) {
        lines.push(`  ปิด ${fmtTime(sh.closed_at)} | นับได้ ฿${fmt(sh.closing_cash)}`)
        const diff = Number(sh.difference || 0)
        const diffStr = diff === 0 ? '✅ ตรง' : diff > 0 ? `+฿${fmt(diff)} (เกิน)` : `-฿${fmt(Math.abs(diff))} (ขาด)`
        lines.push(`  ผลต่าง: ${diffStr}`)
      } else {
        lines.push(`  ⏳ กะยังเปิดอยู่`)
      }
      return lines.join('\n')
    }).join('\n')

    const methodLines = Object.entries(byMethod)
      .map(([m, amt]) => `  • ${PAY_LABEL[m] || m}: ฿${fmt(amt)}`)
      .join('\n')

    const parts = [
      `📊 <b>สรุปประจำวัน</b>`,
      `🏪 ${shopName}  |  📅 ${dateStr}`,
      ``,
      `🧾 ยอดขายรวม: <b>฿${fmt(salesTotal)}</b>  (${salesCount} บิล)`,
      methodLines ? `💳 แยกชำระ:\n${methodLines}` : null,
    ]

    if (drawerIn > 0 || drawerOut > 0) {
      parts.push(`\n💰 เงินเข้าเก๊ะ: ฿${fmt(drawerIn)}`)
      parts.push(`💸 เบิกออก: ฿${fmt(drawerOut)}`)
    }

    if (shiftLines) {
      parts.push(`\n${shiftLines}`)
    }

    const text = parts.filter(l => l !== null).join('\n')

    const res = await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text, parse_mode: 'HTML' }),
    })
    const json = await res.json()
    if (!json.ok) return Response.json({ error: json.description }, { status: 500 })

    return Response.json({ ok: true, salesTotal, salesCount })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
