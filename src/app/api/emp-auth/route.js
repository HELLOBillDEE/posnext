import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

async function sendTelegram(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
  } catch {}
}

export async function POST(req) {
  try {
    const { pin } = await req.json()
    if (!pin) return Response.json({ error: 'ต้องระบุ PIN' }, { status: 400 })

    const { data: employees, error } = await supa
      .from('employees')
      .select('id, name, position, nickname, pin, can_login')
      .eq('active', true)

    if (error) return Response.json({ error: 'ระบบขัดข้อง' }, { status: 500 })

    const emp = employees?.find(e => e.pin === String(pin) && e.can_login !== false)
    if (!emp) return Response.json({ error: 'PIN ไม่ถูกต้อง' }, { status: 401 })

    const { data: settings } = await supa.from('settings').select('key,value')
    const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]))

    if (cfg.telegram_bot_token && cfg.telegram_chat_id) {
      const now = new Date().toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
      await sendTelegram(
        cfg.telegram_bot_token,
        cfg.telegram_chat_id,
        `👷 <b>Portal พนักงาน — เข้าสู่ระบบ</b>\n👤 ${emp.name}${emp.position ? ` (${emp.position})` : ''}\n🕐 ${now}`
      )
    }

    return Response.json({ id: emp.id, name: emp.name, position: emp.position || '', nickname: emp.nickname || '' })
  } catch {
    return Response.json({ error: 'ระบบขัดข้อง' }, { status: 500 })
  }
}
