import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/payroll/bonus?employee_id=X&period=YYYY-MM
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const employee_id = searchParams.get('employee_id')
    const period      = searchParams.get('period')
    let q = supabase.from('employee_bonus').select('*').order('created_at')
    if (employee_id) q = q.eq('employee_id', Number(employee_id))
    if (period)      q = q.eq('period', period)
    const { data, error } = await q
    if (error) throw error
    return Response.json(data || [])
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/payroll/bonus — เพิ่มโบนัส
// { employee_id, period, amount, note, paid_cash }
// paid_cash = true → บันทึก salary_advance ด้วย (รับเงินสดไปแล้ว)
export async function POST(req) {
  try {
    const { employee_id, period, amount, note, paid_cash } = await req.json()
    if (!employee_id || !period || !amount)
      return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    const { data, error } = await supabase.from('employee_bonus').insert({
      employee_id: Number(employee_id),
      period,
      amount: Number(amount),
      note: note || null,
    }).select().single()
    if (error) throw error

    if (paid_cash) {
      await supabase.from('salary_advances').insert({
        employee_id: Number(employee_id),
        amount: Number(amount),
        note: `${note || 'โบนัสพิเศษ'} — รับเงินสดแล้ว`,
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: 'manual',
        requested_at: new Date().toISOString(),
      })
    }

    return Response.json(data)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/payroll/bonus?id=X
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'ไม่ระบุ id' }, { status: 400 })
    await supabase.from('employee_bonus').delete().eq('id', Number(id))
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
