export async function POST(req) {
  try {
    const { sale, line_channel_token, line_group_id } = await req.json()
    if (!sale || !line_channel_token || !line_group_id) {
      return Response.json({ skipped: true, reason: 'LINE not configured' })
    }

    const itemLines = (sale.items || [])
      .map(i => `• ${i.name} ×${i.qty} = ฿${Number(i.price * i.qty - (i.disc || 0)).toLocaleString('th-TH')}`)
      .join('\n')

    const text = [
      `🛒 ${sale.shopName || 'ร้านค้า'}`,
      `📄 ${sale.receipt_no}`,
      itemLines,
      `💰 รวม ฿${Number(sale.total || 0).toLocaleString('th-TH')}`,
    ].join('\n')

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${line_channel_token}`,
      },
      body: JSON.stringify({ to: line_group_id, messages: [{ type: 'text', text }] }),
    })
    const json = await res.json()
    return Response.json({ ok: res.ok, line: json })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
