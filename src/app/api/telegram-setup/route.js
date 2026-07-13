import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET → re-register webhook using saved token
export async function GET(req) {
  try {
    const { data } = await supabase.from('settings').select('key, value')
      .in('key', ['telegram_bot_token'])
    const token = data?.find(r => r.key === 'telegram_bot_token')?.value
    if (!token) return Response.json({ error: 'ยังไม่ได้บันทึก Bot Token' }, { status: 400 })

    // ใช้ Vercel production URL เสมอ (Telegram ต้องการ HTTPS)
    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    const { origin } = new URL(req.url)
    const baseUrl = vercelHost ? `https://${vercelHost}` : origin
    if (!baseUrl.startsWith('https://')) {
      return Response.json({ error: 'กรุณาเปิดหน้านี้ผ่าน Vercel URL (https://pos-shop-chi.vercel.app/admin) แล้วกดปุ่มอีกครั้ง' }, { status: 400 })
    }
    const wh = `${baseUrl}/api/telegram-webhook`
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
