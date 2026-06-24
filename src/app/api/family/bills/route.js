import { createClient } from '@supabase/supabase-js'
import { checkFamilyAuth } from '../_auth'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET(req) {
  if (!checkFamilyAuth(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const bizId = searchParams.get('business_id')
  const status = searchParams.get('status')
  if (!bizId) return Response.json({ error: 'missing business_id' }, { status: 400 })

  let q = db.from('family_bills').select('*').eq('business_id', bizId).order('due_date', { ascending: true })
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function PATCH(req) {
  if (!checkFamilyAuth(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { id, status, paid_at } = await req.json()
    if (!id || !status) return Response.json({ error: 'missing fields' }, { status: 400 })

    const { data, error } = await db.from('family_bills')
      .update({ status, paid_at: paid_at || (status === 'paid' ? new Date().toISOString().slice(0, 10) : null) })
      .eq('id', id).select().single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
