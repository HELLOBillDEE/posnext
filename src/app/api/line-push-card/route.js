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
    const { lineUserId, items, note } = await req.json()
    if (!lineUserId || !items?.length)
      return Response.json({ error: 'missing data' }, { status: 400 })

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
    await sbService.from('line_conversations').insert({ line_user_id: lineUserId, role: 'assistant', content: summary })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
