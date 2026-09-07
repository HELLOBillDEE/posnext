import { createClient } from '@supabase/supabase-js'
import { notifyShiftOpen } from '@/lib/telegramStaff'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const body = await req.json()
    const { terminalId, cashierName, shopName, openingCash, openingBreakdown } = body

    // หากะที่ปิดล่าสุดของ terminal นี้
    let prevShift = null
    if (terminalId) {
      const { data } = await supabase.from('shifts')
        .select('id, closed_at, cash_remaining, cashier_name')
        .eq('terminal_id', terminalId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      prevShift = data || null
    }

    notifyShiftOpen({ cashierName, shopName, terminalId, openingCash, openingBreakdown, prevShift }).catch(() => {})
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
