import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { getLineSettings } from '@/lib/lineStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/delivery?token=xxx
export async function GET(req) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return Response.json({ error: 'ไม่ระบุ token' }, { status: 400 })

  const { data, error } = await supabase
    .from('quotations')
    .select('id,doc_no,customer_name,customer_phone,customer_address,customer_lat,customer_lng,items,subtotal,discount,delivery_fee,total,note,status,delivered_at,delivery_photo_url,delivery_signature_url,customer_signature_url')
    .eq('delivery_token', token)
    .eq('doc_type', 'delivery_invoice')
    .maybeSingle()

  if (error || !data) return Response.json({ error: 'ไม่พบใบส่งของ' }, { status: 404 })

  // ดึงประวัติการส่งทุกรอบ
  const { data: trips } = await supabase
    .from('delivery_trips')
    .select('id,delivered_at,items_delivered,photo_url,signature_url,customer_signature_url')
    .eq('quotation_id', data.id)
    .order('delivered_at', { ascending: true })

  return Response.json({ ...data, delivery_trips: trips || [] })
}

// POST — สร้าง token + แจ้งลูกค้า LINE ว่ากำลังจัดส่ง
export async function POST(req) {
  try {
    const { id } = await req.json()
    if (!id) return Response.json({ error: 'ไม่ระบุ id' }, { status: 400 })

    const { data: existing } = await supabase
      .from('quotations').select('delivery_token,doc_no').eq('id', id).maybeSingle()

    if (existing?.delivery_token) return Response.json({ token: existing.delivery_token })

    const token = randomBytes(16).toString('hex')
    await supabase.from('quotations').update({ delivery_token: token, status: 'dispatching' }).eq('id', id)

    // หา LINE user จาก line_conversations ที่เก็บ state ออเดอร์ไว้
    const docNo = existing?.doc_no
    if (docNo) {
      try {
        const { data: convRow } = await supabase
          .from('line_conversations')
          .select('line_user_id')
          .or(`content.like.__awaiting_payment__:${docNo}:%,content.like.__awaiting_order_info__:${docNo}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (convRow?.line_user_id) {
          const lineCfg = await getLineSettings()
          if (lineCfg?.line_channel_token) {
            const dispatchMsg = `กำลังจัดส่งแล้วครับ 🚚 รอรับได้เลยนะครับ\n📄 เลขบิล: ${docNo}`
            await fetch('https://api.line.me/v2/bot/message/push', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineCfg.line_channel_token}` },
              body: JSON.stringify({ to: convRow.line_user_id, messages: [{ type: 'text', text: dispatchMsg }] }),
            })
            await supabase.from('line_conversations').insert({
              line_user_id: convRow.line_user_id, role: 'assistant', content: dispatchMsg,
            })
          }
        }
      } catch { /* ส่ง LINE ไม่ได้ ไม่ block token creation */ }
    }

    return Response.json({ token })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PUT — แก้ไขพิกัด
export async function PUT(req) {
  try {
    const { token, lat, lng } = await req.json()
    if (!token) return Response.json({ error: 'ไม่ระบุ token' }, { status: 400 })
    if (!lat || !lng) return Response.json({ error: 'ไม่ระบุพิกัด' }, { status: 400 })

    const { error } = await supabase
      .from('quotations')
      .update({ customer_lat: lat, customer_lng: lng })
      .eq('delivery_token', token)
      .eq('doc_type', 'delivery_invoice')

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PATCH — ยืนยันส่งของ (รองรับส่งบางรายการ)
export async function PATCH(req) {
  try {
    const { token, items_delivered, photo_url, signature_url, customer_signature_url } = await req.json()
    if (!token) return Response.json({ error: 'ไม่ระบุ token' }, { status: 400 })

    // ดึง quotation ปัจจุบัน
    const { data: doc, error: fetchErr } = await supabase
      .from('quotations')
      .select('id,items,status')
      .eq('delivery_token', token)
      .eq('doc_type', 'delivery_invoice')
      .maybeSingle()

    if (fetchErr || !doc) return Response.json({ error: 'ไม่พบใบส่งของ' }, { status: 404 })
    if (doc.status === 'delivered') return Response.json({ error: 'ส่งของครบแล้ว' }, { status: 409 })

    // อัพเดต delivered_qty ต่อ item
    const updatedItems = (doc.items || []).map((item, idx) => {
      const d = (items_delivered || []).find(x => x.idx === idx)
      if (!d) return item
      const prev = Number(item.delivered_qty || 0)
      const add  = Number(d.qty_delivered || 0)
      return { ...item, delivered_qty: Math.min(prev + add, Number(item.qty || 1)) }
    })

    // ตรวจว่าครบทุกรายการหรือยัง
    const allDone = updatedItems.every(item =>
      Number(item.delivered_qty || 0) >= Number(item.qty || 1)
    )

    const now = new Date().toISOString()

    // อัพเดต quotation
    const updatePayload = { items: updatedItems }
    if (allDone) {
      updatePayload.delivered_at = now
      updatePayload.status = 'delivered'
      if (photo_url) updatePayload.delivery_photo_url = photo_url
      if (signature_url) updatePayload.delivery_signature_url = signature_url
      if (customer_signature_url) updatePayload.customer_signature_url = customer_signature_url
    }

    const { error: updErr } = await supabase
      .from('quotations').update(updatePayload).eq('id', doc.id)
    if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

    // บันทึก delivery_trip
    const { error: tripErr } = await supabase
      .from('delivery_trips').insert({
        quotation_id: doc.id,
        delivered_at: now,
        items_delivered: items_delivered || [],
        photo_url: photo_url || null,
        signature_url: signature_url || null,
        customer_signature_url: customer_signature_url || null,
      })
    if (tripErr) console.error('[delivery_trip insert]', tripErr.message)

    return Response.json({ ok: true, all_done: allDone })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
