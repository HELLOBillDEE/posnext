import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/payroll?period=YYYY-MM  — admin payroll summary
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') ||
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)

    const [year, month] = period.split('-').map(Number)
    const dateFrom = `${period}-01`
    const lastDay  = new Date(year, month, 0).getDate()
    const dateTo   = `${period}-${String(lastDay).padStart(2, '0')}`

    const [{ data: employees }, { data: attendance }, { data: leaves }, { data: advances }] = await Promise.all([
      supabase.from('employees').select('id, name, nickname, position, daily_rate, phone, password, pin').eq('active', true).order('name'),
      supabase.from('attendance').select('employee_id, date, check_in, check_out, status')
        .gte('date', dateFrom).lte('date', dateTo),
      supabase.from('leave_requests').select('employee_id, date_from, date_to, leave_period, status')
        .in('status', ['approved']).lte('date_from', dateTo).gte('date_to', dateFrom),
      supabase.from('salary_advances').select('employee_id, amount, status, requested_at')
        .in('status', ['approved']).gte('requested_at', dateFrom + 'T00:00:00').lte('requested_at', dateTo + 'T23:59:59'),
    ])

    const result = (employees || []).map(emp => {
      const empAtt  = (attendance || []).filter(a => a.employee_id === emp.id)
      const empLeave = (leaves || []).filter(l => l.employee_id === emp.id)
      const empAdv  = (advances || []).filter(a => a.employee_id === emp.id)

      // คำนวณวันทำงาน
      let daysWorked = 0
      const workDates = []

      for (const att of empAtt) {
        // ตรวจว่าวันนี้มีลาครึ่งวันไหม
        const dayLeave = empLeave.find(l =>
          l.date_from <= att.date && l.date_to >= att.date &&
          (l.leave_period === 'morning' || l.leave_period === 'afternoon')
        )
        const fullDayLeave = empLeave.find(l =>
          l.date_from <= att.date && l.date_to >= att.date && l.leave_period === 'full'
        )

        if (fullDayLeave) {
          // วันลาเต็มวัน (approved) ไม่นับ
          continue
        } else if (dayLeave) {
          // มีครึ่งวัน → นับ 0.5
          daysWorked += 0.5
          workDates.push({ date: att.date, factor: 0.5 })
        } else if (att.check_in && att.check_out) {
          daysWorked += 1
          workDates.push({ date: att.date, factor: 1 })
        } else if (att.check_in) {
          // เข้าแต่ไม่ออก → นับครึ่งวัน
          daysWorked += 0.5
          workDates.push({ date: att.date, factor: 0.5 })
        }
      }

      // Bonus 200 บาท ถ้ามาครบ 10 วันติดต่อกัน (ไม่ขาด)
      let streakBonus = 0
      if (workDates.length >= 10) {
        const sorted = [...workDates].sort((a, b) => a.date.localeCompare(b.date))
        let streak = 1, maxStreak = 1
        for (let i = 1; i < sorted.length; i++) {
          const prev = new Date(sorted[i-1].date)
          const curr = new Date(sorted[i].date)
          const diff = Math.round((curr - prev) / 86400000)
          // นับเฉพาะวันติดกัน (ข้ามวันหยุดได้ แต่ขาดไม่ได้)
          if (diff === 1 && sorted[i].factor >= 1) {
            streak++
            if (streak >= 10) { streakBonus = 200; break }
          } else if (diff > 1) {
            streak = 1
          }
          maxStreak = Math.max(maxStreak, streak)
        }
      }

      const dailyRate  = Number(emp.daily_rate || 0)
      const grossPay   = daysWorked * dailyRate + streakBonus
      const advTotal   = empAdv.reduce((s, a) => s + Number(a.amount), 0)
      const netPay     = Math.max(0, grossPay - advTotal)

      // วันหักล่วงหน้า (ถ้าเบิกเกินเงินที่ควรได้)
      const overDraw   = Math.max(0, advTotal - grossPay)
      const daysToDeduct = dailyRate > 0 ? Math.ceil(overDraw / dailyRate) : 0

      return {
        ...emp,
        daysWorked,
        streakBonus,
        grossPay,
        advTotal,
        netPay,
        overDraw,
        daysToDeduct,
        attendance: empAtt,
        leaves: empLeave,
        advances: empAdv,
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
