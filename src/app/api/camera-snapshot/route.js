import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { recordAndNotify } from '@/lib/cameraRecord'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)
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
    return fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }, ...opts })
  }
  if (!/^digest /i.test(wwwAuth)) throw new Error(`camera auth: ${wwwAuth.slice(0, 40)}`)

  const p = k => (wwwAuth.match(new RegExp(`${k}="([^"]*)"`, 'i'))?.[1] ?? '')
  const realm = p('realm'), nonce = p('nonce')
  const qop   = p('qop') || (wwwAuth.toLowerCase().includes('qop=') ? 'auth' : '')
  const uri   = new URL(url).pathname + new URL(url).search
  const ha1   = createHash('md5').update(`${username}:${realm}:${password}`).digest('hex')
  const ha2   = createHash('md5').update(`GET:${uri}`).digest('hex')

  let authHeader
  if (qop) {
    const nc = '00000001', cnonce = createHash('md5').update(String(Date.now())).digest('hex').slice(0, 8)
    const resp = createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex')
    authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${resp}"`
  } else {
    const resp = createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex')
    authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}"`
  }
  return fetch(url, { headers: { Authorization: authHeader }, ...opts })
}

async function uploadSnapshot(buffer, filename, contentType) {
  const { error } = await supabaseStorage.storage
    .from('drawer-snapshots')
    .upload(filename, buffer, { contentType, upsert: false })
  if (error) throw error
  const { data } = supabaseStorage.storage.from('drawer-snapshots').getPublicUrl(filename)
  return data.publicUrl
}

async function saveSnapshotToLog(url) {
  const { data: log } = await supabase.from('drawer_logs')
    .select('id').order('opened_at', { ascending: false }).limit(1).maybeSingle()
  if (log) await supabase.from('drawer_logs').update({ snapshot_url: url }).eq('id', log.id)
}

async function sendPhotoToTelegram(token, chatId, buffer, contentType, filename, caption) {
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('photo', new Blob([buffer], { type: contentType }), filename)
  if (caption) form.append('caption', caption)
  const res  = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) console.error('[camera] Telegram sendPhoto error:', json.description)
}

export async function POST(req) {
  try {
    const body    = await req.json().catch(() => ({}))
    const caption = body.caption || ''
    const mode    = body.mode || 'video'

    const { data } = await supabase.from('settings').select('key, value')
      .in('key', ['camera_ip', 'camera_username', 'camera_password', 'telegram_bot_token', 'telegram_chat_id'])
    if (!data) return Response.json({ ok: false, reason: 'no settings' })
    const s = Object.fromEntries(data.map(r => [r.key, r.value]))

    if (!s.camera_ip)          return Response.json({ ok: false, reason: 'camera not configured' })
    if (!s.telegram_bot_token) return Response.json({ ok: false, reason: 'no telegram token' })
    if (!s.telegram_chat_id)   return Response.json({ ok: false, reason: 'no telegram chat_id' })

    if (mode === 'snapshot') {
      const imgRes = await fetchWithDigestAuth(
        `http://${s.camera_ip}/cgi-bin/snapshot.cgi?channel=1`,
        s.camera_username || 'admin', s.camera_password || ''
      )
      if (!imgRes.ok) return Response.json({ ok: false, reason: `camera ${imgRes.status}` })
      const imgBuffer   = await imgRes.arrayBuffer()
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
      const filename    = `${Date.now()}.jpg`
      const publicUrl   = await uploadSnapshot(imgBuffer, filename, contentType).catch(() => null)
      if (publicUrl) await saveSnapshotToLog(publicUrl)
      await sendPhotoToTelegram(s.telegram_bot_token, s.telegram_chat_id, imgBuffer, contentType, filename, caption)
      return Response.json({ ok: true, mode: 'snapshot' })
    }

    recordAndNotify(s, caption).catch(e => console.error('[camera] bg error:', e.message))
    return Response.json({ ok: true, mode: 'video', status: 'recording' })

  } catch (e) {
    console.error('[camera-snapshot]', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
