import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/payroll/installment?employee_id=X
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const employee_id = searchParams.get('employee_id')
    let q = supabase.from('employee_installments').select('*').order('created_at')
    if (employee_id) q = q.eq('employee_id', employee_id)
    const { data, error } = await q
    if (error) throw error
    return Response.json(data || [])
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/payroll/installment — สร้างรายการผ่อน
export async function POST(req) {
  try {
    const { employee_id, name, amount_per_day, total_days } = await req.json()
    if (!employee_id || !name || !amount_per_day || !total_days)
      return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    const { data, error } = await supabase.from('employee_installments').insert({
      employee_id, name,
      amount_per_day: Number(amount_per_day),
      total_days: Number(total_days),
      paid_days: 0,
      active: true,
    }).select().single()
    if (error) throw error
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/payroll/installment — แก้ไขหรือปิดการผ่อน
export async function PATCH(req) {
  try {
    const { id, ...updates } = await req.json()
    if (!id) return Response.json({ error: 'ไม่ระบุ id' }, { status: 400 })
    const allowed = ['name', 'amount_per_day', 'total_days', 'paid_days', 'active']
    const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))
    const { error } = await supabase.from('employee_installments').update(patch).eq('id', id)
    if (error) throw error
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/payroll/installment?id=X — ลบ
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'ไม่ระบุ id' }, { status: 400 })
    await supabase.from('employee_installments').delete().eq('id', id)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
