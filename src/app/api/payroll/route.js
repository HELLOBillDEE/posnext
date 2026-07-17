import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/payroll?period=YYYY-MM
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') ||
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)

    const [year, month] = period.split('-').map(Number)
    const dateFrom = `${period}-01`
    const lastDay  = new Date(year, month, 0).getDate()
    const dateTo   = `${period}-${String(lastDay).padStart(2, '0')}`

    // Previous period for carry-forward
    const prevDate  = new Date(year, month - 2, 1)
    const prevPeriod = prevDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)

    const [
      { data: employees },
      { data: attendance },
      { data: leaves },
      { data: advances },
      { data: installments },
      { data: settlements },
      { data: prevSettlements },
      { data: repairItems },
      { data: bonuses },
    ] = await Promise.all([
      supabase.from('employees').select('id, name, nickname, position, daily_rate, repair_commission_pct').eq('active', true).order('name'),
      supabase.from('attendance').select('employee_id, date, check_in, check_out').gte('date', dateFrom).lte('date', dateTo),
      supabase.from('leave_requests').select('employee_id, date_from, date_to, leave_period, status').in('status', ['approved']).lte('date_from', dateTo).gte('date_to', dateFrom),
      supabase.from('salary_advances').select('employee_id, amount, status, requested_at').in('status', ['approved']).gte('requested_at', dateFrom + 'T00:00:00').lte('requested_at', dateTo + 'T23:59:59'),
      supabase.from('employee_installments').select('*').eq('active', true),
      supabase.from('payroll_settlements').select('*').eq('period', period),
      supabase.from('payroll_settlements').select('employee_id, carry_forward_out').eq('period', prevPeriod),
      supabase.from('sale_items')
        .select('technician_name, price, qty')
        .ilike('name', '%ซ่อม%')
        .not('technician_name', 'is', null)
        .neq('technician_name', '')
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59'),
      supabase.from('employee_bonus').select('employee_id, amount, note').eq('period', period),
    ])

    const result = (employees || []).map(emp => {
      const empAtt   = (attendance || []).filter(a => a.employee_id === emp.id)
      const empLeave = (leaves || []).filter(l => l.employee_id === emp.id)
      const empAdv   = (advances || []).filter(a => a.employee_id === emp.id)
      const empInst  = (installments || []).filter(i => i.employee_id === emp.id)
      const empBonus = (bonuses || []).filter(b => b.employee_id === emp.id)
      const settled  = (settlements || []).find(s => s.employee_id === emp.id) || null
      const prevSet  = (prevSettlements || []).find(s => s.employee_id === emp.id)
      const carryForwardIn = prevSet ? Number(prevSet.carry_forward_out) : 0

      // คำนวณวันทำงานและ consecutive streak
      let daysWorked = 0
      const workDates = []

      for (const att of empAtt) {
        const fullLeave = empLeave.find(l =>
          l.date_from <= att.date && l.date_to >= att.date && l.leave_period === 'full'
        )
        const halfLeave = empLeave.find(l =>
          l.date_from <= att.date && l.date_to >= att.date &&
          (l.leave_period === 'morning' || l.leave_period === 'afternoon')
        )
        if (fullLeave) continue
        if (halfLeave) {
          daysWorked += 0.5
          workDates.push({ date: att.date, factor: 0.5 })
        } else if (att.check_in && att.check_out) {
          daysWorked += 1
          workDates.push({ date: att.date, factor: 1 })
        } else if (att.check_in) {
          daysWorked += 0.5
          workDates.push({ date: att.date, factor: 0.5 })
        }
      }

      // Streak bonus 200 บาท ต่อทุก 10 วันเต็มติดต่อกัน (ไม่นับครึ่งวัน)
      let streakBonus = 0
      const fullDays = workDates.filter(d => d.factor >= 1).sort((a, b) => a.date.localeCompare(b.date))
      if (fullDays.length >= 10) {
        let streak = 1
        for (let i = 1; i < fullDays.length; i++) {
          const prev = new Date(fullDays[i - 1].date)
          const curr = new Date(fullDays[i].date)
          const diff = Math.round((curr - prev) / 86400000)
          if (diff === 1) {
            streak++
            if (streak % 10 === 0) streakBonus += 200
          } else {
            streak = 1
          }
        }
      }

      // ค่าคอมมิชชั่น (ค่าแรงซ่อมที่ tag ชื่อพนักงาน)
      const displayName = emp.nickname || emp.name
      const commPct = Number(emp.repair_commission_pct || 0) / 100
      const laborTotal = (repairItems || [])
        .filter(r => r.technician_name === displayName)
        .reduce((s, r) => s + Number(r.price) * Number(r.qty), 0)
      const commission = Math.round(laborTotal * commPct)

      // Installment deductions (ตัดวันทำงานจริงในเดือนนี้)
      let installmentDeduct = 0
      const installmentDetail = empInst.map(inst => {
        const remaining = inst.total_days - inst.paid_days
        if (remaining <= 0) return { ...inst, thisMonth: 0, remaining: 0 }
        // ยังไม่ถึงเดือนที่กำหนดเริ่มผ่อน
        if (inst.start_date && inst.start_date.slice(0, 7) > period)
          return { ...inst, thisMonth: 0, deductAmount: 0, remaining, notStarted: true }
        // ถ้า start_date อยู่ในเดือนเดียวกัน นับเฉพาะวันทำงานตั้งแต่ start_date
        let eligibleDays = daysWorked
        if (inst.start_date && inst.start_date.slice(0, 7) === period) {
          eligibleDays = workDates.filter(d => d.date >= inst.start_date && d.factor >= 1).length
        }
        const daysToDeduct = Math.min(Math.floor(eligibleDays), remaining)
        const amount = daysToDeduct * Number(inst.amount_per_day)
        installmentDeduct += amount
        return { ...inst, thisMonth: daysToDeduct, deductAmount: amount, remaining }
      })

      const dailyRate    = Number(emp.daily_rate || 0)
      const grossPay     = daysWorked * dailyRate
      const manualBonus  = empBonus.reduce((s, b) => s + Number(b.amount), 0)
      const totalEarned  = grossPay + streakBonus + commission + manualBonus
      const totalWithdrawn = empAdv.reduce((s, a) => s + Number(a.amount), 0)
      const netPayDue    = totalEarned - totalWithdrawn - installmentDeduct - carryForwardIn
      // carryForwardIn > 0 = employee owes shop (debt from last month)
      // netPayDue > 0 = shop owes employee; netPayDue < 0 = carry to next month

      return {
        id: emp.id,
        name: emp.name,
        nickname: emp.nickname,
        position: emp.position,
        daily_rate: dailyRate,
        repair_commission_pct: emp.repair_commission_pct,
        daysWorked,
        workDates,
        attendance: empAtt,
        leaves: empLeave,
        streakBonus,
        commission,
        laborTotal,
        grossPay,
        manualBonus,
        bonusDetail: empBonus,
        totalEarned,
        totalWithdrawn,
        installmentDeduct,
        installmentDetail,
        carryForwardIn,
        netPayDue,
        advances: empAdv,
        settled,
      }
    })

    return Response.json({ period, dateFrom, dateTo, employees: result })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/payroll — update employee daily_rate
export async function PATCH(req) {
  try {
    const { employee_id, daily_rate } = await req.json()
    if (!employee_id) return Response.json({ error: 'ไม่ระบุพนักงาน' }, { status: 400 })
    await supabase.from('employees').update({ daily_rate: Number(daily_rate || 0) }).eq('id', employee_id)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
