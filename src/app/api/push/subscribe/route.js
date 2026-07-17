import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { subscription, label } = await req.json()
    const { endpoint, keys: { p256dh, auth } } = subscription
    await supabase.from('push_subscriptions').upsert(
      { endpoint, p256dh, auth, label: label || null },
      { onConflict: 'endpoint' }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const { endpoint } = await req.json()
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
