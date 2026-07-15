import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
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

const FFMPEG = '/opt/homebrew/bin/ffmpeg'

// ── Circular pre-roll buffer (module-level, persistent ใน PM2) ──
let _cbProc = null
let _cbUrl  = null
const CB_SEGS = 5   // 5 segments × 2 วิ = บัฟเฟอร์ 10 วินาที
const CB_DUR  = 2
const cbPath  = i => join(tmpdir(), `cam_cb_${i}.ts`)

function ensureCB(rtspUrl) {
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

async function getPreRoll(targetSec = 5) {
  const now = Date.now()
  let best = null, bestDiff = Infinity
  for (let i = 0; i < CB_SEGS; i++) {
    const p = cbPath(i)
    try {
      const s = await stat(p)
      const age = (now - s.mtimeMs) / 1000
      if (age < CB_DUR) continue  // ยังกำลังเขียนอยู่
      const diff = Math.abs(age - targetSec)
      if (diff < bestDiff) { best = p; bestDiff = diff }
    } catch {}
  }
  return bestDiff < CB_DUR * 3 ? best : null
}

function concatFfmpeg(listPath, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-f','concat','-safe','0','-i',listPath,'-c','copy','-y',outPath])
    proc.stderr.on('data', () => {})
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`concat exit ${code}`)))
    proc.on('error', reject)
  })
}

// ── Digest Auth สำหรับ HTTP snapshot ──
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

// ── บันทึกวิดีโอจาก RTSP ด้วย ffmpeg ──
function recordRTSP(rtspUrl, durationSec, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
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

// ── อัปโหลดไฟล์ไป Supabase Storage ──
async function uploadToStorage(buffer, filename, contentType) {
  const { error } = await supabaseStorage.storage
    .from('drawer-snapshots')
    .upload(filename, buffer, { contentType, upsert: false })
  if (error) throw error
  const { data } = supabaseStorage.storage.from('drawer-snapshots').getPublicUrl(filename)
  return data.publicUrl
}

// ── บันทึก URL ลง drawer_logs ล่าสุด ──
async function saveToDrawerLog(field, url) {
  const { data: log } = await supabase.from('drawer_logs')
    .select('id').order('opened_at', { ascending: false }).limit(1).maybeSingle()
  if (log) await supabase.from('drawer_logs').update({ [field]: url }).eq('id', log.id)
}

// ── ส่ง Telegram ──
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

// ── Background: บันทึก + pre-roll + อัปโหลด + Telegram ──
async function recordAndNotify(s, caption) {
  const ts       = Date.now()
  const clipPath = join(tmpdir(), `drawer-${ts}.mp4`)
  const rtspUrl  = `rtsp://${encodeURIComponent(s.camera_username || 'admin')}:${encodeURIComponent(s.camera_password || '')}@${s.camera_ip}:554/cam/realmonitor?channel=1&subtype=1`

  ensureCB(rtspUrl)  // ให้ buffer วิ่งต่อเนื่องสำหรับครั้งถัดไป

  try {
    await recordRTSP(rtspUrl, 15, clipPath)

    // หา pre-roll segment ที่อายุ ~5 วิ
    const preRoll = await getPreRoll(5)
    let finalBuf

    if (preRoll) {
      const listPath   = join(tmpdir(), `cat-${ts}.txt`)
      const mergedPath = join(tmpdir(), `merged-${ts}.mp4`)
      await writeFile(listPath, `file '${preRoll}'\nfile '${clipPath}'\n`)
      try {
        await concatFfmpeg(listPath, mergedPath)
        finalBuf = await readFile(mergedPath)
        await unlink(mergedPath).catch(() => {})
      } catch {
        finalBuf = await readFile(clipPath)  // fallback ถ้า concat ไม่ได้
      }
      await unlink(listPath).catch(() => {})
    } else {
      finalBuf = await readFile(clipPath)  // buffer ยังไม่พร้อม (ครั้งแรก)
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

export async function POST(req) {
  try {
    const body    = await req.json().catch(() => ({}))
    const caption = body.caption || ''
    const mode    = body.mode || 'video' // 'video' | 'snapshot'

    const { data } = await supabase.from('settings').select('key, value')
      .in('key', ['camera_ip', 'camera_username', 'camera_password', 'telegram_bot_token', 'telegram_chat_id'])
    if (!data) return Response.json({ ok: false, reason: 'no settings' })
    const s = Object.fromEntries(data.map(r => [r.key, r.value]))

    if (!s.camera_ip)          return Response.json({ ok: false, reason: 'camera not configured' })
    if (!s.telegram_bot_token) return Response.json({ ok: false, reason: 'no telegram token' })
    if (!s.telegram_chat_id)   return Response.json({ ok: false, reason: 'no telegram chat_id' })

    // เริ่ม circular buffer ไว้ล่วงหน้า (ถ้ายังไม่ได้รัน)
    const rtspForCB = `rtsp://${encodeURIComponent(s.camera_username||'admin')}:${encodeURIComponent(s.camera_password||'')}@${s.camera_ip}:554/cam/realmonitor?channel=1&subtype=1`
    ensureCB(rtspForCB)

    if (mode === 'snapshot') {
      // ── Snapshot (ปุ่มทดสอบ) ──
      const imgRes = await fetchWithDigestAuth(
        `http://${s.camera_ip}/cgi-bin/snapshot.cgi?channel=1`,
        s.camera_username || 'admin', s.camera_password || ''
      )
      if (!imgRes.ok) return Response.json({ ok: false, reason: `camera ${imgRes.status}` })

      const imgBuffer = await imgRes.arrayBuffer()
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg'

      const filename = `${Date.now()}.jpg`
      const publicUrl = await uploadToStorage(imgBuffer, filename, contentType).catch(() => null)
      if (publicUrl) await saveToDrawerLog('snapshot_url', publicUrl)
      await sendToTelegram(s.telegram_bot_token, s.telegram_chat_id, imgBuffer, contentType, filename, caption, false)

      return Response.json({ ok: true, mode: 'snapshot' })
    }

    // ── Video (drawer open) — fire-and-forget ──
    recordAndNotify(s, caption).catch(e => console.error('[camera] bg error:', e.message))
    return Response.json({ ok: true, mode: 'video', status: 'recording' })

  } catch (e) {
    console.error('[camera-snapshot]', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
