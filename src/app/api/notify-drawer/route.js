import { requireAuth, unauthorizedResponse } from '@/lib/authApi'
import { createClient } from '@supabase/supabase-js'

export async function POST(req) {
  if (!await requireAuth(req)) return unauthorizedResponse()
  try {
    const { employeeName, note } = await req.json()

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

    const now = new Date().toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })

    const text = [
      `🔓 เปิดลิ้นชักเงิน`,
      `🏪 ${settings.shop_name || 'ร้านค้า'}`,
      `👤 ${employeeName || 'ไม่ระบุ'}`,
      `🕐 ${now}`,
      note ? `📝 ${note}` : null,
    ].filter(Boolean).join('\n')

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
    })

    if (!res.ok) {
      const err = await res.json()
      return Response.json({ error: err.message || 'LINE API error' }, { status: 502 })
    }

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
