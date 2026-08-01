import { notifyDrawer } from '@/lib/telegramStaff'

export async function POST(req) {
  try {
    const body = await req.json()
    const { employeeName, shopName, note } = body

    notifyDrawer({ employeeName, shopName, note }).catch(e => console.error('[notify-drawer]', e?.message))

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
