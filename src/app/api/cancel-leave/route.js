import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { leave_id, employee_id, pin, password } = await req.json()
    if (!leave_id || !employee_id || (!pin && !password)) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    let eq = supabase.from('employees').select('id').eq('id', employee_id).eq('active', true)
    if (password) eq = eq.eq('password', password.trim())
    else eq = eq.eq('pin', pin.trim())
    const { data: emp } = await eq.maybeSingle()
    if (!emp) return Response.json({ error: password ? 'รหัสผ่านไม่ถูกต้อง' : 'PIN ไม่ถูกต้อง' }, { status: 401 })

    const { data: leave } = await supabase
      .from('leave_requests').select('id, status')
      .eq('id', leave_id).eq('employee_id', emp.id).maybeSingle()

    if (!leave) return Response.json({ error: 'ไม่พบคำขอลา' }, { status: 404 })
    if (leave.status !== 'pending') return Response.json({ error: 'ยกเลิกได้เฉพาะรายการที่รออนุมัติเท่านั้น' }, { status: 409 })

    await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', leave_id)

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
