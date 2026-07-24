import { createClient } from '@supabase/supabase-js'
import { recordAndNotify } from '@/lib/cameraRecord'
import { execFile } from 'child_process'
import { readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)
const supabaseStorage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function captureRTSP(cameraIp, username, password) {
  const rtspUrl = `rtsp://${username}:${password}@${cameraIp}/cam/realmonitor?channel=1&subtype=0`
  const outPath = join(tmpdir(), `snap_${Date.now()}.jpg`)
  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-rtsp_transport', 'tcp', '-timeout', '10000000',
      '-i', rtspUrl,
      '-frames:v', '1', '-q:v', '2', '-update', '1', outPath,
    ], { timeout: 15000 }, (err) => {
      if (err) reject(err); else resolve()
    })
  })
  const buf = await readFile(outPath)
  await unlink(outPath).catch(() => {})
  return buf
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
      const imgBuffer   = await captureRTSP(s.camera_ip, s.camera_username || 'admin', s.camera_password || '')
      const filename    = `${Date.now()}.jpg`
      const publicUrl   = await uploadSnapshot(imgBuffer, filename, 'image/jpeg').catch(() => null)
      if (publicUrl) await saveSnapshotToLog(publicUrl)
      await sendPhotoToTelegram(s.telegram_bot_token, s.telegram_chat_id, imgBuffer, 'image/jpeg', filename, caption)
      return Response.json({ ok: true, mode: 'snapshot' })
    }

    recordAndNotify(s, caption).catch(e => console.error('[camera] bg error:', e.message))
    return Response.json({ ok: true, mode: 'video', status: 'recording' })

  } catch (e) {
    console.error('[camera-snapshot]', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
