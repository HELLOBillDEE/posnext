import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function GET() {
  const { data } = await supabase
    .from('shop_announcements')
    .select('id, title, body, type, created_at')
    .eq('active', true)
    .order('created_at', { ascending: false })
  return Response.json(data || [])
}

export async function POST(req) {
  try {
    const { title, body, type } = await req.json()
    if (!title?.trim()) return Response.json({ error: 'ต้องมีหัวข้อ' }, { status: 400 })

    const { data, error } = await supabase
      .from('shop_announcements')
      .insert({ title: title.trim(), body: body?.trim() || null, type: type || 'info', active: true })
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json()
    if (!id) return Response.json({ error: 'ไม่มี id' }, { status: 400 })
    await supabase.from('shop_announcements').update({ active: false }).eq('id', id)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
