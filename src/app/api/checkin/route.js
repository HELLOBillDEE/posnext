import { createClient } from '@supabase/supabase-js'
import { notifyAttendance } from '@/lib/telegramStaff'

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

    notifyAttendance({ empName: emp.nickname || emp.name, action, time }).catch(() => {})

    let streak_days = 0
    if (action === 'in') {
      const { data: recentAtt } = await supabase
        .from('attendance').select('date')
        .eq('employee_id', emp.id)
        .order('date', { ascending: false }).limit(31)
      const attDates = new Set((recentAtt || []).map(a => a.date))
      const [y, m, d] = today.split('-').map(Number)
      let dt = new Date(Date.UTC(y, m - 1, d))
      let streak = 0
      while (attDates.has(dt.toISOString().slice(0, 10))) {
        streak++
        dt.setUTCDate(dt.getUTCDate() - 1)
      }
      if (streak > 0 && streak % 10 === 0) streak_days = streak
    }

    return Response.json({ action, name: emp.nickname || emp.name, time, streak_days })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
