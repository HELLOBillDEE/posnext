import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function GET() {
  const [{ data: pending }, { data: done }] = await Promise.all([
    supabase.from('quotations')
      .select('id,doc_no,customer_name,customer_address,delivery_fee,total,created_at,delivery_token,status')
      .eq('doc_type', 'delivery_invoice')
      .not('status', 'in', '("cancelled","delivered")')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('quotations')
      .select('id,doc_no,customer_name,customer_address,delivery_fee,total,created_at,delivered_at,delivery_token,status')
      .eq('doc_type', 'delivery_invoice')
      .eq('status', 'delivered')
      .order('delivered_at', { ascending: false })
      .limit(50),
  ])

  return Response.json({ pending: pending || [], done: done || [] }, {
    headers: { 'Cache-Control': 'no-store' }
  })
}
