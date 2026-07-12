import { createClient } from '@supabase/supabase-js'
import { notifyDrawerRequest } from '@/lib/telegramStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { employee_id, password, note } = await req.json()
    if (!employee_id || !password) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    const { data: emp } = await supabase
      .from('employees').select('id, name, nickname')
      .eq('id', employee_id).eq('password', password.trim()).eq('active', true).maybeSingle()
    if (!emp) return Response.json({ error: 'ตรวจสอบสิทธิ์ไม่ผ่าน' }, { status: 401 })

    const empName = emp.nickname || emp.name

    const { data: req_ } = await supabase
      .from('drawer_requests')
      .insert({ employee_id: emp.id, employee_name: empName, status: 'pending', note: note || null })
      .select('id').single()

    notifyDrawerRequest({ id: req_.id, empName, note }).catch(() => {})

    return Response.json({ ok: true, request_id: req_.id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'ไม่ได้ระบุ id' }, { status: 400 })

  const { data } = await supabase
    .from('drawer_requests').select('id, status').eq('id', id).maybeSingle()
  return Response.json(data || { status: 'not_found' })
}
