import { notifySale } from '@/lib/telegramStaff'

export async function POST(req) {
  try {
    const { sale } = await req.json()
    if (!sale) return Response.json({ error: 'no sale' }, { status: 400 })
    notifySale(sale).catch(() => {})
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
