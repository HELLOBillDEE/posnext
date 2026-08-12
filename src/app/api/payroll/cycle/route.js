import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/payroll/cycle?employee_id=7
// POST /api/payroll/cycle  { employee_id, amount, cycle_day_to, note }
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const empId = searchParams.get('employee_id')

  const empFilter = empId ? { id: Number(empId) } : { active: true }
  const { data: employees } = await supabase.from('employees')
    .select('id, name, nickname, daily_rate, repair_commission_pct')
    .match(empFilter).order('name')

  const result = []
  for (const emp of employees || []) {
    // หาวันแรกที่นับ = วันหลังจาก cycle payment ล่าสุด (type='cycle')
    const { data: lastCycle } = await supabase.from('payroll_withdrawals')
      .select('cycle_day_to, created_at')
      .eq('employee_id', emp.id).eq('type', 'cycle')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    // ดึง attendance เฉพาะตั้งแต่วันหลัง cycle payment ล่าสุด
    const sinceDate = lastCycle?.created_at
      ? new Date(lastCycle.created_at).toISOString().slice(0, 10)
      : '2000-01-01'
    const { data: allAtt } = await supabase.from('attendance')
      .select('date, check_in, check_out')
      .eq('employee_id', emp.id)
      .gt('date', sinceDate)
      .not('check_in', 'is', null)
      .order('date', { ascending: true })

    const days = (allAtt || []).map(a => ({
      date: a.date,
      count: (a.check_in && a.check_out) ? 1 : 0.5
    }))

    const lastCycleDayTo = lastCycle?.cycle_day_to || 0
    const daysInCycle = days.reduce((s, d) => s + d.count, 0)
    const daysUntilPay = Math.max(0, 10 - daysInCycle)
    const isComplete = daysInCycle >= 10

    // วันที่ครบรอบ 10 วัน
    let completedDate = null
    if (isComplete) {
      let counted = 0
      for (const d of days) {
        counted += d.count
        if (counted >= 10) { completedDate = d.date; break }
      }
    }

    // เช็คว่า 10 วันนี้ทำต่อเนื่องไม่หยุดเลยมั้ย (ทุกวันปฏิทิน diff=1)
    let hasStreakBonus = false
    if (isComplete) {
      const cycleDates = []
      let counted = 0
      for (const d of days) {
        cycleDates.push(d.date)
        counted += d.count
        if (counted >= 10) break
      }
      hasStreakBonus = cycleDates.every((date, i) => {
        if (i === 0) return true
        return Math.round((new Date(date) - new Date(cycleDates[i - 1])) / 86400000) === 1
      })
    }

    // ยอดค่าแรงรอบนี้ = 10 วัน × daily_rate + โบนัส 200 (เฉพาะถ้าต่อเนื่อง)
    const cycleAmount = 10 * Number(emp.daily_rate || 0) + (hasStreakBonus ? 200 : 0)

    result.push({
      employee_id: emp.id,
      name: emp.name,
      nickname: emp.nickname,
      daily_rate: emp.daily_rate,
      lastCycleDayTo,
      daysInCycle: Math.round(daysInCycle * 10) / 10,
      daysUntilPay: Math.round(daysUntilPay * 10) / 10,
      isComplete,
      completedDate,
      cycleAmount,
      hasStreakBonus,
    })
  }

  return Response.json(result)
}

export async function POST(req) {
  const body = await req.json()
  const { employee_id, amount, cycle_day_to, note, paid_by } = body

  const { data, error } = await supabase.from('payroll_withdrawals').insert({
    employee_id, amount, type: 'cycle', cycle_day_to,
    note: note || `จ่ายค่าแรงรอบ ${cycle_day_to - 9}–${cycle_day_to} วัน`,
    paid_by: paid_by || 'admin',
  }).select().single()

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json(data)
}
