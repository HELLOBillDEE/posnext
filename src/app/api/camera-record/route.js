import { createClient } from '@supabase/supabase-js'
import { startShiftRecording, stopShiftRecording } from '@/lib/cameraRecord'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

async function getSettings(terminal_id) {
  const baseKeys = ['camera_ip', 'camera_username', 'camera_password', 'telegram_bot_token', 'telegram_chat_id']
  const allKeys  = terminal_id
    ? [...baseKeys, `camera_ip_${terminal_id}`, `camera_username_${terminal_id}`, `camera_password_${terminal_id}`]
    : baseKeys
  const { data } = await supabase.from('settings').select('key, value').in('key', allKeys)
  if (!data) return null
  const m = Object.fromEntries(data.map(r => [r.key, r.value]))
  if (terminal_id) {
    if (m[`camera_ip_${terminal_id}`])       m.camera_ip       = m[`camera_ip_${terminal_id}`]
    if (m[`camera_username_${terminal_id}`]) m.camera_username = m[`camera_username_${terminal_id}`]
    if (m[`camera_password_${terminal_id}`]) m.camera_password = m[`camera_password_${terminal_id}`]
  }
  return m
}

export async function POST(req) {
  try {
    const { action, sessionId, caption, terminal_id } = await req.json()

    const s = await getSettings(terminal_id || '')
    if (!s?.camera_ip) return Response.json({ ok: false, reason: 'camera not configured' })

    if (action === 'start') {
      const id = await startShiftRecording(s)
      return Response.json({ ok: true, sessionId: id })
    }

    if (action === 'stop') {
      if (!sessionId) return Response.json({ ok: false, reason: 'no sessionId' }, { status: 400 })
      stopShiftRecording(s, sessionId, caption || null)
        .catch(e => console.error('[camera-record stop]', e.message))
      return Response.json({ ok: true })
    }

    return Response.json({ ok: false, reason: 'unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
