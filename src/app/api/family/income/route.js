import { createClient } from '@supabase/supabase-js'
import { checkFamilyAuth } from '../_auth'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(req) {
  if (!checkFamilyAuth(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { business_id, date, amount, note, line_user_id } = await req.json()
    if (!business_id || !amount) return Response.json({ error: 'missing fields' }, { status: 400 })

    const { data, error } = await db.from('family_income').insert({
      business_id,
      date: date || new Date().toISOString().slice(0, 10),
      amount: Number(amount),
      note,
      created_by: line_user_id,
    }).select().single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req) {
  if (!checkFamilyAuth(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const bizId = searchParams.get('business_id')
  const month = searchParams.get('month')
  if (!bizId) return Response.json({ error: 'missing business_id' }, { status: 400 })

  let q = db.from('family_income').select('*').eq('business_id', bizId).order('date', { ascending: false })
  if (month) q = q.gte('date', `${month}-01`).lte('date', `${month}-31`)
  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
