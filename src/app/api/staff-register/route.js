import { createClient } from '@supabase/supabase-js'
import { getTgSettings } from '@/lib/telegramStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { name, nickname, phone, password, pin } = await req.json()

    if (!name?.trim())      return Response.json({ error: 'กรุณากรอกชื่อ' }, { status: 400 })
    if (!phone?.trim())     return Response.json({ error: 'กรุณากรอกเบอร์โทรศัพท์' }, { status: 400 })
    if (!password?.trim())  return Response.json({ error: 'กรุณาตั้งรหัสผ่าน' }, { status: 400 })
    if (!pin || pin.length < 4) return Response.json({ error: 'PIN ต้องมีอย่างน้อย 4 หลัก' }, { status: 400 })
    if (!/^\d+$/.test(pin)) return Response.json({ error: 'PIN ต้องเป็นตัวเลขเท่านั้น' }, { status: 400 })

    // เบอร์โทรซ้ำ
    const { data: dupPhone } = await supabase
      .from('employees').select('id').eq('phone', phone.trim()).maybeSingle()
    if (dupPhone) return Response.json({ error: 'เบอร์โทรนี้ถูกใช้แล้ว' }, { status: 409 })

    const { data: employee, error } = await supabase
      .from('employees')
      .insert({
        name: name.trim(),
        nickname: nickname?.trim() || null,
        phone: phone.trim(),
        password: password.trim(),
        pin,
        active: true,
      })
      .select('id, name, nickname, phone')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })

    notifyNewStaff(employee).catch(() => {})

    return Response.json({ employee })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

async function notifyNewStaff(emp) {
  const cfg = await getTgSettings()
  if (!cfg) return
  const text = [
    `🆕 <b>พนักงานสมัครใหม่</b>`,
    `👤 ${emp.name}${emp.nickname ? ` (${emp.nickname})` : ''}`,
    `📱 ${emp.phone}`,
  ].join('\n')
  await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text, parse_mode: 'HTML' }),
  })
}
