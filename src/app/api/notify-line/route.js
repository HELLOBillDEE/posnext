import { requireAuth, unauthorizedResponse } from '@/lib/authApi'
import { createClient } from '@supabase/supabase-js'

const PAY_LABEL = { cash: 'เงินสด', transfer: 'โอน/QR', credit: 'เชื่อ', mixed: 'ผสม' }

export async function POST(req) {
  if (!await requireAuth(req)) return unauthorizedResponse()

  try {
    const { sale } = await req.json()
    if (!sale) return Response.json({ error: 'No sale data' }, { status: 400 })

    // Load LINE settings from DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { db: { schema: 'pos' } }
    )
    const { data: cfg } = await supabase.from('settings')
      .select('key,value')
      .in('key', ['line_channel_token', 'line_group_id', 'shop_name'])
    if (!cfg?.length) return Response.json({ skipped: true })

    const settings = Object.fromEntries(cfg.map(r => [r.key, r.value]))
    const token = settings.line_channel_token
    const groupId = settings.line_group_id
    if (!token || !groupId) return Response.json({ skipped: true, reason: 'not configured' })

    const shopName = settings.shop_name || 'ร้านค้า'

    // Build message
    const itemLines = (sale.items || [])
      .map(i => `  • ${i.name} ×${i.qty} = ฿${fmt(i.price * i.qty - (i.disc || 0))}`)
      .join('\n')

    const payMethod = PAY_LABEL[sale.payment_method] || sale.payment_method
    const mixNote = sale.payment_method === 'mixed' && sale.note
      ? '\n' + (sale.note.match(/\[ผสม:([^\]]+)\]/)?.[1]?.trim() || '') : ''

    const text = [
      `🛒 ${shopName}`,
      `📄 ${sale.receipt_no}`,
      sale.customerName ? `👤 ${sale.customerName}` : null,
      ``,
      itemLines,
      ``,
      sale.subtotal !== sale.total
        ? `ยอดรวม ฿${fmt(sale.subtotal)}\nส่วนลด -฿${fmt((sale.subtotal || 0) - (sale.total || 0))}`
        : null,
      `💰 รวม ฿${fmt(sale.total)}`,
      `💳 ${payMethod}${mixNote}`,
    ].filter(l => l !== null).join('\n')

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: 'text', text }],
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      return Response.json({ error: err.message || 'LINE API error', status: res.status }, { status: 502 })
    }

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
