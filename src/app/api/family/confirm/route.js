import { createClient } from '@supabase/supabase-js'
import { getLineSettings } from '@/lib/lineApi'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// LIFF เรียกเพื่อ confirm บิลหลัง AI สแกน
export async function POST(req) {
  try {
    const { scanId, lineUserId, overrides } = await req.json()
    if (!scanId || !lineUserId) return Response.json({ error: 'missing params' }, { status: 400 })

    const { data: scan } = await db.from('family_pending_scans')
      .select('*').eq('id', scanId).eq('line_user_id', lineUserId).single()
    if (!scan) return Response.json({ error: 'ไม่พบรายการ หรือหมดอายุแล้ว' }, { status: 404 })

    const ai = { ...scan.ai_data, ...overrides }

    await db.from('family_bills').insert({
      business_id: scan.business_id,
      vendor: ai.vendor,
      amount: ai.amount,
      due_date: ai.due_date || null,
      category: ai.category || 'อื่นๆ',
      ai_data: ai,
      note: overrides?.note,
      created_by: lineUserId,
    })
    await db.from('family_pending_scans').delete().eq('id', scanId)

    // แจ้งกลุ่ม LINE
    const { line_channel_token: token, line_group_id: groupId } = await getLineSettings()
    if (token && groupId) {
      const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      const dueText = ai.due_date
        ? new Date(ai.due_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
        : 'ไม่ระบุ'
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: groupId,
          messages: [{ type: 'text', text: `✅ บันทึกบิลแล้ว\n🏢 ${ai.vendor || ''}\n💰 ฿${fmt(ai.amount)}\n📅 ครบกำหนด ${dueText}` }],
        }),
      })
    }

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// GET pending scan สำหรับ LIFF
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const scanId = searchParams.get('id')
  if (!scanId) return Response.json({ error: 'missing id' }, { status: 400 })

  const { data } = await db.from('family_pending_scans').select('*, family_businesses(name,color)').eq('id', scanId).single()
  if (!data) return Response.json({ error: 'ไม่พบรายการ' }, { status: 404 })
  return Response.json(data)
}
