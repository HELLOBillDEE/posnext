import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/delivery/location?token=xxx — ดึง trail ทั้งหมด
export async function GET(req) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return Response.json({ error: 'ไม่ระบุ token' }, { status: 400 })

  const { data: doc } = await supabase
    .from('quotations').select('id').eq('delivery_token', token).maybeSingle()
  if (!doc) return Response.json({ error: 'ไม่พบ' }, { status: 404 })

  const { data: points } = await supabase
    .from('delivery_location_points')
    .select('lat,lng,recorded_at')
    .eq('quotation_id', doc.id)
    .order('recorded_at', { ascending: true })

  return Response.json({ points: points || [] })
}

// POST /api/delivery/location — บันทึกจุด GPS
export async function POST(req) {
  try {
    const { token, lat, lng } = await req.json()
    if (!token || !lat || !lng) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    const { data: doc } = await supabase
      .from('quotations').select('id').eq('delivery_token', token).maybeSingle()
    if (!doc) return Response.json({ error: 'ไม่พบ' }, { status: 404 })

    await supabase.from('delivery_location_points').insert({
      quotation_id: doc.id, lat, lng
    })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
