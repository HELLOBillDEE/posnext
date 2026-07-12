import { createClient } from '@supabase/supabase-js'
import { notifyAdvance } from '@/lib/telegramStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { employee_id, pin, password, amount, note } = await req.json()
    if (!employee_id || (!pin && !password)) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })
    if (!amount || isNaN(amount) || Number(amount) <= 0)
      return Response.json({ error: 'จำนวนเงินไม่ถูกต้อง' }, { status: 400 })

    let eq = supabase.from('employees').select('id, name, nickname').eq('id', employee_id).eq('active', true)
    if (password) eq = eq.eq('password', password.trim())
    else eq = eq.eq('pin', pin.trim())
    const { data: emp } = await eq.maybeSingle()

    if (!emp) return Response.json({ error: password ? 'รหัสผ่านไม่ถูกต้อง' : 'PIN ไม่ถูกต้อง' }, { status: 401 })

    const { data: inserted } = await supabase.from('salary_advances').insert({
      employee_id: emp.id,
      amount: Number(amount),
      note: note || null,
      status: 'pending',
    }).select('id').single()

    // แจ้งเตือน LINE กลุ่ม (ไม่ block response)
    if (inserted?.id) {
      notifyAdvance({
        id: inserted.id,
        empName: emp.nickname || emp.name,
        amount: Number(amount),
      }).catch(e => console.error('[LINE advance]', e?.message))
    } else {
      console.error('[advance] inserted id missing', inserted)
    }

    return Response.json({ name: emp.nickname || emp.name, amount: Number(amount) })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
