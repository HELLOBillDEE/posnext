import { notifyDrawer } from '@/lib/telegramStaff'

export async function POST(req) {
  try {
    const { employeeName, shopName, note } = await req.json()
    notifyDrawer({ employeeName, shopName, note }).catch(e => console.error('[notify-drawer]', e?.message))
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
