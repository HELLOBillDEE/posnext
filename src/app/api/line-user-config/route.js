import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const sbService = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  const { line_user_id, ai_paused } = await req.json()
  if (!line_user_id) return Response.json({ error: 'missing line_user_id' }, { status: 400 })

  const { error } = await sbService.from('line_user_config').upsert(
    { line_user_id, ai_paused, updated_at: new Date().toISOString() },
    { onConflict: 'line_user_id' }
  )
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, ai_paused })
}
