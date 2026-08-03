import { createClient } from '@supabase/supabase-js'
import { recordAndNotify } from '@/lib/cameraRecord'
import { execFile } from 'child_process'
import { readFile, unlink, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

export const runtime = 'nodejs'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const SAVE_DIR = process.env.SNAPSHOT_DIR || join(process.cwd(), 'drawer-snapshots')
mkdir(SAVE_DIR, { recursive: true }).catch(() => {})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

async function captureRTSP(cameraIp, username, password) {
  const rtspUrl = `rtsp://${username}:${password}@${cameraIp}/cam/realmonitor?channel=1&subtype=0`
  const tmpPath = join(SAVE_DIR, `snap_tmp_${Date.now()}.jpg`)
  await new Promise((resolve, reject) => {
    execFile(FFMPEG, [
      '-y', '-rtsp_transport', 'tcp', '-timeout', '10000000',
      '-i', rtspUrl,
      '-vf', 'scale=640:-2',
      '-frames:v', '1', '-q:v', '5', '-update', '1', tmpPath,
    ], { timeout: 20000, windowsHide: true }, (err) => {
      const code = err?.code
      const ignored = !code || code === 3221225786 || code === 255
      if (err && !ignored) reject(err); else resolve()
    })
  })
  const buf = await readFile(tmpPath)
  await unlink(tmpPath).catch(() => {})
  return buf
}

async function saveSnapshotLocally(buffer, filename) {
  const filePath = join(SAVE_DIR, filename)
  await writeFile(filePath, buffer)
  return filePath
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
    const body        = await req.json().catch(() => ({}))
    const caption     = body.caption || ''
    const mode        = body.mode || 'video'
    const terminal_id = body.terminal_id || ''
    const duration    = Math.min(Math.max(parseInt(body.duration) || 15, 1), 120)

    const keysToFetch = ['camera_ip', 'camera_username', 'camera_password', 'telegram_bot_token', 'telegram_chat_id']
    if (terminal_id) keysToFetch.push(`camera_ip_${terminal_id}`, `camera_username_${terminal_id}`, `camera_password_${terminal_id}`)

    const { data } = await supabase.from('settings').select('key, value').in('key', keysToFetch)
    if (!data) return Response.json({ ok: false, reason: 'no settings' })
    const s = Object.fromEntries(data.map(r => [r.key, r.value]))

    const cameraIp       = (terminal_id && s[`camera_ip_${terminal_id}`]) || s.camera_ip
    const cameraUsername = (terminal_id && s[`camera_username_${terminal_id}`]) || s.camera_username
    const cameraPassword = (terminal_id && s[`camera_password_${terminal_id}`]) || s.camera_password

    if (!cameraIp)             return Response.json({ ok: false, reason: 'camera not configured' })
    if (!s.telegram_bot_token) return Response.json({ ok: false, reason: 'no telegram token' })
    if (!s.telegram_chat_id)   return Response.json({ ok: false, reason: 'no telegram chat_id' })

    if (mode === 'snapshot') {
      const imgBuffer = await captureRTSP(cameraIp, cameraUsername || 'admin', cameraPassword || '')
      const filename  = `${Date.now()}.jpg`
      await saveSnapshotLocally(imgBuffer, filename).catch(() => {})
      await sendPhotoToTelegram(s.telegram_bot_token, s.telegram_chat_id, imgBuffer, 'image/jpeg', filename, caption)
      return Response.json({ ok: true, mode: 'snapshot' })
    }

    const resolvedSettings = { ...s, camera_ip: cameraIp, camera_username: cameraUsername, camera_password: cameraPassword }
    recordAndNotify(resolvedSettings, caption, duration).catch(e => console.error('[camera] bg error:', e.message))
    return Response.json({ ok: true, mode: 'video', status: 'recording' })

  } catch (e) {
    console.error('[camera-snapshot]', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
