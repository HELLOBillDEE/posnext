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
      .select('id, name, nickname, position, salary, daily_rate, start_date, phone')
      .eq('id', employee_id).eq('active', true)
    if (password) q = q.eq('password', password.trim())
    else q = q.eq('pin', pin.trim())
    const { data: emp } = await q.maybeSingle()

    if (!emp) return Response.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 })

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

    const [{ data: todayAtt }, { data: recentAtt }, { data: leaves }, { data: advances }, { data: installments }] = await Promise.all([
      supabase.from('attendance').select('check_in, check_out, date, status')
        .eq('employee_id', emp.id).eq('date', today).maybeSingle(),
      supabase.from('attendance').select('date, check_in, check_out, status')
        .eq('employee_id', emp.id).gte('date', today.slice(0, 7) + '-01').lte('date', today).order('date', { ascending: true }),
      supabase.from('leave_requests').select('id, leave_type, leave_period, date_from, date_to, note, status, requested_at')
        .eq('employee_id', emp.id).order('requested_at', { ascending: false }).limit(20),
      supabase.from('salary_advances').select('id, amount, note, status, requested_at')
        .eq('employee_id', emp.id).order('requested_at', { ascending: false }).limit(10),
      supabase.from('employee_installments').select('name, amount_per_day')
        .eq('employee_id', emp.id).eq('active', true),
    ])

    const installPerDay = (installments || []).reduce((s, i) => s + Number(i.amount_per_day), 0)
    const netDaily      = Math.max(0, Number(emp.daily_rate || 0) - installPerDay)

    return Response.json({
      employee: emp,
      today:    todayAtt || null,
      recentAtt: recentAtt || [],
      leaves:   leaves || [],
      advances: advances || [],
      net_daily: netDaily,
      install_per_day: installPerDay,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
