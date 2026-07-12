import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET — คืนรายชื่อพนักงานที่ active (ไม่ส่ง PIN)
export async function GET() {
  const { data } = await supabase
    .from('employees')
    .select('id, name, nickname')
    .eq('active', true)
    .order('name')
  return Response.json(data || [])
}

export async function POST(req) {
  try {
    const { employee_id, pin, password, verifyOnly } = await req.json()
    if (!pin && !password) return Response.json({ error: 'กรุณากรอก PIN หรือรหัสผ่าน' }, { status: 400 })

    let query = supabase.from('employees')
      .select('id, name, nickname, position')
      .eq('active', true)
    if (password) query = query.eq('password', password.trim())
    else query = query.eq('pin', pin.trim())
    if (employee_id) query = query.eq('id', employee_id)
    const { data: emp } = await query.maybeSingle()

    if (!emp) return Response.json({ error: password ? 'รหัสผ่านไม่ถูกต้อง' : 'PIN ไม่ถูกต้อง' }, { status: 401 })

    if (verifyOnly) return Response.json({ name: emp.nickname || emp.name })

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const now   = new Date().toISOString()

    const { data: existing } = await supabase
      .from('attendance')
      .select('id, check_in, check_out')
      .eq('employee_id', emp.id)
      .eq('date', today)
      .maybeSingle()

    let action, time

    if (!existing) {
      await supabase.from('attendance').insert({
        employee_id: emp.id,
        date: today,
        check_in: now,
        status: 'present',
      })
      action = 'in'; time = now
    } else if (!existing.check_out) {
      await supabase.from('attendance').update({ check_out: now }).eq('id', existing.id)
      action = 'out'; time = now
    } else {
      return Response.json({
        action: 'done',
        name: emp.nickname || emp.name,
        check_in:  existing.check_in,
        check_out: existing.check_out,
      })
    }

    return Response.json({ action, name: emp.nickname || emp.name, time })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
