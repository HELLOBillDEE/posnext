import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { replyMessage, downloadLineImage, buildBillFlexMessage, getLineSettings } from '@/lib/lineApi'

const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
const supabasePos = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const body = await req.json()
    const events = body.events || []

    for (const event of events) {
      const source = event.source || {}

      // บันทึก group ID (เหมือนเดิม)
      if (source.type === 'group' && source.groupId) {
        await supabasePos.from('settings').upsert(
          { key: 'line_group_id', value: source.groupId },
          { onConflict: 'key' }
        )
      }

      const userId = source.userId
      if (!userId) continue

      // ── Postback (cancel scan) ────────────────────────────────────
      if (event.type === 'postback') {
        const params = new URLSearchParams(event.postback?.data || '')
        if (params.get('action') === 'cancel_scan') {
          const scanId = params.get('id')
          await supabasePublic.from('family_pending_scans').delete().eq('id', scanId)
          await replyMessage(event.replyToken, { type: 'text', text: '❌ ยกเลิกบิลแล้ว' })
        }
        continue
      }

      if (event.type !== 'message') continue

      // ── ส่งรูปบิล → AI สแกน ──────────────────────────────────────
      if (event.message?.type === 'image') {
        await handleImageScan(event, userId)
        continue
      }

      // ── ข้อความ ──────────────────────────────────────────────────
      if (event.message?.type === 'text') {
        const text = event.message.text.trim()
        await handleTextCommand(event, userId, text)
      }
    }

    return new Response('OK', { status: 200 })
  } catch (e) {
    console.error('LINE webhook error:', e)
    return new Response('OK', { status: 200 }) // LINE requires 200 always
  }
}

async function handleImageScan(event, userId) {
  // ดึงข้อมูล member + business
  const { data: member } = await supabasePublic
    .from('family_members').select('*, family_businesses(*)').eq('line_user_id', userId).single()

  if (!member) {
    await replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ ยังไม่ได้ลงทะเบียน\nกรุณาแจ้งผู้ดูแลบัญชีเพื่อเพิ่มชื่อในระบบก่อน',
    })
    return
  }

  // แจ้งว่ากำลังอ่าน
  await replyMessage(event.replyToken, { type: 'text', text: '⏳ กำลังอ่านบิล รอสักครู่...' })

  // ดาวน์โหลดรูป
  const base64 = await downloadLineImage(event.message.id)
  if (!base64) {
    const { line_channel_token: token, line_group_id: groupId } = await getLineSettings()
    if (token && groupId) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: '❌ ดาวน์โหลดรูปไม่ได้ ลองใหม่อีกครั้ง' }] }),
      })
    }
    return
  }

  // AI สแกน
  let ai = null
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent([
      { inlineData: { data: base64, mimeType: 'image/jpeg' } },
      `นี่คือใบแจ้งหนี้หรือบิลค่าใช้จ่าย กรุณาอ่านแล้วตอบ raw JSON เท่านั้น ห้ามมี markdown:
{
  "vendor": "ชื่อผู้ออกบิล/เจ้าหนี้",
  "amount": ยอดที่ต้องจ่าย (ตัวเลข ไม่มี comma),
  "due_date": "วันครบกำหนดชำระ YYYY-MM-DD (ถ้าไม่มีให้ใส่ null)",
  "category": "ประเภท: ค่าเช่า/ค่าน้ำไฟ/ค่าวัสดุ/เงินเดือน/ค่าขนส่ง/อื่นๆ",
  "description": "รายละเอียดสั้นๆ"
}`,
    ])
    const text = result.response.text().trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const match = text.match(/\{[\s\S]*\}/)
    if (match) ai = JSON.parse(match[0])
  } catch (e) {
    console.error('AI scan error:', e)
  }

  if (!ai?.amount) {
    const { line_channel_token: token, line_group_id: groupId } = await getLineSettings()
    if (token && groupId) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: '❌ อ่านบิลไม่ได้ ลองถ่ายรูปให้ชัดขึ้น' }] }),
      })
    }
    return
  }

  // บันทึก pending scan
  const { data: scan } = await supabasePublic.from('family_pending_scans').insert({
    line_user_id: userId,
    business_id: member.business_id,
    ai_data: ai,
  }).select().single()

  // ส่ง Flex Message ให้ confirm
  const bizName = member.family_businesses?.name || 'ธุรกิจ'
  const flex = buildBillFlexMessage(scan.id, ai, bizName)
  const { line_channel_token: token, line_group_id: groupId } = await getLineSettings()
  if (token && groupId) {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: groupId, messages: [flex] }),
    })
  }
}

async function handleTextCommand(event, userId, text) {
  // รูปแบบ: "รายรับ 5000" หรือ "income 5000" หรือแค่ตัวเลข
  const incomeMatch = text.match(/^(?:รายรับ|income)\s+([\d,]+)/i)
    || (text.match(/^[\d,]+$/) ? [text, text] : null)

  if (incomeMatch) {
    const amount = parseFloat(incomeMatch[1].replace(/,/g, ''))
    if (isNaN(amount) || amount <= 0) return

    const { data: member } = await supabasePublic
      .from('family_members').select('*, family_businesses(name)').eq('line_user_id', userId).single()
    if (!member) return

    await supabasePublic.from('family_income').insert({
      business_id: member.business_id,
      date: new Date().toISOString().slice(0, 10),
      amount,
      created_by: userId,
    })

    const fmt = n => Number(n).toLocaleString('th-TH')
    await replyMessage(event.replyToken, {
      type: 'text',
      text: `✅ บันทึกรายรับแล้ว\n💰 ฿${fmt(amount)}\n🏢 ${member.family_businesses?.name}\n📅 ${new Date().toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}`,
    })
    return
  }

  // รูปแบบ: "ยืนยัน [scan_id]" (fallback กรณีไม่มี LIFF)
  const confirmMatch = text.match(/^ยืนยัน\s+([a-f0-9-]{36})/i)
  if (confirmMatch) {
    const scanId = confirmMatch[1]
    const { data: scan } = await supabasePublic
      .from('family_pending_scans').select('*').eq('id', scanId).eq('line_user_id', userId).single()
    if (!scan) {
      await replyMessage(event.replyToken, { type: 'text', text: '❌ ไม่พบรายการนี้ หรือหมดอายุแล้ว' })
      return
    }
    await supabasePublic.from('family_bills').insert({
      business_id: scan.business_id,
      vendor: scan.ai_data?.vendor,
      amount: scan.ai_data?.amount,
      due_date: scan.ai_data?.due_date || null,
      category: scan.ai_data?.category,
      ai_data: scan.ai_data,
      created_by: userId,
    })
    await supabasePublic.from('family_pending_scans').delete().eq('id', scanId)
    const fmt = n => Number(n || 0).toLocaleString('th-TH')
    await replyMessage(event.replyToken, {
      type: 'text',
      text: `✅ บันทึกบิลแล้ว\n💰 ฿${fmt(scan.ai_data?.amount)}\n📅 ครบกำหนด: ${scan.ai_data?.due_date || 'ไม่ระบุ'}`,
    })
  }
}

export async function GET() {
  return new Response('LINE webhook OK', { status: 200 })
}
