import { createClient } from '@supabase/supabase-js'
import { getLineSettings } from '@/lib/lineStaff'

export const dynamic = 'force-dynamic'

const sbService = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export async function POST(req) {
  try {
    const { lineUserId, items, note, manualText, messages } = await req.json()
    if (!lineUserId) return Response.json({ error: 'missing lineUserId' }, { status: 400 })

    // ── Raw messages array (e.g. image + text for payment chip) ──
    if (messages?.length) {
      const lineCfg = await getLineSettings()
      if (!lineCfg?.line_channel_token) return Response.json({ error: 'no LINE token' }, { status: 500 })
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineCfg.line_channel_token}` },
        body: JSON.stringify({ to: lineUserId, messages }),
      })
      if (!res.ok) { const e = await res.json(); return Response.json({ error: e.message }, { status: 500 }) }
      // บันทึก text messages เป็นประวัติ
      const textMsgs = messages.filter(m => m.type === 'text').map(m => m.text).join('\n')
      if (textMsgs) await sbService.from('line_conversations').insert({ line_user_id: lineUserId, role: 'assistant', content: textMsgs })
      return Response.json({ ok: true })
    }

    // ── Manual text reply ──
    if (manualText) {
      const lineCfg = await getLineSettings()
      if (!lineCfg?.line_channel_token) return Response.json({ error: 'no LINE token' }, { status: 500 })
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineCfg.line_channel_token}` },
        body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: manualText }] }),
      })
      if (!res.ok) { const e = await res.json(); return Response.json({ error: e.message }, { status: 500 }) }
      await sbService.from('line_conversations').insert({ line_user_id: lineUserId, role: 'assistant', content: manualText })
      return Response.json({ ok: true })
    }

    if (!items?.length) return Response.json({ error: 'missing data' }, { status: 400 })

    const lineCfg = await getLineSettings()
    if (!lineCfg?.line_channel_token)
      return Response.json({ error: 'no LINE token' }, { status: 500 })

    const lineToken = lineCfg.line_channel_token
    const total = items.reduce((s, it) => s + (Number(it.price) * Number(it.qty || 1)), 0)

    const itemRows = items.flatMap(it => [{
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'text', text: it.name, size: 'sm', color: '#1e293b', flex: 4, wrap: true },
        { type: 'text', text: `×${it.qty}`, size: 'sm', color: '#64748b', flex: 1, align: 'center' },
        { type: 'text', text: `฿${fmt(it.price * it.qty)}`, size: 'sm', color: '#C72C41', flex: 2, align: 'end', weight: 'bold' },
      ],
    }])

    const flex = {
      type: 'flex',
      altText: `📋 รายการสินค้า รวม ฿${fmt(total)}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box', layout: 'vertical', paddingAll: '16px',
          backgroundColor: '#C72C41',
          contents: [{ type: 'text', text: '📋 รายการสินค้าจากร้าน', weight: 'bold', color: '#ffffff', size: 'md' }],
        },
        body: {
          type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
          contents: [
            ...itemRows,
            { type: 'separator', margin: 'md' },
            {
              type: 'box', layout: 'horizontal', margin: 'md',
              contents: [
                { type: 'text', text: 'รวมทั้งหมด', weight: 'bold', size: 'sm', color: '#1e293b', flex: 3 },
                { type: 'text', text: `฿${fmt(total)}`, weight: 'bold', size: 'xl', color: '#C72C41', align: 'end', flex: 2 },
              ],
            },
            ...(note ? [{ type: 'text', text: `💬 ${note}`, size: 'xs', color: '#64748b', margin: 'sm', wrap: true }] : []),
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '12px',
          contents: [{
            type: 'button', style: 'primary', color: '#C72C41', height: 'sm',
            action: { type: 'message', label: '✅ ยืนยันสั่งซื้อ', text: 'ยืนยันสั่งซื้อรายการนี้' },
          }],
        },
      },
    }

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
      body: JSON.stringify({ to: lineUserId, messages: [flex] }),
    })
    if (!res.ok) {
      const err = await res.json()
      return Response.json({ error: err.message || 'LINE push failed' }, { status: 500 })
    }

    const summary = `[แอดมินส่งการ์ด] ${items.map(i => `${i.name} ×${i.qty}`).join(', ')} รวม ฿${fmt(total)}`
    // บันทึก 2 records: summary ที่อ่านได้ + JSON สำหรับสร้างบิลอัตโนมัติ
    await sbService.from('line_conversations').insert([
      { line_user_id: lineUserId, role: 'assistant', content: summary },
      { line_user_id: lineUserId, role: 'assistant', content: `[ORDER_DATA]${JSON.stringify({ items, note: note || '', total })}` },
    ])

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
