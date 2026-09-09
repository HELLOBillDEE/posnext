import { GoogleGenerativeAI } from '@google/generative-ai'
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
const genAI = new GoogleGenerativeAI(process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_AI_API_KEY || '')

const T_BUY      = '__buy__'
const T_REPAIR   = '__repair__'
const T_DELIVERY = '__delivery__'
const AWAIT_DELIVERY = '__awaiting_delivery__'
const AWAIT_REPAIR   = '__awaiting_repair__'

const REPAIR_KEYWORDS = ['ซ่อม', 'repair', 'บิลซ่อม', 'คิวซ่อม', 'งานซ่อม', 'เสีย', 'แก้ไข']

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
const fmtDate = d => d
  ? new Date(d.includes('T') ? d : d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  : ''

const STATUS_LABEL = {
  pending:       'รอรับเครื่อง / รอตรวจสอบ',
  diagnosing:    'กำลังตรวจสอบอาการเสีย',
  waiting_parts: 'รออะไหล่',
  in_progress:   'ช่างกำลังซ่อม',
  done:          'ซ่อมเสร็จแล้ว — รอรับเครื่อง',
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
    .from('line_conversations').select('role,content')
    .eq('line_user_id', lineUserId)
    .order('created_at', { ascending: false }).limit(12)
  return (data || []).reverse()
}
async function getLastBotMsg(lineUserId) {
  const { data } = await sbService
    .from('line_conversations').select('content')
    .eq('line_user_id', lineUserId).eq('role', 'assistant')
    .order('created_at', { ascending: false }).limit(1)
  return data?.[0]?.content || ''
}

/* ── Product search ── */
async function searchProducts(text) {
  const words = text.split(/\s+/).filter(w => w.length >= 2)
  if (!words.length) return []
  const orParts = words.flatMap(w => [`name.ilike.%${w}%`, `search_tags.ilike.%${w}%`])
  const { data } = await supabase.from('products')
    .select('id,name,price,online_price,stock,unit,categories(name)')
    .eq('active', true).or(orParts.join(','))
    .order('stock', { ascending: false }).limit(8)
  return data || []
}

/* ── Repair lookup ── */
function repairToText(r) {
  const status = STATUS_LABEL[r.status] || r.status || '-'
  const lines = [
    `📋 บิล: ${r.repair_no} | ลูกค้า: ${r.customer_name || '-'}`,
    `🔧 ${r.device || '-'} — ${r.description || '-'}`,
    `🔴 สถานะ: ${status}`,
  ]
  if (r.technician_name) lines.push(`👨‍🔧 ช่าง: ${r.technician_name}`)
  if (r.appointment_date) lines.push(`📅 นัด: ${fmtDate(r.appointment_date)}${r.appointment_time ? ` ${r.appointment_time}` : ''}`)
  if (r.note) lines.push(`💬 ${r.note}`)
  if (r.price > 0) {
    const remain = (r.price || 0) - (r.deposit || 0)
    lines.push(`💰 ค่าซ่อม ฿${fmt(r.price)}${r.deposit > 0 ? ` (มัดจำ ฿${fmt(r.deposit)} คงเหลือ ฿${fmt(remain)})` : ''}`)
  }
  return lines.join('\n')
}

async function checkRepairStatus(lineUserId, text) {
  const results = []
  const seen = new Set()
  const add = (items) => {
    for (const r of (items || [])) {
      if (!seen.has(r.repair_no)) { seen.add(r.repair_no); results.push(r) }
    }
  }
  const sel = 'repair_no,customer_name,device,description,status,appointment_date,appointment_time,note,technician_name,price,deposit'
  const { data: byUser } = await supabase.from('repair_orders').select(sel)
    .eq('line_user_id', lineUserId).order('created_at', { ascending: false }).limit(3)
  add(byUser)
  const phones = text.match(/0\d{8,9}/g) || []
  for (const ph of phones) {
    const { data } = await supabase.from('repair_orders').select(sel).eq('phone', ph).limit(3)
    add(data)
  }
  const words = text.split(/\s+/).filter(w => w.length >= 2 && !/^\d+$/.test(w))
  for (const w of words.slice(0, 3)) {
    const { data } = await supabase.from('repair_orders').select(sel).ilike('customer_name', `%${w}%`).limit(3)
    add(data)
  }
  const codes = text.match(/[A-Z0-9]{5,}/gi) || []
  for (const c of codes.slice(0, 2)) {
    const { data } = await supabase.from('repair_orders').select(sel).ilike('repair_no', `%${c}%`).limit(2)
    add(data)
  }
  // ค้นเลขคิวสั้น เช่น "115" → ค้นหา repair_no ที่ลงท้ายด้วย 115 หรือมี 115 อยู่
  const nums = text.match(/\d{2,}/g) || []
  for (const n of nums.slice(0, 3)) {
    const { data } = await supabase.from('repair_orders').select(sel).ilike('repair_no', `%${n}%`).limit(2)
    add(data)
  }
  return results.slice(0, 5)
}

/* ── Delivery lookup ── */
async function checkDelivery(text) {
  const sel = 'doc_no,customer_name,customer_phone,customer_address,items,total,delivery_fee,status,delivered_at,delivery_token'
  const results = []
  const seen = new Set()
  const add = (items) => {
    for (const r of (items || [])) {
      if (!seen.has(r.doc_no)) { seen.add(r.doc_no); results.push(r) }
    }
  }
  const base = supabase.from('quotations').select(sel)
    .eq('doc_type', 'delivery_invoice').neq('status', 'cancelled')

  // ค้นด้วยเบอร์โทร
  const phones = text.match(/0\d{8,9}/g) || []
  for (const p of phones) {
    const { data } = await base.eq('customer_phone', p).limit(5)
    add(data)
  }
  // ค้นด้วยชื่อลูกค้า
  const words = text.replace(/0\d{8,9}/g, '').split(/\s+/).filter(w => w.length >= 2 && !/^\d+$/.test(w))
  for (const w of words.slice(0, 3)) {
    const { data } = await base.ilike('customer_name', `%${w}%`).limit(3)
    add(data)
  }
  // ค้นด้วยเลขบิล/เลขคิว เช่น "INV-001" หรือ "001"
  const codes = text.match(/[A-Z0-9\-]{3,}/gi) || []
  for (const c of codes.slice(0, 3)) {
    const { data } = await base.ilike('doc_no', `%${c}%`).limit(2)
    add(data)
  }
  const nums = text.match(/\d{2,}/g) || []
  for (const n of nums.slice(0, 3)) {
    const { data } = await base.ilike('doc_no', `%${n}%`).limit(2)
    add(data)
  }
  return results.slice(0, 5)
}

function deliveryFlexBubble(d, appUrl) {
  const isDone    = d.status === 'delivered'
  const statusTxt = isDone ? 'ส่งแล้ว ✅' : 'รอจัดส่ง 📦'
  const statusClr = isDone ? '#16a34a' : '#d97706'
  const itemRows  = (d.items || []).map(i => ({
    type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: `• ${i.name}`, size: 'sm', color: '#374151', flex: 4, wrap: true },
      { type: 'text', text: `x${i.qty || 1}`, size: 'sm', color: '#6b7280', flex: 1, align: 'end' },
    ],
  }))

  const bodyContents = [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: '🚚 สถานะการจัดส่ง', weight: 'bold', size: 'md', color: '#1e293b', flex: 1 },
      { type: 'text', text: statusTxt, size: 'sm', color: statusClr, align: 'end' },
    ]},
    { type: 'separator', margin: 'md' },
    { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
      { type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: 'เลขบิล', size: 'xs', color: '#6b7280', flex: 2 },
        { type: 'text', text: d.doc_no || '-', size: 'xs', color: '#1e293b', flex: 3, align: 'end' },
      ]},
      { type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: 'ลูกค้า', size: 'xs', color: '#6b7280', flex: 2 },
        { type: 'text', text: d.customer_name || '-', size: 'xs', color: '#1e293b', flex: 3, align: 'end', wrap: true },
      ]},
      ...(d.customer_address ? [{ type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: 'ที่อยู่', size: 'xs', color: '#6b7280', flex: 2 },
        { type: 'text', text: d.customer_address, size: 'xs', color: '#1e293b', flex: 3, align: 'end', wrap: true },
      ]}] : []),
      { type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: 'ยอดรวม', size: 'xs', color: '#6b7280', flex: 2 },
        { type: 'text', text: `฿${fmt(d.total)}${d.delivery_fee > 0 ? ` (+ค่าส่ง ฿${fmt(d.delivery_fee)})` : ''}`, size: 'xs', color: '#C72C41', flex: 3, align: 'end', weight: 'bold' },
      ]},
      ...(d.delivered_at ? [{ type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: 'ส่งเมื่อ', size: 'xs', color: '#6b7280', flex: 2 },
        { type: 'text', text: fmtDate(d.delivered_at), size: 'xs', color: '#1e293b', flex: 3, align: 'end' },
      ]}] : []),
    ]},
    { type: 'separator', margin: 'md' },
    { type: 'text', text: 'รายการสินค้า', size: 'xs', color: '#6b7280', margin: 'md' },
    { type: 'box', layout: 'vertical', margin: 'sm', spacing: 'xs', contents: itemRows },
  ]

  const footerContents = []
  if (d.delivery_token && appUrl && !isDone) {
    footerContents.push({
      type: 'button', style: 'primary', color: '#1a73e8', height: 'sm',
      action: { type: 'uri', label: '🗺️ ติดตามตำแหน่งคนส่ง', uri: `${appUrl}/delivery/track/${d.delivery_token}` },
    })
  }

  return {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: bodyContents },
    ...(footerContents.length ? { footer: { type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm', contents: footerContents } } : {}),
  }
}

function deliveryFlexMsg(docs, appUrl) {
  const bubbles = docs.map(d => deliveryFlexBubble(d, appUrl))
  return {
    type: 'flex',
    altText: `🚚 สถานะการจัดส่ง (${docs.length} รายการ)`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
  }
}

/* ── LINE helpers ── */
async function lineReply(replyToken, lineToken, messages) {
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
    body: JSON.stringify({ replyToken, messages }),
  })
}
async function linePush(to, lineToken, messages) {
  return fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
    body: JSON.stringify({ to, messages }),
  })
}

async function sendMenu(replyToken, lineToken, shopName) {
  return lineReply(replyToken, lineToken, [{
    type: 'text',
    text: `สวัสดีครับ 👋 ยินดีต้อนรับสู่ ${shopName || 'ร้านเชิดชัย'}\nต้องการสอบถามเรื่องอะไรครับ?`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '🛒 สั่งซื้อสินค้า', text: T_BUY } },
        { type: 'action', action: { type: 'message', label: '🔧 คิวซ่อม',        text: T_REPAIR } },
        { type: 'action', action: { type: 'message', label: '🚚 คิวส่งของ',      text: T_DELIVERY } },
      ],
    },
  }])
}

/* ── Claude Haiku ── */
async function askClaude({ text, history, products, repairOrders, shopCfg, botCfg }) {
  const shopName = shopCfg?.shop_name || 'ร้านเชิดชัย'
  const botName  = botCfg?.line_bot_name || 'แอดมิน'
  const persona  = botCfg?.line_bot_persona || 'ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง'
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL || ''

  const productSection = products.length > 0
    ? `[ฐานข้อมูลสินค้า]\n` + products.map(p => {
        const price = p.online_price != null ? p.online_price : p.price
        return `- ${p.name} ฿${fmt(price)}/${p.unit || 'ชิ้น'}${p.categories?.name ? ` (${p.categories.name})` : ''}`
      }).join('\n')
    : '[ฐานข้อมูลสินค้า] ไม่พบสินค้าที่ตรงกับคำถาม'

  const repairSection = repairOrders.length > 0
    ? `[ฐานข้อมูลคิวซ่อม]\n` + repairOrders.map(repairToText).join('\n\n')
    : '[ฐานข้อมูลคิวซ่อม] ไม่พบงานซ่อม'

  const system = `ชื่อคุณคือ "${botName}" — ${persona}
ร้าน: ${shopName} โทร: ${shopCfg?.shop_phone || ''} ที่ตั้ง: ${shopCfg?.shop_address || ''}

${productSection}

${repairSection}

นโยบายการจัดส่ง:
- พื้นที่เขตเทศบาล: ส่งฟรี เมื่อซื้อขั้นต่ำ 2,000 บาทขึ้นไป
- เขตอื่นๆ: มีค่าจัดส่งเริ่มต้น 150-200 บาท ขึ้นอยู่กับระยะทางและจำนวนรอบรถ
- การจัดส่งอาจต้องรอคิว เพราะส่วนใหญ่มีคิวก่อนหน้า และบางรายการต้องใช้เวลาเตรียม
- หากต้องการด่วน สามารถสั่งไว้แล้วมารับหน้าร้านได้เลย

กฎ:
1. ถามสินค้า → แนะนำจาก [ฐานข้อมูลสินค้า] บอกราคา จุดเด่น ถ้าไม่พบในระบบ ห้ามบอกว่า "ไม่มี" — ให้ถามรายละเอียดเพิ่มก่อน เช่น ใช้ทำอะไร ยี่ห้อ หรือขอรูปสินค้า เพราะอาจเรียกชื่อต่างกัน แล้วตอบ [ESCALATE] ต่อท้ายเพื่อแจ้งให้แอดมินมาช่วยต่อ
2. ถามงานซ่อม → ดูจาก [ฐานข้อมูลคิวซ่อม] ถ้าไม่พบให้ถามเบอร์/เลขบิล ถ้าลูกค้าถามต่อเนื่องเรื่องซ่อม (ราคา สถานะ ฯลฯ) ให้ตอบจาก context สนทนา
3. ลูกค้าต้องการคุยกับคน หรือเรื่องซับซ้อนเกินบอท → ตอบ [ESCALATE]
4. ไม่รู้เจตนา หรือทักทายทั่วไป → ตอบ [MENU]
5. ตอบภาษาไทย สั้นๆ เป็นธรรมชาติ ลงท้าย ครับ/ค่ะ`

  // กรองให้ history สลับ user/model และต้องจบด้วย model เสมอ
  const safeHistory = []
  for (const m of history) {
    if (safeHistory.length === 0) {
      if (m.role === 'user') safeHistory.push(m)
    } else {
      const last = safeHistory[safeHistory.length - 1]
      if (m.role !== last.role) safeHistory.push(m)
    }
  }
  if (safeHistory.length > 0 && safeHistory[safeHistory.length - 1].role === 'user') {
    safeHistory.pop()
  }

  const geminiHistory = safeHistory.map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }))

  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' })
  const chat = model.startChat({
    history: [
      { role: 'user', parts: [{ text: system }] },
      { role: 'model', parts: [{ text: 'เข้าใจครับ พร้อมช่วยเหลือลูกค้า' }] },
      ...geminiHistory,
    ],
  })
  const result = await chat.sendMessage(text)
  return result.response.text()
}

/* ════════════════ MAIN HANDLER ════════════════ */
export async function POST(req) {
  try {
    const body   = await req.json()
    const events = body.events || []

    const [lineCfg, botCfg, shopCfg] = await Promise.all([
      getLineSettings(), getBotSettings(), getShopSettings(),
    ])
    if (!lineCfg) return new Response('OK', { status: 200 })

    const lineToken  = lineCfg.line_channel_token
    const botEnabled = botCfg?.line_bot_enabled !== 'false'
    const appUrl     = process.env.NEXT_PUBLIC_APP_URL || ''
    const shopName   = shopCfg?.shop_name || 'ร้านเชิดชัย'

    for (const event of events) {

      /* ── Postback: staff อนุมัติ/ปฏิเสธ ── */
      if (event.type === 'postback') {
        const replyToken = event.replyToken
        const data = event.postback?.data || ''
        const [action, idStr] = data.split(':')
        const id = parseInt(idStr)
        if (!id || isNaN(id)) continue

        if (action === 'approve_leave' || action === 'reject_leave') {
          const s = action === 'approve_leave' ? 'approved' : 'rejected'
          const { data: r } = await supabase.from('leave_requests').update({ status: s }).eq('id', id)
            .select('date_from,date_to,employees(nickname,name)').single()
          if (r) {
            const name = r.employees?.nickname || r.employees?.name || '?'
            const ds = r.date_from === r.date_to ? fmtDate(r.date_from) : `${fmtDate(r.date_from)}–${fmtDate(r.date_to)}`
            await replyText(replyToken, lineToken, `${s === 'approved' ? '✅' : '❌'} คำขอลา — ${name} (${ds})\n${s === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`)
          }
        } else if (action === 'approve_advance' || action === 'reject_advance') {
          const s = action === 'approve_advance' ? 'approved' : 'rejected'
          const { data: r } = await supabase.from('salary_advances').update({ status: s }).eq('id', id)
            .select('amount,employees(nickname,name)').single()
          if (r) {
            const name = r.employees?.nickname || r.employees?.name || '?'
            await replyText(replyToken, lineToken, `${s === 'approved' ? '✅' : '❌'} คำขอเบิก — ${name} ฿${fmt(r.amount)}\n${s === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`)
          }
        } else if (action === 'approve_drawer' || action === 'reject_drawer') {
          const s = action === 'approve_drawer' ? 'approved' : 'rejected'
          const { data: r } = await supabase.from('drawer_requests').update({ status: s }).eq('id', id)
            .select('employee_name,note').single()
          if (r) {
            if (s === 'approved') {
              await supabase.from('drawer_logs').insert({ employee_name: r.employee_name, note: `คำขออนุมัติ${r.note ? ` — ${r.note}` : ''}` })
              const now = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
              triggerDrawerVideo(`🔓 เปิดลิ้นชัก — ${r.employee_name}  🕐 ${now}`)
            }
            await replyText(replyToken, lineToken, `${s === 'approved' ? '✅' : '❌'} คำขอเปิดลิ้นชัก — ${r.employee_name}\n${s === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}`)
          }
        }
        continue
      }

      /* ── Message: รูปภาพ → Gemini Vision อ่านสินค้า ── */
      if (event.type === 'message' && event.message?.type === 'image' && botEnabled) {
        const replyToken = event.replyToken
        const lineUserId = event.source?.userId || 'unknown'
        try {
          const imgRes = await fetch(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
            headers: { Authorization: `Bearer ${lineToken}` },
          })
          const imgBuf  = await imgRes.arrayBuffer()
          const b64     = Buffer.from(imgBuf).toString('base64')
          const mimeType = imgRes.headers.get('content-type') || 'image/jpeg'

          const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' })
          const result = await model.generateContent([
            { inlineData: { data: b64, mimeType } },
            `ดูรูปนี้แล้วบอกว่าเป็นสินค้าอะไร ใช้ทำอะไร และถ้าเห็นชื่อยี่ห้อหรือรุ่นบอกด้วย ตอบภาษาไทยสั้นๆ`,
          ])
          const vision = result.response.text()

          const products = await searchProducts(vision)
          let reply = `🔍 จากรูปที่ส่งมา: ${vision}`
          if (products.length > 0) {
            reply += `\n\n📦 สินค้าใกล้เคียงในร้าน:\n` +
              products.map(p => `• ${p.name} ฿${fmt(p.online_price ?? p.price)}/${p.unit || 'ชิ้น'}`).join('\n')
            await lineReply(replyToken, lineToken, [{ type: 'text', text: reply }])
            await saveMsg(lineUserId, 'user', '[รูปภาพ]')
            await saveMsg(lineUserId, 'assistant', reply)
          } else {
            // ยังไม่พบในระบบ → ถามรายละเอียดก่อน แล้วแจ้งแอดมินมาช่วย
            const askReply = `🔍 เห็นรูปแล้วครับ: ${vision}\n\nช่วยบอกรายละเอียดเพิ่มเติมได้มั้ยครับ? เช่น ใช้ทำอะไร ยี่ห้อ หรือสเปคที่ต้องการ ทีมงานจะช่วยหาให้โดยเร็วครับ 🙏`
            await replyText(replyToken, lineToken, askReply)
            await saveMsg(lineUserId, 'user', '[รูปภาพ]')
            await saveMsg(lineUserId, 'assistant', askReply)
          }
        } catch (e) {
          await lineReply(replyToken, lineToken, [{ type: 'text', text: `ขออภัยครับ อ่านรูปไม่ได้: ${e.message}` }])
        }
        continue
      }

      /* ── Message ── */
      if (event.type !== 'message' || event.message?.type !== 'text') continue
      if (!botEnabled) continue

      const replyToken = event.replyToken
      const lineUserId = event.source?.userId || 'unknown'
      const text = (event.message.text || '').trim()
      if (!text) continue

      const lastBotMsg = await getLastBotMsg(lineUserId)

      // ตรวจ silent keywords (ยกเว้นถ้าเป็น repair keyword หรืออยู่ใน AWAIT_REPAIR state)
      const silentKw = (botCfg?.line_bot_silent_keywords || '').split(',').map(k => k.trim()).filter(Boolean)
      const isRepairRelated = REPAIR_KEYWORDS.some(k => text.includes(k)) || lastBotMsg === AWAIT_REPAIR
      if (!isRepairRelated && silentKw.some(k => k && text.includes(k))) {
        await saveMsg(lineUserId, 'user', text)
        continue
      }

      /* ── Quick Reply: สั่งซื้อสินค้า ── */
      if (text === T_BUY) {
        await saveMsg(lineUserId, 'user', text)
        const reply = `🛒 สั่งซื้อสินค้าได้เลยครับ!\n\nส่งรายการที่ต้องการมาในแชทนี้ หรือโทรมาสั่งที่ ${shopCfg?.shop_phone || ''} ครับ`
        await lineReply(replyToken, lineToken, [{ type: 'text', text: reply }])
        await saveMsg(lineUserId, 'assistant', reply)
        continue
      }

      /* ── Quick Reply: คิวซ่อม ── */
      if (text === T_REPAIR) {
        await saveMsg(lineUserId, 'user', text)
        const msg = `🔧 เช็คสถานะงานซ่อมได้เลยครับ!\n\nกรุณาส่ง เลขคิวซ่อม หรือ เบอร์โทรศัพท์ ที่ใช้ฝากซ่อมมาได้เลยครับ 🙏`
        await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
        await saveMsg(lineUserId, 'assistant', AWAIT_REPAIR)
        continue
      }

      /* ── ตรวจสอบ flow คิวซ่อม: รอข้อมูลลูกค้า ── */
      if (lastBotMsg === AWAIT_REPAIR) {
        await saveMsg(lineUserId, 'user', text)
        const repairs = await checkRepairStatus(lineUserId, text)
        if (repairs.length > 0) {
          const msg = `🔧 พบงานซ่อมครับ\n\n${repairs.map(repairToText).join('\n\n─────\n\n')}`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', msg)
        } else {
          const msg = `ไม่พบงานซ่อมจากข้อมูลที่ส่งมาครับ\nลองส่งเบอร์โทร หรือ เลขบิลซ่อม อีกครั้ง หรือโทร ${shopCfg?.shop_phone || ''} ครับ`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', AWAIT_REPAIR)
        }
        continue
      }

      /* ── Quick Reply: คิวส่ง ── */
      if (text === T_DELIVERY) {
        await saveMsg(lineUserId, 'user', text)
        const msg = `🚚 เช็คสถานะการส่งของครับ\n\nกรุณาส่ง ชื่อ หรือ เบอร์โทร ที่ใช้สั่งของมาในแชทได้เลยครับ`
        await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
        await saveMsg(lineUserId, 'assistant', AWAIT_DELIVERY)
        continue
      }

      /* ── ตรวจสอบ flow คิวส่ง: รอข้อมูลลูกค้า ── */
      if (lastBotMsg === AWAIT_DELIVERY) {
        await saveMsg(lineUserId, 'user', text)
        const docs = await checkDelivery(text)
        if (docs.length > 0) {
          const flexMsg = deliveryFlexMsg(docs, appUrl)
          await lineReply(replyToken, lineToken, [flexMsg])
          await saveMsg(lineUserId, 'assistant', `🚚 พบรายการส่งของ ${docs.length} รายการ`)
        } else {
          const msg = `🚚 ยังหาไม่เจอครับ\n\nลองส่งข้อมูลอื่นได้มั้ยครับ? เช่น\n• ชื่อที่ใช้สั่ง\n• เบอร์โทร\n• เลขที่ออเดอร์/บิล\n\nหรือโทรถามได้เลยที่ ${shopCfg?.shop_phone || ''} ครับ`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', AWAIT_DELIVERY)
        }
        continue
      }

      /* ── ข้อความทั่วไป → Claude ── */
      // ตรวจว่าข้อความมีเบอร์โทร หรือเลขบิลที่น่าจะเป็น delivery inquiry
      const looksLikeDelivery = /0\d{8,9}/.test(text) || /^[A-Z]{2,}\d{4,}/i.test(text.trim())
      const [history, products, repairOrders, deliveryDocs] = await Promise.all([
        getHistory(lineUserId),
        searchProducts(text),
        checkRepairStatus(lineUserId, text),
        looksLikeDelivery ? checkDelivery(text) : Promise.resolve([]),
      ])

      // ถ้าเจอ delivery จากข้อความโต้ง (ไม่ต้องผ่าน AWAIT_DELIVERY state) → ส่ง Flex ทันที
      if (deliveryDocs.length > 0) {
        await saveMsg(lineUserId, 'user', text)
        const flexMsg = deliveryFlexMsg(deliveryDocs, appUrl)
        await lineReply(replyToken, lineToken, [flexMsg])
        await saveMsg(lineUserId, 'assistant', `🚚 พบรายการส่งของ ${deliveryDocs.length} รายการ`)
        continue
      }

      await saveMsg(lineUserId, 'user', text)

      let aiReply
      try {
        aiReply = await askClaude({ text, history, products, repairOrders, shopCfg, botCfg })
      } catch (claudeErr) {
        const errMsg = `[DEBUG] Claude error: ${claudeErr.message}`
        await lineReply(replyToken, lineToken, [{ type: 'text', text: errMsg }])
        continue
      }

      if (aiReply.startsWith('[SILENT]')) continue

      if (aiReply.includes('[MENU]')) {
        await sendMenu(replyToken, lineToken, shopName)
        await saveMsg(lineUserId, 'assistant', '[MENU]')
        continue
      }

      if (aiReply.includes('[ESCALATE]')) {
        const msg = aiReply.replace('[ESCALATE]', '').trim() ||
          `ขอโทษด้วยนะครับ เรื่องนี้จะแจ้งเจ้าของร้านให้ติดต่อกลับโดยเร็วที่สุดเลยครับ 🙏`
        await replyText(replyToken, lineToken, msg)
        await saveMsg(lineUserId, 'assistant', msg)
        continue
      }

      await replyText(replyToken, lineToken, aiReply)
      await saveMsg(lineUserId, 'assistant', aiReply)

      // Push Flex สินค้า ถ้า AI พูดถึง
      const productMentioned = products.length > 0 &&
        products.some(p => p.name.split(/\s+/).some(w => w.length >= 2 && aiReply.includes(w)))
      if (productMentioned && lineUserId !== 'unknown') {
        const bubbles = products.slice(0, 8).map(p => {
          const dp = p.online_price != null ? p.online_price : p.price
          return {
            type: 'bubble', size: 'micro',
            body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [
              { type: 'text', text: p.name, weight: 'bold', size: 'sm', wrap: true, color: '#1e293b' },
              { type: 'text', text: `฿${fmt(dp)}/${p.unit || 'ชิ้น'}`, size: 'lg', weight: 'bold', color: '#C72C41', margin: 'sm' },
            ]},
            footer: { type: 'box', layout: 'vertical', paddingAll: '10px', contents: [{
              type: 'button', style: 'primary', color: '#C72C41', height: 'sm',
              action: { type: 'message', label: '🛒 สนใจ', text: `สนใจสินค้า: ${p.name}` },
            }]},
          }
        })
        await linePush(lineUserId, lineToken, [{
          type: 'flex',
          altText: 'สินค้าแนะนำ',
          contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
        }])
      }
    }

    return new Response('OK', { status: 200 })
  } catch (e) {
    console.error('[line-webhook] ERROR:', e.message, e.stack)
    return new Response('OK', { status: 200 })
  }
}

export async function GET() {
  try {
    const lineCfg = await getLineSettings()
    const botCfg  = await getBotSettings()
    return Response.json({
      ok: true,
      hasLineToken: !!(lineCfg?.line_channel_token),
      hasGroupId:   !!(lineCfg?.line_group_id),
      botEnabled:   botCfg?.line_bot_enabled,
      botName:      botCfg?.line_bot_name,
      hasGeminiKey: !!(process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_AI_API_KEY),
      appUrl:       process.env.NEXT_PUBLIC_APP_URL,
    })
  } catch (e) {
    return Response.json({ ok: false, error: e.message })
  }
}
