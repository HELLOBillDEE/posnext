import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// Supabase client ที่ชี้ไป storage schema (default public)
const supabaseStorage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fetchWithDigestAuth(url, username, password) {
  const opts = { signal: AbortSignal.timeout(8000) }

  const res1 = await fetch(url, opts)
  if (res1.ok) return res1

  const wwwAuth = res1.headers.get('WWW-Authenticate') || ''

  if (/^basic /i.test(wwwAuth)) {
    const cred = Buffer.from(`${username}:${password}`).toString('base64')
    return fetch(url, { headers: { Authorization: `Basic ${cred}` }, ...opts })
  }

  if (!/^digest /i.test(wwwAuth)) throw new Error(`camera auth unsupported: ${wwwAuth.slice(0, 40)}`)

  const p = key => (wwwAuth.match(new RegExp(`${key}="([^"]*)"`, 'i'))?.[1] ?? '')
  const realm = p('realm'), nonce = p('nonce')
  const qop   = p('qop') || (wwwAuth.toLowerCase().includes('qop=') ? 'auth' : '')

  const urlObj = new URL(url)
  const uri = urlObj.pathname + urlObj.search

  const ha1 = createHash('md5').update(`${username}:${realm}:${password}`).digest('hex')
  const ha2 = createHash('md5').update(`GET:${uri}`).digest('hex')

  let authHeader
  if (qop) {
    const nc     = '00000001'
    const cnonce = createHash('md5').update(String(Date.now())).digest('hex').slice(0, 8)
    const resp   = createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex')
    authHeader   = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${resp}"`
  } else {
    const resp   = createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex')
    authHeader   = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}"`
  }

  return fetch(url, { headers: { Authorization: authHeader }, ...opts })
}

export async function POST(req) {
  try {
    const body    = await req.json().catch(() => ({}))
    const caption = body.caption || ''

    const { data } = await supabase.from('settings').select('key, value')
      .in('key', ['camera_ip', 'camera_username', 'camera_password', 'telegram_bot_token', 'telegram_chat_id'])

    if (!data) return Response.json({ ok: false, reason: 'no settings' })
    const s = Object.fromEntries(data.map(r => [r.key, r.value]))

    if (!s.camera_ip)          return Response.json({ ok: false, reason: 'camera not configured' })
    if (!s.telegram_bot_token) return Response.json({ ok: false, reason: 'no telegram token' })
    if (!s.telegram_chat_id)   return Response.json({ ok: false, reason: 'no telegram chat_id' })

    const snapshotUrl = `http://${s.camera_ip}/cgi-bin/snapshot.cgi?channel=1`
    const imgRes = await fetchWithDigestAuth(snapshotUrl, s.camera_username || 'admin', s.camera_password || '')

    if (!imgRes.ok) return Response.json({ ok: false, reason: `camera returned ${imgRes.status}` })

    const imgBuffer   = await imgRes.arrayBuffer()
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'

    // ── 1. อัปโหลดรูปไป Supabase Storage ──
    const filename  = `${Date.now()}.jpg`
    const { error: uploadErr } = await supabaseStorage.storage
      .from('drawer-snapshots')
      .upload(filename, imgBuffer, { contentType, upsert: false })

    let snapshotPublicUrl = null
    if (!uploadErr) {
      const { data: urlData } = supabaseStorage.storage
        .from('drawer-snapshots')
        .getPublicUrl(filename)
      snapshotPublicUrl = urlData?.publicUrl || null
    } else {
      console.error('[camera-snapshot] storage upload error:', uploadErr.message)
    }

    // ── 2. บันทึก URL ลง drawer_logs ล่าสุด ──
    if (snapshotPublicUrl) {
      const { data: latestLog } = await supabase
        .from('drawer_logs')
        .select('id')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestLog) {
        await supabase
          .from('drawer_logs')
          .update({ snapshot_url: snapshotPublicUrl })
          .eq('id', latestLog.id)
      }
    }

    // ── 3. ส่งรูปไป Telegram ──
    const form = new FormData()
    form.append('chat_id', s.telegram_chat_id)
    form.append('photo', new Blob([imgBuffer], { type: contentType }), 'drawer.jpg')
    if (caption) form.append('caption', caption)

    const tgRes  = await fetch(`https://api.telegram.org/bot${s.telegram_bot_token}/sendPhoto`, {
      method: 'POST', body: form,
    })
    const tgJson = await tgRes.json()
    if (!tgJson.ok) console.error('[camera-snapshot] Telegram error:', tgJson.description)

    return Response.json({ ok: true, snapshot_url: snapshotPublicUrl })
  } catch (e) {
    console.error('[camera-snapshot]', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
