import { createClient } from '@supabase/supabase-js'
import { spawn } from 'child_process'
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

const FFMPEG = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg'

function buildCameraUrl(s) {
  const ip   = s.camera_ip
  const user = encodeURIComponent(s.camera_username || 'admin')
  const pass = encodeURIComponent(s.camera_password || '')
  // HTTP MJPEG — Dahua format (RTSP disabled บางรุ่น)
  return `http://${user}:${pass}@${ip}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1`
}

function recordCamera(url, durationSec, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      '-f', 'mjpeg', '-i', url,
      '-t', String(durationSec),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-movflags', '+faststart',
      '-y', outPath,
    ])
    const errBuf = []
    proc.stderr.on('data', d => errBuf.push(d))
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errBuf).toString().slice(-300)}`))
    })
    proc.on('error', reject)
  })
}

async function uploadToStorage(buffer, filename, contentType) {
  const { error } = await supabaseStorage.storage
    .from('drawer-snapshots')
    .upload(filename, buffer, { contentType, upsert: false })
  if (error) throw error
  const { data } = supabaseStorage.storage.from('drawer-snapshots').getPublicUrl(filename)
  return data.publicUrl
}

async function saveToDrawerLog(field, url) {
  const { data: log } = await supabase.from('drawer_logs')
    .select('id').order('opened_at', { ascending: false }).limit(1).maybeSingle()
  if (log) await supabase.from('drawer_logs').update({ [field]: url }).eq('id', log.id)
}

async function sendToTelegram(token, chatId, buffer, caption) {
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('video', new Blob([buffer], { type: 'video/mp4' }), 'clip.mp4')
  if (caption) form.append('caption', caption)
  const res  = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) console.error('[camera] Telegram sendVideo error:', json.description)
}

export async function recordAndNotify(s, caption) {
  const ts      = Date.now()
  const outPath = join(tmpdir(), `drawer-${ts}.mp4`)
  const url     = buildCameraUrl(s)

  try {
    await recordCamera(url, 15, outPath)
    const buf       = await readFile(outPath)
    const filename  = `${ts}.mp4`
    const publicUrl = await uploadToStorage(buf, filename, 'video/mp4').catch(() => null)
    if (publicUrl) await saveToDrawerLog('video_url', publicUrl)
    await sendToTelegram(s.telegram_bot_token, s.telegram_chat_id, buf, caption)
  } catch (e) {
    console.error('[camera] recordAndNotify error:', e.message)
  } finally {
    await unlink(outPath).catch(() => {})
  }
}

export async function triggerDrawerVideo(caption) {
  try {
    const { data } = await supabase.from('settings').select('key, value')
      .in('key', ['camera_ip', 'camera_username', 'camera_password', 'telegram_bot_token', 'telegram_chat_id'])
    if (!data) return
    const s = Object.fromEntries(data.map(r => [r.key, r.value]))
    if (!s.camera_ip || !s.telegram_bot_token || !s.telegram_chat_id) return
    recordAndNotify(s, caption).catch(e => console.error('[camera] bg error:', e.message))
  } catch (e) {
    console.error('[camera] triggerDrawerVideo error:', e.message)
  }
}
