import { createClient } from '@supabase/supabase-js'
import { getLineSettings } from '@/lib/lineStaff'

export const dynamic = 'force-dynamic'

const sbService = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { imageUrl, text } = await req.json()
    if (!text && !imageUrl) return Response.json({ error: 'ต้องมีรูปหรือข้อความ' }, { status: 400 })

    const lineCfg = await getLineSettings()
    if (!lineCfg?.line_channel_token) return Response.json({ error: 'ไม่มี LINE token' }, { status: 500 })

    // ดึง userId ทั้งหมดที่เคยคุย
    const { data: rows } = await sbService
      .from('line_conversations')
      .select('line_user_id')
    const userIds = [...new Set((rows || []).map(r => r.line_user_id))].filter(Boolean)
    if (!userIds.length) return Response.json({ error: 'ไม่มีลูกค้า LINE' }, { status: 400 })

    const messages = []
    if (imageUrl) messages.push({ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl })
    if (text)     messages.push({ type: 'text', text })

    // LINE multicast สูงสุด 500 user ต่อ call
    const chunks = []
    for (let i = 0; i < userIds.length; i += 500) chunks.push(userIds.slice(i, i + 500))

    let sent = 0
    for (const chunk of chunks) {
      const res = await fetch('https://api.line.me/v2/bot/message/multicast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineCfg.line_channel_token}` },
        body: JSON.stringify({ to: chunk, messages }),
      })
      if (res.ok) sent += chunk.length
      else { const e = await res.json(); console.error('[broadcast]', e) }
    }

    return Response.json({ ok: true, sent, total: userIds.length })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
