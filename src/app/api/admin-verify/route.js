import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const attempts = new Map() // ip → { count, resetAt }

export async function POST(req) {
  // Rate limit: max 5 attempts per IP per 5 minutes
  // ใช้ x-real-ip (Vercel inject ให้, client แก้ไม่ได้) แทน x-forwarded-for
  const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || 'unknown'
  const now = Date.now()
  const rec = attempts.get(ip) || { count: 0, resetAt: now + 5 * 60 * 1000 }
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 5 * 60 * 1000 }
  if (rec.count >= 5) {
    const wait = Math.ceil((rec.resetAt - now) / 1000)
    return Response.json({ ok: false, error: `ลองใหม่ในอีก ${wait} วินาที` }, { status: 429 })
  }

  try {
    const { pin } = await req.json()
    if (!pin) return Response.json({ ok: false }, { status: 400 })

    const { data } = await supabase.from('settings').select('value').eq('key', 'admin_pin').maybeSingle()
    const storedPin = data?.value

    if (!storedPin || storedPin !== String(pin).trim()) {
      rec.count++
      attempts.set(ip, rec)
      return Response.json({ ok: false }, { status: 401 })
    }

    // correct — clear attempts
    attempts.delete(ip)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
