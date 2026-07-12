import { notifySale } from '@/lib/telegramStaff'

export async function POST(req) {
  try {
    const { sale } = await req.json()
    if (!sale) return Response.json({ skipped: true, reason: 'no sale data' })
    notifySale(sale).catch(e => console.error('[notify-sale]', e?.message))
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
