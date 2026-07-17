import { createClient } from '@supabase/supabase-js'
import { spawn } from 'child_process'
import { readFile, unlink, writeFile, stat } from 'fs/promises'
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

// ── Circular pre-roll buffer (module-level, persistent ใน PM2) ──
let _cbProc = null
let _cbUrl  = null
const CB_SEGS = 5
const CB_DUR  = 2
const cbPath  = i => join(tmpdir(), `cam_cb_${i}.ts`)

export function ensureCB(rtspUrl) {
  if (_cbProc?.exitCode === null && _cbUrl === rtspUrl) return
  if (_cbProc) { try { _cbProc.kill() } catch {} _cbProc = null }
  _cbUrl = rtspUrl
  _cbProc = spawn(FFMPEG, [
    '-rtsp_transport', 'tcp', '-i', rtspUrl,
    '-f', 'segment', '-segment_time', String(CB_DUR),
    '-segment_wrap', String(CB_SEGS), '-reset_timestamps', '1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-c:a', 'aac', '-y',
    join(tmpdir(), 'cam_cb_%d.ts'),
  ])
  _cbProc.stderr.on('data', () => {})
  _cbProc.on('close', () => { _cbProc = null })
  _cbProc.on('error', () => { _cbProc = null })
}

export async function getPreRoll(maxAgeSec = CB_SEGS * CB_DUR) {
  const now = Date.now()
  const segs = []
  for (let i = 0; i < CB_SEGS; i++) {
    const p = cbPath(i)
    try {
      const s = await stat(p)
      const age = (now - s.mtimeMs) / 1000
      if (age < CB_DUR) continue
      if (age > maxAgeSec + CB_DUR) continue
      segs.push({ p, age })
    } catch {}
  }
  segs.sort((a, b) => b.age - a.age)
  return segs.map(s => s.p)
}

function concatFfmpeg(listPath, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', outPath])
    proc.stderr.on('data', () => {})
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`concat exit ${code}`)))
    proc.on('error', reject)
  })
}

function recordRTSP(rtspUrl, durationSec, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      '-rtsp_transport', 'tcp', '-i', rtspUrl,
      '-t', String(durationSec),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-c:a', 'aac', '-movflags', '+faststart',
      '-y', outPath,
    ])
    const errBuf = []
    proc.stderr.on('data', d => errBuf.push(d))
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errBuf).toString().slice(-200)}`))
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

async function sendToTelegram(token, chatId, buffer, contentType, filename, caption, isVideo) {
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append(isVideo ? 'video' : 'photo', new Blob([buffer], { type: contentType }), filename)
  if (caption) form.append('caption', caption)
  const method = isVideo ? 'sendVideo' : 'sendPhoto'
  const res  = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) console.error(`[camera] Telegram ${method} error:`, json.description)
}

export async function recordAndNotify(s, caption) {
  const ts       = Date.now()
  const clipPath = join(tmpdir(), `drawer-${ts}.mp4`)
  const rtspUrl  = `rtsp://${encodeURIComponent(s.camera_username || 'admin')}:${encodeURIComponent(s.camera_password || '')}@${s.camera_ip}:554/cam/realmonitor?channel=1&subtype=1`

  ensureCB(rtspUrl)

  try {
    await recordRTSP(rtspUrl, 15, clipPath)

    const preRolls = await getPreRoll()
    let finalBuf

    if (preRolls.length > 0) {
      const listPath   = join(tmpdir(), `cat-${ts}.txt`)
      const mergedPath = join(tmpdir(), `merged-${ts}.mp4`)
      const fileList   = [...preRolls, clipPath].map(f => `file '${f}'`).join('\n')
      await writeFile(listPath, fileList + '\n')
      try {
        await concatFfmpeg(listPath, mergedPath)
        finalBuf = await readFile(mergedPath)
        await unlink(mergedPath).catch(() => {})
      } catch {
        finalBuf = await readFile(clipPath)
      }
      await unlink(listPath).catch(() => {})
    } else {
      finalBuf = await readFile(clipPath)
    }

    await unlink(clipPath).catch(() => {})

    const filename  = `${ts}.mp4`
    const publicUrl = await uploadToStorage(finalBuf, filename, 'video/mp4')
    await saveToDrawerLog('video_url', publicUrl)
    await sendToTelegram(s.telegram_bot_token, s.telegram_chat_id, finalBuf, 'video/mp4', filename, caption, true)
  } catch (e) {
    console.error('[camera] recordAndNotify error:', e.message)
    await unlink(clipPath).catch(() => {})
  }
}

// ── ดึง settings กล้อง + trigger recording (ใช้จาก server-side routes อื่น) ──
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
