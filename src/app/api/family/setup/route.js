import { createClient } from '@supabase/supabase-js'
import { checkFamilyAuth } from '../_auth'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET(req) {
  if (!checkFamilyAuth(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const [{ data: businesses }, { data: members }] = await Promise.all([
    db.from('family_businesses').select('*').order('created_at'),
    db.from('family_members').select('*, family_businesses(name)').order('created_at'),
  ])
  return Response.json({ businesses: businesses || [], members: members || [] })
}

export async function POST(req) {
  if (!checkFamilyAuth(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json()

    if (body.type === 'business') {
      const { data, error } = await db.from('family_businesses').insert({
        name: body.name,
        color: body.color || '#1a56c4',
      }).select().single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true, data })
    }

    if (body.type === 'member') {
      const { data, error } = await db.from('family_members').upsert({
        line_user_id: body.line_user_id,
        display_name: body.display_name,
        role: body.role || 'owner',
        business_id: body.business_id || null,
      }, { onConflict: 'line_user_id' }).select().single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true, data })
    }

    return Response.json({ error: 'invalid type' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
