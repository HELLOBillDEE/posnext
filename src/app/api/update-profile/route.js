import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { employee_id, password, name, nickname, phone, new_password, new_pin } = await req.json()
    if (!employee_id || !password) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    // verify identity
    const { data: emp } = await supabase.from('employees')
      .select('id').eq('id', employee_id).eq('password', password.trim()).eq('active', true).maybeSingle()
    if (!emp) return Response.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 })

    const patch = {}
    if (name?.trim())     patch.name     = name.trim()
    if (nickname !== undefined) patch.nickname = nickname?.trim() || null
    if (phone !== undefined)    patch.phone    = phone?.trim()    || null
    if (new_password?.trim())   patch.password = new_password.trim()
    if (new_pin?.trim())        patch.pin      = new_pin.trim()

    if (Object.keys(patch).length === 0) return Response.json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' }, { status: 400 })

    const { error } = await supabase.from('employees').update(patch).eq('id', employee_id)
    if (error) throw error

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
