import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// POST { token, webhookUrl } → บันทึก token + ลงทะเบียน webhook กับ Telegram
export async function POST(req) {
  try {
    const { token, webhookUrl } = await req.json()
    if (!token) return Response.json({ error: 'กรุณาใส่ Bot Token' }, { status: 400 })

    // บันทึก token
    await supabase.from('settings').upsert(
      { key: 'telegram_bot_token', value: token },
      { onConflict: 'key' }
    )

    // ลงทะเบียน webhook
    const wh = webhookUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/telegram-webhook`
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: wh, allowed_updates: ['message', 'callback_query'] }),
    })
    const json = await res.json()
    if (!json.ok) return Response.json({ error: json.description }, { status: 400 })

    return Response.json({ ok: true, webhook: wh })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
