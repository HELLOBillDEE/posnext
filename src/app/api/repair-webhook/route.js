import { createClient } from '@supabase/supabase-js'

export async function POST(req) {
  try {
    const body = await req.json()

    // Verify webhook secret
    const secret = req.headers.get('x-webhook-secret')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { db: { schema: 'pos' } }
    )

    const { data: cfg } = await supabase.from('settings')
      .select('value').eq('key', 'repair_webhook_secret').single()

    if (cfg?.value && secret !== cfg.value) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { action } = body

    // ── Update status by phone ──
    if (action === 'update_status') {
      const { phone, status } = body
      if (!phone || !status) return Response.json({ error: 'phone and status required' }, { status: 400 })
      const cleanPhone = String(phone).replace(/\D/g, '')
      const { data: found } = await supabase.from('repair_orders')
        .select('id,repair_no').or(`phone.eq.${cleanPhone},phone.eq.0${cleanPhone}`)
        .neq('status', 'picked_up').order('created_at', { ascending: false }).limit(1).single()
      if (!found) return Response.json({ error: 'not found' }, { status: 404 })
      await supabase.from('repair_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', found.id)
      return Response.json({ ok: true, repair_no: found.repair_no })
    }

    // ── Create new repair order ──
    const {
      customer_name, phone, line_user_id,
      device, description,
      appointment_date, appointment_time,
      price, deposit, note,
    } = body

    if (!customer_name) {
      return Response.json({ error: 'customer_name required' }, { status: 400 })
    }

    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null

    // ── Upsert customer record ──
    let customerId = null
    if (cleanPhone) {
      const { data: existing } = await supabase.from('customers')
        .select('id,name').eq('phone', cleanPhone).single()
      if (existing) {
        customerId = existing.id
        // update name if it was just a phone number before
        if (existing.name === cleanPhone || existing.name === ('0' + cleanPhone)) {
          await supabase.from('customers').update({ name: String(customer_name).trim() }).eq('id', existing.id)
        }
      } else {
        const { data: newCust } = await supabase.from('customers')
          .insert({ name: String(customer_name).trim(), phone: cleanPhone })
          .select('id').single()
        customerId = newCust?.id || null
      }
    }

    // ── Generate REP-xxx ──
    const { data: seq } = await supabase.from('doc_sequences')
      .select('last_seq').eq('prefix', 'REP').eq('year_month', 'all').single()
    const next = (seq?.last_seq || 0) + 1
    await supabase.from('doc_sequences')
      .upsert({ prefix: 'REP', year_month: 'all', last_seq: next }, { onConflict: 'prefix,year_month' })
    const repair_no = `REP-${String(next).padStart(3, '0')}`

    const { error } = await supabase.from('repair_orders').insert({
      repair_no,
      customer_name: String(customer_name).trim(),
      phone:            cleanPhone,
      line_user_id:     line_user_id || null,
      device:           device ? String(device).trim() : 'ไม่ระบุ',
      description:      description ? String(description).trim() : null,
      appointment_date: appointment_date || null,
      appointment_time: appointment_time || null,
      price:            price ? parseFloat(price) : null,
      deposit:          deposit ? parseFloat(deposit) : 0,
      note:             note ? String(note).trim() : null,
      status:           'waiting',
    })

    if (error) throw error

    return Response.json({ ok: true, repair_no, customer_id: customerId })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
