import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function GET() {
  try {
    const { data, error: dbErr } = await supabase.from('settings').select('key, value')
      .in('key', ['telegram_bot_token', 'telegram_chat_id'])
    if (dbErr) return Response.json({ step: 'db', error: dbErr.message })

    const s = Object.fromEntries((data || []).map(r => [r.key, r.value]))
    if (!s.telegram_bot_token) return Response.json({ step: 'settings', error: 'ไม่พบ telegram_bot_token ใน database' })
    if (!s.telegram_chat_id)   return Response.json({ step: 'settings', error: 'ไม่พบ telegram_chat_id ใน database' })

    const res = await fetch(`https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: s.telegram_chat_id,
        text: '✅ ทดสอบการแจ้งเตือน — ระบบเชื่อมต่อ Telegram สำเร็จ',
        parse_mode: 'HTML',
      }),
    })
    const json = await res.json()
    if (!json.ok) return Response.json({ step: 'send', error: json.description, code: json.error_code })

    return Response.json({ ok: true, message: 'ส่งข้อความทดสอบสำเร็จ' })
  } catch (e) {
    return Response.json({ step: 'exception', error: e.message })
  }
}
