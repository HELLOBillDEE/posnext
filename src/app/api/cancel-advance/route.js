import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { advance_id, employee_id, pin, password } = await req.json()
    if (!advance_id || !employee_id || (!pin && !password)) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    let eq = supabase.from('employees').select('id').eq('id', employee_id).eq('active', true)
    if (password) eq = eq.eq('password', password.trim())
    else eq = eq.eq('pin', pin.trim())
    const { data: emp } = await eq.maybeSingle()
    if (!emp) return Response.json({ error: password ? 'รหัสผ่านไม่ถูกต้อง' : 'PIN ไม่ถูกต้อง' }, { status: 401 })

    const { data: adv } = await supabase
      .from('salary_advances').select('id, status')
      .eq('id', advance_id).eq('employee_id', emp.id).maybeSingle()

    if (!adv) return Response.json({ error: 'ไม่พบคำขอเบิก' }, { status: 404 })
    if (adv.status !== 'pending') return Response.json({ error: 'ยกเลิกได้เฉพาะรายการที่รออนุมัติเท่านั้น' }, { status: 409 })

    await supabase.from('salary_advances').update({ status: 'cancelled' }).eq('id', advance_id)

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
