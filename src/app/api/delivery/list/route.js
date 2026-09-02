import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function GET() {
  const { data } = await supabase
    .from('quotations')
    .select('id,doc_no,customer_name,customer_address,delivery_fee,total,created_at,delivered_at,delivery_token,status')
    .eq('doc_type', 'delivery_invoice')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(100)

  return Response.json(data || [])
}
