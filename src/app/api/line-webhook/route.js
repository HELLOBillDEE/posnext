import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { replyText, getLineSettings } from '@/lib/lineStaff'
import { triggerDrawerVideo } from '@/lib/cameraRecord'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)
const sbService = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  : ''

const STATUS_LABEL = {
  pending:       'รอรับเครื่อง / รอตรวจสอบ',
  diagnosing:    'กำลังตรวจสอบอาการเสีย',
  waiting_parts: 'รออะไหล่',
  in_progress:   'ช่างกำลังซ่อม',
  done:          'ซ่อมเสร็จแล้ว รอรับเครื่อง',
  delivered:     'ส่งคืนลูกค้าแล้ว',
  cancelled:     'ยกเลิก',
}

/* ── Settings ── */
async function getBotSettings() {
  const { data } = await supabase.from('settings').select('key,value')
    .in('key', ['line_bot_enabled', 'line_bot_name', 'line_bot_persona', 'line_bot_silent_keywords'])
  return data ? Object.fromEntries(data.map(r => [r.key, r.value])) : {}
}
async function getShopSettings() {
  const { data } = await supabase.from('settings').select('key,value')
    .in('key', ['shop_name', 'shop_phone', 'shop_address'])
  return data ? Object.fromEntries(data.map(r => [r.key, r.value])) : {}
}

/* ── Conversation history ── */
async function saveMsg(lineUserId, role, content) {
  await sbService.from('line_conversations').insert({ line_user_id: lineUserId, role, content })
}
async function getHistory(lineUserId) {
  const { data } = await sbService
    .from('line_conversations')
    .select('role,content')
    .eq('line_user_id', lineUserId)
    .order('created_at', { ascending: false })
    .limit(12)
  return (data || []).reverse()
}

/* ── search_product: ตัดคำแต่ละคำ OR ค้นทุก field ── */
async function searchProducts(text) {
  const words = text.split(/\s+/).filter(w => w.length >= 2)
  if (!words.length) return []
  const orParts = words.flatMap(w => [`name.ilike.%${w}%`, `search_tags.ilike.%${w}%`])
  const { data } = await supabase
    .from('products')
    .select('id,name,price,online_price,stock,unit,categories(name)')
    .eq('active', true)
    .or(orParts.join(','))
    .order('stock', { ascending: false })
    .limit(8)
  return data || []
}

/* ── check_repair_status: ค้นด้วย lineUserId / เบอร์ / repair_no ── */
async function checkRepairStatus(lineUserId, text) {
  const results = []
  const seen = new Set()

  const add = (items) => {
    for (const r of (items || [])) {
      if (!seen.has(r.repair_no)) { seen.add(r.repair_no); results.push(r) }
    }
  }

  const sel = 'repair_no,customer_name,device,description,status,appointment_date,appointment_time,note,technician_name,price,deposit'

  // 1. ค้นด้วย LINE user ID อัตโนมัติ
  const { data: byUser } = await supabase
    .from('repair_orders').select(sel)
    .eq('line_user_id', lineUserId)
    .order('created_at', { ascending: false }).limit(3)
  add(byUser)

  // 2. ค้นด้วยเบอร์โทรที่อยู่ในข้อความ
  const phones = text.match(/0\d{8,9}/g) || []
  for (const phone of phones) {
    const { data } = await supabase.from('repair_orders').select(sel)
      .eq('phone', phone).order('created_at', { ascending: false }).limit(3)
    add(data)
  }

  // 3. ค้นด้วย repair_no / เลขที่บิลในข้อความ
  const codes = text.match(/[A-Za-z0-9]{5,}/g) || []
  for (const code of codes) {
    const { data } = await supabase.from('repair_orders').select(sel)
      .ilike('repair_no', `%${code}%`).limit(2)
    add(data)
  }

  return results.slice(0, 5)
}

function repairToText(r) {
  const status = STATUS_LABEL[r.status] || r.status || 'ไม่ระบุ'
  const lines = [
    `📋 บิลซ่อม: ${r.repair_no}`,
    `🔧 อุปกรณ์: ${r.device || '-'}`,
    `📝 อาการ: ${r.description || '-'}`,
    `🔴 สถานะ: ${status}`,
  ]
  if (r.technician_name) lines.push(`👨‍🔧 ช่าง: ${r.technician_name}`)
  if (r.appointment_date) lines.push(`📅 นัดรับ: ${fmtDate(r.appointment_date)}${r.appointment_time ? ` เวลา ${r.appointment_time}` : ''}`)
  if (r.note) lines.push(`💬 หมายเหตุ: ${r.note}`)
  if (r.price) lines.push(`💰 ค่าซ่อม: ฿${fmt(r.price)}${r.deposit ? ` (มัดจำแล้ว ฿${fmt(r.deposit)})` : ''}`)
  return lines.join('\n')
}

/* ── Claude Haiku ── */
async function askClaude({ text, history, products, repairOrders, shopCfg, botCfg }) {
  const shopName = shopCfg?.shop_name || 'ร้านเชิดชัย'
  const botName  = botCfg?.line_bot_name || 'แอดมิน'
  const persona  = botCfg?.line_bot_persona || 'ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง'
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL || ''

  const productSection = products.length > 0
    ? `[ฐานข้อมูลสินค้าที่เกี่ยวข้อง]\n` + products.map(p => {
        const price = p.online_price != null ? p.online_price : p.price
        return `- ${p.name} ราคา ฿${fmt(price)}/${p.unit || 'ชิ้น'}${p.categories?.name ? ` (${p.categories.name})` : ''}`
      }).join('\n')
    : '[ฐานข้อมูลสินค้า] ไม่พบสินค้าที่ตรงกับคำถาม'

  const repairSection = repairOrders.length > 0
    ? `[ฐานข้อมูลคิวซ่อม]\n` + repairOrders.map(repairToText).join('\n\n')
    : '[ฐานข้อมูลคิวซ่อม] ไม่พบงานซ่อมในระบบ (ยังไม่ได้ให้เบอร์โทรหรือเลขบิล)'

  const systemPrompt = `ชื่อคุณคือ "${botName}"
${persona}
ร้าน: ${shopName} โทร: ${shopCfg?.shop_phone || ''} ที่ตั้ง: ${shopCfg?.shop_address || ''}
ลิงก์ดูสินค้าออนไลน์: ${appUrl}/shop

${productSection}

${repairSection}

กฎการทำงาน:
1. อ่านเจตนาลูกค้าก่อนว่าต้องการ "ซื้อสินค้า/สอบถามสเปก" หรือ "ติดตามงานซ่อม/ปรึกษาอาการเสีย"
2. ถามสินค้า → แนะนำจาก [ฐานข้อมูลสินค้า] อธิบายจุดเด่น บอกราคา ห้ามยัดเยียดถ้าลูกค้าไม่ได้ถาม
3. ถามงานซ่อม → ดูข้อมูลจาก [ฐานข้อมูลคิวซ่อม] ก่อน ถ้าไม่พบให้ถามเบอร์โทรหรือเลขบิลซ่อม อย่าแต่งสถานะขึ้นมาเอง
4. ถ้าลูกค้าเล่าอาการเสีย → ให้ความเห็นเบื้องต้นได้ แต่ชวนนำเครื่องมาให้ช่างตรวจ
5. ถ้าข้อมูลไม่มีในระบบ → พูดว่า "เดี๋ยวขออนุญาตเช็คกับช่าง/หลังร้านให้สักครู่นะครับ" แล้วตอบว่า [ESCALATE]
6. ถ้าลูกค้าต้องการคุยกับเจ้าของร้านหรือแอดมินโดยตรง → ตอบว่า [ESCALATE] แล้วบอกว่าจะแจ้งให้
7. ตอบสั้นๆ เป็นธรรมชาติ ไม่เกิน 4-5 ประโยค ลงท้ายด้วย ครับ/ค่ะ เสมอ`

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: text },
  ]

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: systemPrompt,
    messages,
  })

  return res.content[0]?.text || ''
}

/* ── Flex Carousel สินค้า ── */
async function replyProducts(replyToken, lineToken, products, shopName, appUrl) {
  const bubbles = products.slice(0, 10).map(p => {
    const displayPrice = p.online_price != null ? p.online_price : p.price
    const hasDiscount  = p.online_price != null && p.online_price < p.price
    const contents = [
      { type: 'text', text: p.name, weight: 'bold', size: 'sm', wrap: true, color: '#1e293b' },
      {
        type: 'text',
        text: `฿${fmt(displayPrice)} / ${p.unit || 'ชิ้น'}${hasDiscount ? `  (ลดจาก ฿${fmt(p.price)})` : ''}`,
        size: 'lg', weight: 'bold', color: '#C72C41', margin: 'sm',
      },
    ]
    if (p.categories?.name) {
      contents.push({ type: 'text', text: `🏷 ${p.categories.name}`, size: 'xs', color: '#64748b', margin: 'xs' })
    }
    const bubble = {
      type: 'bubble', size: 'micro',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px',
        contents: [{
          type: 'button', style: 'primary', color: '#C72C41', height: 'sm',
          action: { type: 'message', label: '🛒 สนใจสินค้านี้', text: `สนใจสินค้า: ${p.name} ราคา ฿${fmt(displayPrice)}` },
        }],
      },
    }
    if (p.image_url) {
      bubble.hero = { type: 'image', url: p.image_url, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' }
    }
    return bubble
  })

  const messages = [
    { type: 'flex', altText: `พบสินค้า ${products.length} รายการ`, contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles } },
  ]
  if (appUrl) messages.push({ type: 'text', text: `ดูสินค้าทั้งหมด: ${appUrl}/shop` })

  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
    body: JSON.stringify({ replyToken, messages }),
  })
}

const fmtDateShort = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  : ''

/* ════════════════════════════════════════ */
export async function POST(req) {
  try {
    const body = await req.json()
    const events = body.events || []

    const [lineCfg, botCfg, shopCfg] = await Promise.all([
      getLineSettings(),
      getBotSettings(),
      getShopSettings(),
    ])

    if (!lineCfg) return new Response('OK', { status: 200 })
    const lineToken = lineCfg.line_channel_token
    const botEnabled = botCfg?.line_bot_enabled !== 'false'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    for (const event of events) {

      /* ── Postback: staff group อนุมัติ/ปฏิเสธ ── */
      if (event.type === 'postback') {
        const replyToken = event.replyToken
        const data = event.postback?.data || ''
        const [action, idStr] = data.split(':')
        const id = parseInt(idStr)
        if (!id || isNaN(id)) continue

        if (action === 'approve_leave' || action === 'reject_leave') {
          const status = action === 'approve_leave' ? 'approved' : 'rejected'
          const { data: leave } = await supabase.from('leave_requests').update({ status }).eq('id', id)
            .select('date_from,date_to,employees(nickname,name)').single()
          if (leave) {
            const name = leave.employees?.nickname || leave.employees?.name || '?'
            const dateStr = leave.date_from === leave.date_to ? fmtDateShort(leave.date_from) : `${fmtDateShort(leave.date_from)}–${fmtDateShort(leave.date_to)}`
            await replyText(replyToken, lineToken, `${status === 'approved' ? '✅' : '❌'} คำขอลา — ${name} (${dateStr})\n${status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`)
          }
        }
        else if (action === 'approve_advance' || action === 'reject_advance') {
          const status = action === 'approve_advance' ? 'approved' : 'rejected'
          const { data: adv } = await supabase.from('salary_advances').update({ status }).eq('id', id)
            .select('amount,employees(nickname,name)').single()
          if (adv) {
            const name = adv.employees?.nickname || adv.employees?.name || '?'
            await replyText(replyToken, lineToken, `${status === 'approved' ? '✅' : '❌'} คำขอเบิก — ${name} ฿${fmt(adv.amount)}\n${status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`)
          }
        }
        else if (action === 'approve_drawer' || action === 'reject_drawer') {
          const status = action === 'approve_drawer' ? 'approved' : 'rejected'
          const { data: dr } = await supabase.from('drawer_requests').update({ status }).eq('id', id)
            .select('employee_name,note').single()
          if (dr) {
            if (status === 'approved') {
              await supabase.from('drawer_logs').insert({ employee_name: dr.employee_name, note: `คำขออนุมัติ${dr.note ? ` — ${dr.note}` : ''}` })
              const now = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
              triggerDrawerVideo(`🔓 เปิดลิ้นชัก — ${dr.employee_name}  🕐 ${now}`)
            }
            await replyText(replyToken, lineToken, `${status === 'approved' ? '✅' : '❌'} คำขอเปิดลิ้นชัก — ${dr.employee_name}\n${status === 'approved' ? 'อนุมัติแล้ว — เปิดลิ้นชักแล้ว' : 'ไม่อนุมัติ'}`)
          }
        }
        continue
      }

      /* ── Message จากลูกค้า ── */
      if (event.type !== 'message' || event.message?.type !== 'text') continue
      if (!botEnabled) continue

      const replyToken = event.replyToken
      const lineUserId = event.source?.userId || 'unknown'
      const text = (event.message.text || '').trim()
      if (!text) continue

      // ตรวจ silent keywords
      const silentKeywords = (botCfg?.line_bot_silent_keywords || '').split(',').map(k => k.trim()).filter(Boolean)
      if (silentKeywords.some(k => k && text.includes(k))) {
        await saveMsg(lineUserId, 'user', text)
        continue
      }

      // ดึง history + ค้นสินค้า + เช็คคิวซ่อม พร้อมกัน
      const [history, products, repairOrders] = await Promise.all([
        getHistory(lineUserId),
        searchProducts(text),
        checkRepairStatus(lineUserId, text),
      ])

      await saveMsg(lineUserId, 'user', text)

      const aiReply = await askClaude({ text, history, products, repairOrders, shopCfg, botCfg })

      if (aiReply.startsWith('[SILENT]')) continue

      if (aiReply.includes('[ESCALATE]')) {
        const msg = aiReply.replace('[ESCALATE]', '').trim() ||
          `ขอโทษด้วยนะครับ เรื่องนี้จะแจ้งเจ้าของร้านให้ติดต่อกลับโดยเร็วที่สุดเลยครับ 🙏`
        await replyText(replyToken, lineToken, msg)
        await saveMsg(lineUserId, 'assistant', msg)
        continue
      }

      // ถ้า AI พูดถึงสินค้าและมีผลลัพธ์สินค้า → ส่ง Flex ตามหลัง
      const productMentioned = products.length > 0 &&
        products.some(p => p.name.split(/\s+/).some(w => w.length >= 2 && aiReply.includes(w)))

      await replyText(replyToken, lineToken, aiReply)
      await saveMsg(lineUserId, 'assistant', aiReply)

      if (productMentioned) {
        // ส่ง Flex เพิ่มเติมโดยใช้ push (replyToken ใช้ได้แค่ครั้งเดียว)
        if (lineUserId !== 'unknown') {
          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
            body: JSON.stringify({
              to: lineUserId,
              messages: [{
                type: 'flex',
                altText: `สินค้าที่แนะนำ ${products.length} รายการ`,
                contents: products.length === 1 ? (() => {
                  const p = products[0]
                  const displayPrice = p.online_price != null ? p.online_price : p.price
                  return {
                    type: 'bubble', size: 'micro',
                    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [
                      { type: 'text', text: p.name, weight: 'bold', size: 'sm', wrap: true },
                      { type: 'text', text: `฿${fmt(displayPrice)}`, size: 'xl', weight: 'bold', color: '#C72C41', margin: 'sm' },
                    ]},
                    footer: { type: 'box', layout: 'vertical', paddingAll: '10px', contents: [{
                      type: 'button', style: 'primary', color: '#C72C41', height: 'sm',
                      action: { type: 'message', label: '🛒 สนใจสินค้านี้', text: `สนใจสินค้า: ${p.name}` },
                    }]},
                  }
                })() : {
                  type: 'carousel',
                  contents: products.slice(0, 8).map(p => {
                    const displayPrice = p.online_price != null ? p.online_price : p.price
                    return {
                      type: 'bubble', size: 'micro',
                      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [
                        { type: 'text', text: p.name, weight: 'bold', size: 'sm', wrap: true },
                        { type: 'text', text: `฿${fmt(displayPrice)}/${p.unit||'ชิ้น'}`, size: 'lg', weight: 'bold', color: '#C72C41', margin: 'sm' },
                      ]},
                      footer: { type: 'box', layout: 'vertical', paddingAll: '10px', contents: [{
                        type: 'button', style: 'primary', color: '#C72C41', height: 'sm',
                        action: { type: 'message', label: '🛒 สนใจ', text: `สนใจสินค้า: ${p.name}` },
                      }]},
                    }
                  }),
                },
              }],
            }),
          })
        }
      }
    }

    return new Response('OK', { status: 200 })
  } catch (e) {
    console.error('[line-webhook]', e.message)
    return new Response('OK', { status: 200 })
  }
}

export async function GET() {
  return new Response('LINE webhook OK', { status: 200 })
}
