import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/delivery?token=xxx — ดึงข้อมูลใบส่งของ (public)
export async function GET(req) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return Response.json({ error: 'ไม่ระบุ token' }, { status: 400 })

  const { data, error } = await supabase
    .from('quotations')
    .select('id,doc_no,customer_name,customer_phone,customer_address,customer_lat,customer_lng,items,subtotal,discount,delivery_fee,total,note,status,delivered_at,delivery_photo_url,delivery_signature_url')
    .eq('delivery_token', token)
    .eq('doc_type', 'delivery_invoice')
    .maybeSingle()

  if (error || !data) return Response.json({ error: 'ไม่พบใบส่งของ' }, { status: 404 })
  return Response.json(data)
}

// POST /api/delivery/token — สร้าง token สำหรับใบส่งของ
export async function POST(req) {
  try {
    const { id } = await req.json()
    if (!id) return Response.json({ error: 'ไม่ระบุ id' }, { status: 400 })

    // ตรวจว่ามี token แล้วหรือยัง
    const { data: existing } = await supabase
      .from('quotations').select('delivery_token').eq('id', id).maybeSingle()

    if (existing?.delivery_token) {
      return Response.json({ token: existing.delivery_token })
    }

    const token = randomBytes(16).toString('hex')
    await supabase.from('quotations').update({ delivery_token: token }).eq('id', id)
    return Response.json({ token })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/delivery — บันทึกยืนยันการส่ง
export async function PATCH(req) {
  try {
    const { token, photo_url, signature_url } = await req.json()
    if (!token) return Response.json({ error: 'ไม่ระบุ token' }, { status: 400 })

    const { data: doc } = await supabase
      .from('quotations').select('id,delivered_at').eq('delivery_token', token).maybeSingle()
    if (!doc) return Response.json({ error: 'ไม่พบใบส่งของ' }, { status: 404 })
    if (doc.delivered_at) return Response.json({ error: 'ส่งของเรียบร้อยแล้ว' }, { status: 409 })

    await supabase.from('quotations').update({
      delivered_at: new Date().toISOString(),
      delivery_photo_url: photo_url || null,
      delivery_signature_url: signature_url || null,
      status: 'delivered',
    }).eq('id', doc.id)

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
