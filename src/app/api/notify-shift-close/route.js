import { notifyShiftClose } from '@/lib/telegramStaff'

export async function POST(req) {
  try {
    const body = await req.json()
    notifyShiftClose(body).catch(() => {})
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
