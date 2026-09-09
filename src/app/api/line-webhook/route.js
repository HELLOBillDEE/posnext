import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { replyText } from '@/lib/lineStaff'
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

/* ── Trigger texts จากปุ่ม Quick Reply ── */
const T_BUY      = '__buy__'
const T_REPAIR   = '__repair__'
const T_DELIVERY = '__delivery__'
// marker ที่บอทฝังใน history เพื่อรู้ว่ารอข้อมูลส่งของ
const DELIVERY_PENDING_MARKER = '__awaiting_delivery_info__'

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtD(d) {
  return d ? new Date(d.includes('T') ? d : d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : ''
}

const REPAIR_STATUS = {
  pending:       'รอรับเครื่อง / รอตรวจสอบ',
  diagnosing:    'กำลังตรวจสอบอาการเสีย',
  waiting_parts: 'รออะไหล่',
  in_progress:   'ช่างกำลังซ่อม',
  done:          'ซ่อมเสร็จแล้ว — พร้อมรับเครื่อง',
  delivered:     'ส่งคืนลูกค้าแล้ว',
  cancelled:     'ยกเลิก',
}
const DELIVERY_STATUS = {
  pending:   'รอจัดส่ง 📦',
  delivered: 'ส่งแล้ว ✅',
  cancelled: 'ยกเลิก',
}

/* ── LINE Token (ดึงแค่ line_channel_token ไม่ต้องการ line_group_id) ── */
async function getLineToken() {
  const { data } = await supabase.from('settings').select('key,value')
    .in('key', ['line_channel_token'])
  if (!data?.length) return null
  return data.find(r => r.key === 'line_channel_token')?.value || null
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

/* ── LINE reply helpers ── */
async function lineReply(replyToken, lineToken, messages) {
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
    body: JSON.stringify({ replyToken, messages }),
  })
}
async function linePush(lineUserId, lineToken, messages) {
  return fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
    body: JSON.stringify({ to: lineUserId, messages }),
  })
}

/* ── ส่งเมนู Quick Reply ── */
async function sendMenu(replyToken, lineToken, shopName) {
  return lineReply(replyToken, lineToken, [{
    type: 'text',
    text: `สวัสดีครับ 👋 ยินดีต้อนรับสู่ ${shopName || 'ร้านเชิดชัย'}\nต้องการสอบถามเรื่องใดครับ?`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '🛒 สั่งซื้อสินค้า', text: T_BUY } },
        { type: 'action', action: { type: 'message', label: '🔧 คิวซ่อม',        text: T_REPAIR } },
        { type: 'action', action: { type: 'message', label: '🚚 คิวส่งของ',      text: T_DELIVERY } },
      ],
    },
  }])
}

/* ── check_repair_status ── */
async function checkRepairByUser(lineUserId) {
  const sel = 'repair_no,customer_name,device,description,status,appointment_date,appointment_time,note,technician_name,price,deposit'
  const { data } = await supabase.from('repair_orders').select(sel)
    .eq('line_user_id', lineUserId)
    .order('created_at', { ascending: false }).limit(5)
  return data || []
}
async function checkRepairByText(text) {
  const sel = 'repair_no,customer_name,device,description,status,appointment_date,appointment_time,note,technician_name,price,deposit'
  const results = []
  const seen = new Set()
  const add = (items) => { for (const r of (items||[])) { if (!seen.has(r.repair_no)) { seen.add(r.repair_no); results.push(r) } } }
  const phones = text.match(/0\d{8,9}/g) || []
  for (const ph of phones) {
    const { data } = await supabase.from('repair_orders').select(sel).eq('phone', ph).limit(3)
    add(data)
  }
  const words = text.split(/\s+/).filter(w => w.length >= 2 && !/^\d+$/.test(w))
  for (const w of words.slice(0,3)) {
    const { data } = await supabase.from('repair_orders').select(sel).ilike('customer_name', `%${w}%`).limit(3)
    add(data)
  }
  const codes = text.match(/[A-Z0-9]{5,}/gi) || []
  for (const c of codes.slice(0,2)) {
    const { data } = await supabase.from('repair_orders').select(sel).ilike('repair_no', `%${c}%`).limit(2)
    add(data)
  }
  return results.slice(0, 5)
}

function repairMsg(repairs) {
  if (!repairs.length) return null
  return repairs.map(r => {
    const status = REPAIR_STATUS[r.status] || r.status || '-'
    const lines = [
      `📋 บิล: ${r.repair_no}`,
      `🔧 ${r.device || '-'} — ${r.description || '-'}`,
      `🔴 สถานะ: ${status}`,
    ]
    if (r.technician_name) lines.push(`👨‍🔧 ช่าง: ${r.technician_name}`)
    if (r.appointment_date) lines.push(`📅 นัด: ${fmtD(r.appointment_date)}${r.appointment_time ? ` ${r.appointment_time}` : ''}`)
    if (r.note) lines.push(`💬 ${r.note}`)
    if (r.price > 0) {
      const remain = (r.price || 0) - (r.deposit || 0)
      lines.push(`💰 ค่าซ่อม ฿${fmt(r.price)}${r.deposit > 0 ? ` (มัดจำ ฿${fmt(r.deposit)} คงเหลือ ฿${fmt(remain)})` : ''}`)
    }
    return lines.join('\n')
  }).join('\n\n─────────────\n\n')
}

/* ── check_delivery_status ── */
async function checkDelivery(text) {
  const sel = 'doc_no,customer_name,customer_phone,customer_address,items,total,delivery_fee,status,delivered_at,created_at,delivery_token'
  const orParts = []
  const phones = text.match(/0\d{8,9}/g) || []
  phones.forEach(p => orParts.push(`customer_phone.eq.${p}`))
  const words = text.replace(/0\d{8,9}/g, '').split(/\s+/).filter(w => w.length >= 2)
  words.slice(0,3).forEach(w => orParts.push(`customer_name.ilike.%${w}%`))
  if (!orParts.length) return []
  const { data } = await supabase.from('quotations').select(sel)
    .eq('doc_type', 'delivery_invoice').neq('status', 'cancelled')
    .or(orParts.join(',')).order('created_at', { ascending: false }).limit(5)
  return data || []
}

function deliveryMsg(docs, appUrl) {
  if (!docs.length) return null
  return docs.map(d => {
    const items = (d.items || []).map(i => `  • ${i.name} x${i.qty || 1}`).join('\n')
    const status = DELIVERY_STATUS[d.status] || d.status || '-'
    const lines = [
      `📋 บิล: ${d.doc_no}`,
      `👤 ${d.customer_name} | 📞 ${d.customer_phone || '-'}`,
      `📍 ${d.customer_address || '-'}`,
      `📦 รายการ:\n${items}`,
      `💰 ยอดรวม ฿${fmt(d.total)}${d.delivery_fee > 0 ? ` (ค่าส่ง ฿${fmt(d.delivery_fee)})` : ''}`,
      `🚚 สถานะ: ${status}`,
    ]
    if (d.delivered_at) lines.push(`✅ ส่งเมื่อ: ${fmtD(d.delivered_at)}`)
    if (d.delivery_token && appUrl) lines.push(`🔗 ติดตาม: ${appUrl}/delivery/${d.delivery_token}`)
    return lines.join('\n')
  }).join('\n\n─────────────\n\n')
}

/* ── search_product ── */
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

/* ── Claude Haiku: สำหรับข้อความทั่วไป ── */
async function askClaude({ text, history, products, shopCfg, botCfg }) {
  const shopName = shopCfg?.shop_name || 'ร้านเชิดชัย'
  const botName  = botCfg?.line_bot_name || 'แอดมิน'
  const persona  = botCfg?.line_bot_persona || 'ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง'
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL || ''

  const productSection = products.length > 0
    ? `[ฐานข้อมูลสินค้า]\n` + products.map(p => {
        const price = p.online_price ?? p.price
        return `- ${p.name} ฿${fmt(price)}/${p.unit||'ชิ้น'}${p.categories?.name ? ` (${p.categories.name})` : ''}`
      }).join('\n')
    : '[ฐานข้อมูลสินค้า] ไม่พบสินค้าที่ตรงกับคำถาม'

  const system = `ชื่อคุณคือ "${botName}" — ${persona}
ร้าน: ${shopName} โทร: ${shopCfg?.shop_phone||''} ที่ตั้ง: ${shopCfg?.shop_address||''}
ลิงก์สินค้าออนไลน์: ${appUrl}/shop

${productSection}

กฎ:
1. ถามสินค้า → แนะนำจาก [ฐานข้อมูลสินค้า] บอกราคา จุดเด่น ห้ามแต่งข้อมูล
2. ถามงานซ่อม/งานส่ง/ต้องการแอดมิน/ข้อมูลไม่อยู่ในระบบ → ตอบ [ESCALATE]
3. ไม่รู้เจตนาลูกค้า หรือข้อความทักทายทั่วไป → ตอบ [MENU]
4. ตอบภาษาไทย สั้นๆ เป็นธรรมชาติ ลงท้าย ครับ/ค่ะ`

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system,
    messages: [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: text },
    ],
  })
  return res.content[0]?.text || ''
}

/* ════════════════ MAIN HANDLER ════════════════ */
export async function POST(req) {
  try {
    const body  = await req.json()
    const events = body.events || []

    const [lineToken, botCfg, shopCfg] = await Promise.all([
      getLineToken(), getBotSettings(), getShopSettings(),
    ])
    if (!lineToken) return new Response('OK', { status: 200 })
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
            const ds = r.date_from === r.date_to ? fmtD(r.date_from) : `${fmtD(r.date_from)}–${fmtD(r.date_to)}`
            await replyText(replyToken, lineToken, `${s==='approved'?'✅':'❌'} คำขอลา — ${name} (${ds})\n${s==='approved'?'อนุมัติแล้ว':'ไม่อนุมัติ'}`)
          }
        } else if (action === 'approve_advance' || action === 'reject_advance') {
          const s = action === 'approve_advance' ? 'approved' : 'rejected'
          const { data: r } = await supabase.from('salary_advances').update({ status: s }).eq('id', id)
            .select('amount,employees(nickname,name)').single()
          if (r) {
            const name = r.employees?.nickname || r.employees?.name || '?'
            await replyText(replyToken, lineToken, `${s==='approved'?'✅':'❌'} คำขอเบิก — ${name} ฿${fmt(r.amount)}\n${s==='approved'?'อนุมัติแล้ว':'ไม่อนุมัติ'}`)
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
            await replyText(replyToken, lineToken, `${s==='approved'?'✅':'❌'} คำขอเปิดลิ้นชัก — ${r.employee_name}\n${s==='approved'?'อนุมัติแล้ว':'ไม่อนุมัติ'}`)
          }
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

      // ตรวจ silent keywords
      const silentKw = (botCfg?.line_bot_silent_keywords || '').split(',').map(k => k.trim()).filter(Boolean)
      if (silentKw.some(k => k && text.includes(k))) {
        await saveMsg(lineUserId, 'user', text)
        continue
      }

      /* ── ปุ่ม: สั่งซื้อสินค้า ── */
      if (text === T_BUY) {
        await saveMsg(lineUserId, 'user', text)
        const reply = `🛒 สั่งซื้อสินค้าได้เลยครับ!\n\nส่งรายการสินค้าที่ต้องการมาในแชทนี้ได้เลย หรือโทรมาสั่งได้ที่ ${shopCfg?.shop_phone||''} ครับ\n\nดูสินค้าทั้งหมดได้ที่:\n${appUrl}/shop`
        await lineReply(replyToken, lineToken, [{ type: 'text', text: reply }])
        await saveMsg(lineUserId, 'assistant', reply)
        continue
      }

      /* ── ปุ่ม: คิวซ่อม ── */
      if (text === T_REPAIR) {
        await saveMsg(lineUserId, 'user', text)
        const repairs = await checkRepairByUser(lineUserId)
        if (repairs.length > 0) {
          const msg = `🔧 พบงานซ่อมของคุณในระบบครับ\n\n${repairMsg(repairs)}`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', msg)
        } else {
          const msg = `🔧 ยังไม่พบงานซ่อมในระบบครับ\n\nกรุณาส่ง ชื่อ, เบอร์โทร หรือ เลขที่บิลซ่อม มาในแชทนี้เลยครับ แอดมินจะเช็คให้ทันทีครับ`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', msg)
        }
        continue
      }

      /* ── ปุ่ม: คิวส่ง ── */
      if (text === T_DELIVERY) {
        await saveMsg(lineUserId, 'user', text)
        const msg = `🚚 เช็คสถานะการส่งของครับ\n\nกรุณาส่ง ชื่อ หรือ เบอร์โทร ที่ใช้สั่งของมาในแชทได้เลยครับ`
        await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
        await saveMsg(lineUserId, 'assistant', DELIVERY_PENDING_MARKER)
        continue
      }

      /* ── ดึง history เพื่อตรวจสอบ flow ── */
      const history = await getHistory(lineUserId)
      const lastBot = [...history].reverse().find(h => h.role === 'assistant')

      /* ── Flow คิวส่ง: รอข้อมูล ── */
      if (lastBot?.content === DELIVERY_PENDING_MARKER || lastBot?.content?.startsWith('🚚 เช็คสถานะ')) {
        await saveMsg(lineUserId, 'user', text)
        const docs = await checkDelivery(text)
        if (docs.length > 0) {
          const msg = `🚚 พบรายการส่งของครับ\n\n${deliveryMsg(docs, appUrl)}`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', msg)
        } else {
          const msg = `ขออภัยครับ ไม่พบรายการส่งของในระบบ\n\nลองตรวจสอบชื่อ-เบอร์โทรอีกครั้ง หรือติดต่อร้านได้ที่ ${shopCfg?.shop_phone||''} ครับ`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', msg)
        }
        continue
      }

      /* ── ข้อความทั่วไปหลัง __repair__ รอชื่อ/เบอร์ ── */
      if (lastBot?.content?.includes('ส่ง ชื่อ, เบอร์โทร หรือ เลขที่บิลซ่อม')) {
        await saveMsg(lineUserId, 'user', text)
        const repairs = await checkRepairByText(text)
        if (repairs.length > 0) {
          const msg = `🔧 พบงานซ่อมครับ\n\n${repairMsg(repairs)}`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', msg)
        } else {
          const msg = `ขออภัยครับ ไม่พบงานซ่อมในระบบ\n\nเดี๋ยวขออนุญาตเช็คกับช่างให้สักครู่นะครับ หรือโทรถามได้เลยที่ ${shopCfg?.shop_phone||''} ครับ`
          await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
          await saveMsg(lineUserId, 'assistant', msg)
        }
        continue
      }

      /* ── Claude: สำหรับข้อความทั่วไป ── */
      await saveMsg(lineUserId, 'user', text)
      const products = await searchProducts(text)
      const aiReply = await askClaude({ text, history, products, shopCfg, botCfg })

      if (aiReply.startsWith('[SILENT]')) continue

      if (aiReply.includes('[MENU]')) {
        await sendMenu(replyToken, lineToken, shopName)
        await saveMsg(lineUserId, 'assistant', '[MENU]')
        continue
      }

      if (aiReply.includes('[ESCALATE]')) {
        const msg = aiReply.replace('[ESCALATE]', '').trim() ||
          `ขอโทษด้วยนะครับ เรื่องนี้จะแจ้งเจ้าของร้านให้ติดต่อกลับโดยเร็วที่สุดเลยครับ 🙏`
        await lineReply(replyToken, lineToken, [{ type: 'text', text: msg }])
        await saveMsg(lineUserId, 'assistant', msg)
        continue
      }

      // ตอบปกติ + push Flex สินค้าถ้า AI พูดถึง
      await lineReply(replyToken, lineToken, [{ type: 'text', text: aiReply }])
      await saveMsg(lineUserId, 'assistant', aiReply)

      const productMentioned = products.length > 0 &&
        products.some(p => p.name.split(/\s+/).some(w => w.length >= 2 && aiReply.includes(w)))
      if (productMentioned && lineUserId !== 'unknown') {
        const cards = products.slice(0, 8).map(p => {
          const dp = p.online_price ?? p.price
          return {
            type: 'bubble', size: 'micro',
            body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [
              { type: 'text', text: p.name, weight: 'bold', size: 'sm', wrap: true, color: '#1e293b' },
              { type: 'text', text: `฿${fmt(dp)}/${p.unit||'ชิ้น'}`, size: 'lg', weight: 'bold', color: '#C72C41', margin: 'sm' },
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
          contents: cards.length === 1 ? cards[0] : { type: 'carousel', contents: cards },
        }])
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
