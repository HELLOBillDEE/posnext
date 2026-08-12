import { createClient } from '@supabase/supabase-js'
import { getTgSettings } from '@/lib/telegramStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '-'

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
      supabase.from('sales').select('total, payment_method, note').gte('created_at', from).lte('created_at', to).eq('status', 'completed'),
      supabase.from('shifts').select('*').gte('opened_at', from).lte('opened_at', to).order('opened_at'),
      supabase.from('drawer_logs').select('amount, note').gte('opened_at', from).lte('opened_at', to),
      supabase.from('settings').select('key,value').in('key', ['shop_name']),
    ])

    const shopName = settings?.find(r => r.key === 'shop_name')?.value || 'ร้านค้า'
    const dateStr  = new Date().toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric',
    })

    // ยอดขายรวมและแยกประเภท
    const salesTotal = (sales || []).reduce((s, r) => s + Number(r.total || 0), 0)
    const salesCount = (sales || []).length
    const govtByType = {}
    const transferByAcct = {}
    let cashTotal = 0, transferTotal = 0, creditTotal = 0

    for (const r of sales || []) {
      const meth = r.payment_method, n = Number(r.total), note = r.note || ''
      if (meth === 'cash') { cashTotal += n }
      else if (meth?.startsWith('govt_')) {
        const t = meth.slice(5); govtByType[t] = (govtByType[t] || 0) + n
      } else if (meth === 'govt') {
        govtByType['ไม่ระบุ'] = (govtByType['ไม่ระบุ'] || 0) + n
      } else if (meth === 'transfer') {
        const acctM = note.match(/\[บัญชี: ([^\]]+)\]/)
        const acct = acctM?.[1] || 'โอน/QR'
        transferByAcct[acct] = (transferByAcct[acct] || 0) + n; transferTotal += n
      } else if (meth === 'credit') { creditTotal += n }
      else if (meth === 'mixed') {
        const cashM = note.match(/สด ฿([\d,]+(?:\.\d+)?)/)
        if (cashM) cashTotal += parseFloat(cashM[1].replace(/,/g, ''))
        for (const m of [...note.matchAll(/โอน\(([^)]+)\) ฿([\d,]+(?:\.\d+)?)/g)]) {
          const a = parseFloat(m[2].replace(/,/g, ''))
          transferByAcct[m[1]] = (transferByAcct[m[1]] || 0) + a; transferTotal += a
        }
        const plainTransferM = note.match(/โอน ฿([\d,]+(?:\.\d+)?)/)
        if (plainTransferM && !note.includes('โอน(')) {
          const a = parseFloat(plainTransferM[1].replace(/,/g, ''))
          transferByAcct['โอน/QR'] = (transferByAcct['โอน/QR'] || 0) + a; transferTotal += a
        }
        for (const m of [...note.matchAll(/โครงการรัฐ\(([^)]+)\) ฿([\d,]+(?:\.\d+)?)/g)]) {
          const a = parseFloat(m[2].replace(/,/g, ''))
          govtByType[m[1]] = (govtByType[m[1]] || 0) + a
        }
        const plainGovtM = note.match(/โครงการรัฐ ฿([\d,]+(?:\.\d+)?)/)
        if (plainGovtM && !note.includes('โครงการรัฐ(')) {
          govtByType['ไม่ระบุ'] = (govtByType['ไม่ระบุ'] || 0) + parseFloat(plainGovtM[1].replace(/,/g, ''))
        }
        const creditM = note.match(/เชื่อ ฿([\d,]+(?:\.\d+)?)/)
        if (creditM) creditTotal += parseFloat(creditM[1].replace(/,/g, ''))
      }
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

    const lines = [
      `📊 <b>สรุปประจำวัน</b>`,
      `🏪 ${shopName}  |  📅 ${dateStr}`,
      ``,
      `🧾 ยอดขายรวม: <b>฿${fmt(salesTotal)}</b>  (${salesCount} บิล)`,
      ``,
      `💵 เงินสดชนลิ้นชัก: ฿${fmt(cashTotal)}`,
    ]

    const accts = Object.entries(transferByAcct)
    if (accts.length > 0) {
      accts.forEach(([acct, amt]) => lines.push(`📱 โอน — ${acct}: ฿${fmt(amt)}`))
    } else if (transferTotal > 0) {
      lines.push(`📱 โอน/QR: ฿${fmt(transferTotal)}`)
    }
    if (creditTotal > 0) lines.push(`📝 เชื่อ: ฿${fmt(creditTotal)}`)
    Object.entries(govtByType).forEach(([type, amt]) => lines.push(`🏛 ${type}: ฿${fmt(amt)}`))

    if (drawerIn > 0 || drawerOut > 0) {
      lines.push(``)
      if (drawerIn  > 0) lines.push(`💰 เงินเข้าเก๊ะ: ฿${fmt(drawerIn)}`)
      if (drawerOut > 0) lines.push(`💸 เบิกออก: ฿${fmt(drawerOut)}`)
    }

    if (shiftLines) {
      lines.push(``)
      lines.push(shiftLines)
    }

    const text = lines.join('\n')

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
