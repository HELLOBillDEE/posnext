import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// GET /api/shop — สินค้าที่ลงออนไลน์ (ไม่มี cost)
export async function GET() {
  const [{ data: products }, { data: settings }] = await Promise.all([
    supabase
      .from('products')
      .select('id,name,price,online_price,stock,unit,image_url,search_tags,categories(name)')
      .eq('is_listed_online', true)
      .eq('active', true)
      .gt('stock', 0)
      .order('name'),
    supabase
      .from('settings')
      .select('key,value')
      .in('key', ['shop_name', 'shop_address', 'shop_phone', 'shop_logo', 'line_qr']),
  ])

  const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]))

  return Response.json({ products: products || [], shop: cfg }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
