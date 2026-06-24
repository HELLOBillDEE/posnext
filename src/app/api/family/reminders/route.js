import { createClient } from '@supabase/supabase-js'
import { getLineSettings } from '@/lib/lineApi'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// เรียกได้จาก cron job หรือ manual — ส่งแจ้งเตือนบิลใกล้ครบกำหนด
export async function POST() {
  try {
    const today = new Date()
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7)
    const todayISO = today.toISOString().slice(0, 10)
    const in7ISO  = in7.toISOString().slice(0, 10)

    const { data: bills } = await db.from('family_bills')
      .select('*, family_businesses(name)')
      .eq('status', 'pending')
      .gte('due_date', todayISO)
      .lte('due_date', in7ISO)
      .order('due_date')

    if (!bills?.length) return Response.json({ sent: 0 })

    const { line_channel_token: token, line_group_id: groupId } = await getLineSettings()
    if (!token || !groupId) return Response.json({ error: 'LINE not configured' })

    const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    const lines = bills.map(b => {
      const due = new Date(b.due_date)
      const diff = Math.round((due - today) / 86400000)
      const urgency = diff === 0 ? '🔴 วันนี้!' : diff <= 3 ? `🟠 อีก ${diff} วัน` : `🟡 อีก ${diff} วัน`
      return `${urgency} | ${b.family_businesses?.name} | ${b.vendor || ''} ฿${fmt(b.amount)}`
    })

    const text = `⏰ แจ้งเตือนบิลใกล้ครบกำหนด\n${'─'.repeat(28)}\n${lines.join('\n')}`

    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
    })

    return Response.json({ sent: bills.length })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
