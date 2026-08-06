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

    // ตรวจสอบรหัสผ่าน
    const { data: emp } = await supabase.from('employees')
      .select('id, name, nickname, position')
      .eq('id', employee_id).eq('active', true).eq('password', password.trim())
      .maybeSingle()

    if (!emp) return Response.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 })

    const currentPeriod = period || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)
    const [year, month] = currentPeriod.split('-').map(Number)

    // ใช้ /api/payroll เดิม — รับประกันสูตรเดียวกันกับ admin
    const { origin } = new URL(req.url)
    const payrollRes = await fetch(`${origin}/api/payroll?period=${currentPeriod}`)
    if (!payrollRes.ok) throw new Error('payroll API error')
    const payrollData = await payrollRes.json()

    const empData = (payrollData.employees || []).find(e => e.id === employee_id)
    if (!empData) return Response.json({ error: 'ไม่พบข้อมูลพนักงาน' }, { status: 404 })

    return Response.json({
      period: currentPeriod,
      monthLabel: `${MONTH_TH[month - 1]} ${year + 543}`,
      employee: { id: emp.id, name: emp.name, nickname: emp.nickname, position: emp.position,
                  daily_rate: empData.daily_rate, repair_commission_pct: empData.repair_commission_pct },
      daysWorked:       empData.daysWorked,
      daily_rate:       empData.daily_rate,
      grossPay:         empData.grossPay,
      streakBonus:      empData.streakBonus,
      commission:       empData.commission,
      manualBonus:      empData.manualBonus,
      bonusDetail:      empData.bonusDetail || [],
      carryPayIn:       empData.carryPayIn || 0,
      totalEarned:      empData.totalEarned,
      totalWithdrawn:   empData.totalWithdrawn,
      installmentDeduct: empData.installmentDeduct,
      installmentDetail: empData.installmentDetail || [],
      carryForwardIn:   empData.carryForwardIn,
      netPayDue:        empData.netPayDue,
      advances:         empData.advances || [],
      laborTotal:       empData.laborTotal || 0,
      settled:          empData.settled || null,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
