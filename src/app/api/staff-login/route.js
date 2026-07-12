import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { phone, password } = await req.json()
    if (!phone?.trim() || !password?.trim())
      return Response.json({ error: 'กรุณากรอกเบอร์โทรและรหัสผ่าน' }, { status: 400 })

    const { data: emp } = await supabase
      .from('employees')
      .select('id, name, nickname')
      .eq('phone', phone.trim())
      .eq('password', password.trim())
      .eq('active', true)
      .maybeSingle()

    if (!emp) return Response.json({ error: 'เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 })

    return Response.json({ employee: emp })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
