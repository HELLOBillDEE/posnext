import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!file) return Response.json({ error: 'no file' }, { status: 400 })

    const ext  = file.name.split('.').pop().toLowerCase() || 'png'
    const path = `shop-logo.${ext}`
    const buf  = await file.arrayBuffer()

    const { error: upErr } = await supabase.storage
      .from('shop-assets')
      .upload(path, buf, { upsert: true, contentType: file.type || 'image/png' })
    if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

    const { data } = supabase.storage.from('shop-assets').getPublicUrl(path)
    const url = data.publicUrl + '?t=' + Date.now()

    const { error: setErr } = await supabase
      .from('settings')
      .upsert({ key: 'shop_logo', value: url }, { onConflict: 'key' })
    if (setErr) return Response.json({ error: setErr.message }, { status: 500 })

    return Response.json({ url })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
