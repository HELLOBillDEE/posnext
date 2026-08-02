import { createClient } from '@supabase/supabase-js'
import { spawn } from 'child_process'
import { readFile, unlink, stat } from 'fs/promises'
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

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

// Active shift recordings: sessionId -> { proc, outPath }
const activeRecordings = new Map()

function buildCameraUrl(s) {
  const ip   = s.camera_ip
  const user = encodeURIComponent(s.camera_username || 'admin')
  const pass = encodeURIComponent(s.camera_password || '')
  return `rtsp://${user}:${pass}@${ip}/cam/realmonitor?channel=1&subtype=0`
}

function recordCamera(url, durationSec, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      '-rtsp_transport', 'tcp', '-timeout', '20000000',
      '-i', url,
      '-t', String(durationSec),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-movflags', '+faststart',
      '-y', outPath,
    ], { windowsHide: true })
    const errBuf = []
    proc.stderr.on('data', d => errBuf.push(d))
    proc.on('close', async code => {
      if (code === 0) { resolve(); return }
      // Windows: ffmpeg exits with non-zero (e.g. 3221225786) even on success
      // ถ้าไฟล์ใหญ่พอ (>50KB) แปลว่าบันทึกได้จริง
      try {
        const s = await stat(outPath)
        const minBytes = 50 * 1024 // 50KB — ไฟล์ที่สั้นเกินไปถือว่า fail
        if (s.size >= minBytes) { resolve(); return }
      } catch {}
      reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errBuf).toString().slice(-300)}`))
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
  const ctrl = new AbortController()
  const tid  = setTimeout(() => ctrl.abort(), 90_000) // 90s timeout
  try {
    const res  = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: form, signal: ctrl.signal })
    const json = await res.json()
    if (!json.ok) console.error('[camera] Telegram sendVideo error:', json.description)
  } finally {
    clearTimeout(tid)
  }
}

export async function recordAndNotify(s, caption, duration = 15) {
  const ts      = Date.now()
  const outPath = join(tmpdir(), `drawer-${ts}.mp4`)
  const url     = buildCameraUrl(s)

  try {
    await recordCamera(url, duration, outPath)
    const buf       = await readFile(outPath)
    const filename  = `${ts}.mp4`
    const publicUrl = await uploadToStorage(buf, filename, 'video/mp4').catch(() => null)
    if (publicUrl) await saveToDrawerLog('video_url', publicUrl)
    await sendToTelegram(s.telegram_bot_token, s.telegram_chat_id, buf, caption)
  } catch (e) {
    console.error('[camera] recordAndNotify error:', e.message)
    if (s.telegram_bot_token && s.telegram_chat_id) {
      fetch(`https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: s.telegram_chat_id, text: `⚠️ กล้องบันทึกไม่ได้: ${e.message.slice(0, 300)}` }),
      }).catch(() => {})
    }
  } finally {
    await unlink(outPath).catch(() => {})
  }
}

export async function startShiftRecording(s) {
  const sessionId = `shift-${Date.now()}`
  const outPath   = join(tmpdir(), `${sessionId}.mp4`)
  const url       = buildCameraUrl(s)

  const proc = spawn(FFMPEG, [
    '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-i', url,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-movflags', '+faststart',
    '-y', outPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

  proc.on('error', e => console.error('[camera] startShiftRecording spawn error:', e.message))
  activeRecordings.set(sessionId, { proc, outPath })
  return sessionId
}

export async function stopShiftRecording(s, sessionId, caption) {
  const rec = activeRecordings.get(sessionId)
  if (!rec) return
  activeRecordings.delete(sessionId)

  const { proc, outPath } = rec

  await new Promise(resolve => {
    proc.on('close', resolve)
    try { proc.stdin.write('q'); proc.stdin.end() } catch {}
    setTimeout(() => { try { proc.kill('SIGTERM') } catch {} resolve() }, 6000)
  })

  if (!caption) { await unlink(outPath).catch(() => {}); return }

  try {
    const buf       = await readFile(outPath)
    const filename  = `${sessionId}.mp4`
    const publicUrl = await uploadToStorage(buf, filename, 'video/mp4').catch(() => null)
    if (publicUrl) await saveToDrawerLog('video_url', publicUrl)
    await sendToTelegram(s.telegram_bot_token, s.telegram_chat_id, buf, caption)
  } catch (e) {
    console.error('[camera] stopShiftRecording error:', e.message)
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
