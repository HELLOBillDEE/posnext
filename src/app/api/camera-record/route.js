import { createClient } from '@supabase/supabase-js'
import { startShiftRecording, stopShiftRecording } from '@/lib/cameraRecord'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

async function getSettings() {
  const { data } = await supabase.from('settings').select('key, value')
    .in('key', ['camera_ip', 'camera_username', 'camera_password', 'telegram_bot_token', 'telegram_chat_id'])
  if (!data) return null
  return Object.fromEntries(data.map(r => [r.key, r.value]))
}

export async function POST(req) {
  try {
    const { action, sessionId, caption } = await req.json()

    const s = await getSettings()
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
