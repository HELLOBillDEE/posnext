import { createClient } from '@supabase/supabase-js'
import { notifyAdvance } from '@/lib/telegramStaff'
import { sendPushToAll } from '@/lib/webPush'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/advance?employee_id=X — ดึง daily_rate และ net_daily (หักผ่อน)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const employee_id = searchParams.get('employee_id')
    if (!employee_id) return Response.json({ error: 'ไม่ระบุพนักงาน' }, { status: 400 })

    const [{ data: emp }, { data: installments }] = await Promise.all([
      supabase.from('employees').select('id, name, nickname, daily_rate').eq('id', employee_id).single(),
      supabase.from('employee_installments').select('name, amount_per_day').eq('employee_id', employee_id).eq('active', true),
    ])

    const installPerDay = (installments || []).reduce((s, i) => s + Number(i.amount_per_day), 0)
    const dailyRate     = Number(emp?.daily_rate || 0)
    const netDaily      = Math.max(0, dailyRate - installPerDay)

    return Response.json({ daily_rate: dailyRate, install_per_day: installPerDay, net_daily: netDaily, installments: installments || [] })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/advance — เบิกค่าแรง (auto-approve ถ้า amount ≤ net_daily)
export async function POST(req) {
  try {
    const { employee_id, pin, password, amount, note } = await req.json()
    if (!employee_id || (!pin && !password)) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })
    if (!amount || isNaN(amount) || Number(amount) <= 0)
      return Response.json({ error: 'จำนวนเงินไม่ถูกต้อง' }, { status: 400 })

    let eq = supabase.from('employees').select('id, name, nickname, daily_rate').eq('id', employee_id).eq('active', true)
    if (password) eq = eq.eq('password', password.trim())
    else eq = eq.eq('pin', pin.trim())
    const { data: emp } = await eq.maybeSingle()

    if (!emp) return Response.json({ error: password ? 'รหัสผ่านไม่ถูกต้อง' : 'PIN ไม่ถูกต้อง' }, { status: 401 })

    // คำนวณ net daily (หักผ่อน)
    const { data: installments } = await supabase.from('employee_installments')
      .select('amount_per_day').eq('employee_id', emp.id).eq('active', true)
    const installPerDay = (installments || []).reduce((s, i) => s + Number(i.amount_per_day), 0)
    const netDaily      = Math.max(0, Number(emp.daily_rate || 0) - installPerDay)

    // auto-approve ถ้าเบิกไม่เกิน net daily
    const autoApprove = Number(amount) <= netDaily
    const now         = new Date().toISOString()

    const { data: inserted } = await supabase.from('salary_advances').insert({
      employee_id: emp.id,
      amount: Number(amount),
      note: note || null,
      status: autoApprove ? 'approved' : 'pending',
      approved_at: autoApprove ? now : null,
      approved_by: autoApprove ? 'auto' : null,
    }).select('id').single()

    // แจ้งเตือน admin เฉพาะกรณีต้องอนุมัติ
    if (!autoApprove && inserted?.id) {
      const empName = emp.nickname || emp.name
      notifyAdvance({ id: inserted.id, empName, amount: Number(amount), note: note || null })
        .catch(e => console.error('[advance notify]', e?.message))
      sendPushToAll({
        title: '💵 คำขอเบิก',
        body: `${empName} — ฿${Number(amount).toLocaleString('th-TH')}`,
        tag: `advance-${inserted.id}`,
        actions: [
          { action: 'approve', title: '✅ อนุมัติ' },
          { action: 'reject',  title: '❌ ปฏิเสธ' },
        ],
        meta: { type: 'advance', id: inserted.id },
      }).catch(() => {})
    }

    return Response.json({
      name: emp.nickname || emp.name,
      amount: Number(amount),
      autoApproved: autoApprove,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
