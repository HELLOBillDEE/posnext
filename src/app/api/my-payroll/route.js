import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const MONTH_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

export async function POST(req) {
  try {
    const { employee_id, password, period } = await req.json()
    if (!employee_id || !password) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    const { data: emp } = await supabase.from('employees')
      .select('id, name, nickname, position, daily_rate, repair_commission_pct')
      .eq('id', employee_id).eq('active', true).eq('password', password.trim())
      .maybeSingle()

    if (!emp) return Response.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 })

    const currentPeriod = period || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)
    const [year, month] = currentPeriod.split('-').map(Number)
    const dateFrom = `${currentPeriod}-01`
    const lastDay  = new Date(year, month, 0).getDate()
    const dateTo   = `${currentPeriod}-${String(lastDay).padStart(2, '0')}`

    const prevDate   = new Date(year, month - 2, 1)
    const prevPeriod = prevDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)

    const displayName = emp.nickname || emp.name

    const [
      { data: attendance },
      { data: leaves },
      { data: advances },
      { data: installments },
      { data: settlement },
      { data: prevSettlement },
      { data: repairItems },
      { data: bonuses },
    ] = await Promise.all([
      supabase.from('attendance').select('date, check_in, check_out')
        .eq('employee_id', emp.id).gte('date', dateFrom).lte('date', dateTo),
      supabase.from('leave_requests').select('date_from, date_to, leave_period, status')
        .eq('employee_id', emp.id).in('status', ['approved'])
        .lte('date_from', dateTo).gte('date_to', dateFrom),
      supabase.from('salary_advances').select('amount, status, requested_at, note')
        .eq('employee_id', emp.id).in('status', ['approved'])
        .gte('requested_at', dateFrom + 'T00:00:00').lte('requested_at', dateTo + 'T23:59:59'),
      supabase.from('employee_installments').select('*').eq('employee_id', emp.id).eq('active', true),
      supabase.from('payroll_settlements').select('*')
        .eq('employee_id', emp.id).eq('period', currentPeriod).maybeSingle(),
      supabase.from('payroll_settlements').select('carry_forward_out')
        .eq('employee_id', emp.id).eq('period', prevPeriod).maybeSingle(),
      supabase.from('sale_items').select('name, price, qty, created_at')
        .ilike('name', '%ซ่อม%').eq('technician_name', displayName)
        .gte('created_at', dateFrom + 'T00:00:00').lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false }),
      supabase.from('employee_bonus').select('amount, note')
        .eq('employee_id', emp.id).eq('period', currentPeriod),
    ])

    // คำนวณวันทำงาน
    let daysWorked = 0
    const workDates = []
    for (const att of (attendance || [])) {
      const full = (leaves || []).find(l => l.date_from <= att.date && l.date_to >= att.date && l.leave_period === 'full')
      const half = (leaves || []).find(l => l.date_from <= att.date && l.date_to >= att.date && (l.leave_period === 'morning' || l.leave_period === 'afternoon'))
      if (full) continue
      if (half) { daysWorked += 0.5; workDates.push({ date: att.date, factor: 0.5 }) }
      else if (att.check_in && att.check_out) { daysWorked += 1; workDates.push({ date: att.date, factor: 1 }) }
      else if (att.check_in) { daysWorked += 0.5; workDates.push({ date: att.date, factor: 0.5 }) }
    }

    // Streak bonus
    let streakBonus = 0
    const fullDays = workDates.filter(d => d.factor >= 1).sort((a, b) => a.date.localeCompare(b.date))
    if (fullDays.length >= 10) {
      let streak = 1
      for (let i = 1; i < fullDays.length; i++) {
        const diff = Math.round((new Date(fullDays[i].date) - new Date(fullDays[i-1].date)) / 86400000)
        if (diff === 1) { streak++; if (streak % 10 === 0) streakBonus += 200 }
        else streak = 1
      }
    }

    const commPct    = Number(emp.repair_commission_pct || 0) / 100
    const laborTotal = (repairItems || []).reduce((s, r) => s + Number(r.price) * Number(r.qty), 0)
    const commission = Math.round(laborTotal * commPct)

    const carryForwardIn = prevSettlement ? Number(prevSettlement.carry_forward_out) : 0

    const installmentDetail = (installments || []).map(inst => {
      const remaining = inst.total_days - inst.paid_days
      if (remaining <= 0) return { ...inst, thisMonth: 0, remaining: 0, deductAmount: 0 }
      const daysToDeduct = Math.min(Math.floor(daysWorked), remaining)
      return { ...inst, thisMonth: daysToDeduct, deductAmount: daysToDeduct * Number(inst.amount_per_day), remaining }
    })
    const installmentDeduct = installmentDetail.reduce((s, i) => s + (i.deductAmount || 0), 0)

    const manualBonus  = (bonuses || []).reduce((s, b) => s + Number(b.amount), 0)
    const dailyRate    = Number(emp.daily_rate || 0)
    const grossPay     = daysWorked * dailyRate
    const totalEarned  = grossPay + streakBonus + commission + manualBonus
    const totalWithdrawn = (advances || []).reduce((s, a) => s + Number(a.amount), 0)
    const netPayDue    = totalEarned - totalWithdrawn - installmentDeduct - carryForwardIn

    return Response.json({
      period: currentPeriod,
      monthLabel: `${MONTH_TH[month - 1]} ${year + 543}`,
      employee: emp,
      daysWorked,
      daily_rate: dailyRate,
      grossPay,
      streakBonus,
      commission,
      manualBonus,
      bonusDetail: bonuses || [],
      totalEarned,
      totalWithdrawn,
      installmentDeduct,
      installmentDetail,
      carryForwardIn,
      netPayDue,
      advances: advances || [],
      repairItems: repairItems || [],
      settled: settlement || null,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
