import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { employee_id, pin, password } = await req.json()
    if (!employee_id || (!pin && !password)) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    let q = supabase.from('employees')
      .select('id, name, nickname, position, salary, start_date, phone')
      .eq('id', employee_id).eq('active', true)
    if (password) q = q.eq('password', password.trim())
    else q = q.eq('pin', pin.trim())
    const { data: emp } = await q.maybeSingle()

    if (!emp) return Response.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 })

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

    const [{ data: todayAtt }, { data: recentAtt }, { data: leaves }, { data: advances }] = await Promise.all([
      supabase.from('attendance').select('check_in, check_out, date, status')
        .eq('employee_id', emp.id).eq('date', today).maybeSingle(),
      supabase.from('attendance').select('date, check_in, check_out, status')
        .eq('employee_id', emp.id).order('date', { ascending: false }).limit(14),
      supabase.from('leave_requests').select('id, leave_type, leave_period, date_from, date_to, note, status, requested_at')
        .eq('employee_id', emp.id).order('requested_at', { ascending: false }).limit(20),
      supabase.from('salary_advances').select('id, amount, note, status, requested_at')
        .eq('employee_id', emp.id).order('requested_at', { ascending: false }).limit(10),
    ])

    return Response.json({
      employee: emp,
      today:    todayAtt || null,
      recentAtt: recentAtt || [],
      leaves:   leaves || [],
      advances: advances || [],
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
