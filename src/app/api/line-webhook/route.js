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

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  : ''

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/* ── ดึง settings บอท ── */
async function getBotSettings() {
  const keys = ['line_bot_enabled', 'line_bot_name', 'line_bot_persona', 'line_bot_silent_keywords']
  const { data } = await supabase.from('settings').select('key,value').in('key', keys)
  if (!data) return null
  return Object.fromEntries(data.map(r => [r.key, r.value]))
}

/* ── บันทึกข้อความ ── */
async function saveMsg(lineUserId, role, content) {
  await sbService.from('line_conversations').insert({ line_user_id: lineUserId, role, content })
}

/* ── ดึงประวัติ 10 ข้อความล่าสุด ── */
async function getHistory(lineUserId) {
  const { data } = await sbService
    .from('line_conversations')
    .select('role,content')
    .eq('line_user_id', lineUserId)
    .order('created_at', { ascending: false })
    .limit(10)
  return (data || []).reverse()
}

/* ── ค้นสินค้า (ตัดคำค้นแต่ละคำ) ── */
async function searchProducts(text) {
  // ตัดคำออกมาทีละคำ กรองคำสั้น < 2 ตัวอักษรทิ้ง
  const words = text.split(/\s+/).filter(w => w.length >= 2)
  if (words.length === 0) return []

  // สร้าง OR conditions ทุกคำ ทุก field
  const orParts = words.flatMap(w => [
    `name.ilike.%${w}%`,
    `search_tags.ilike.%${w}%`,
  ])

  const { data } = await supabase
    .from('products')
    .select('id,name,price,online_price,stock,unit,image_url,categories(name)')
    .eq('active', true)
    .or(orParts.join(','))
    .order('stock', { ascending: false })
    .limit(10)

  return data || []
}

/* ── ส่ง Flex Carousel สินค้า ── */
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
    { type: 'text', text: `🔍 พบสินค้า ${products.length} รายการ` },
    { type: 'flex', altText: `พบสินค้า ${products.length} รายการ`, contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles } },
  ]
  if (appUrl) messages.push({ type: 'text', text: `ดูสินค้าทั้งหมด: ${appUrl}/shop` })

  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
    body: JSON.stringify({ replyToken, messages }),
  })
}

/* ── Claude Haiku ── */
async function askClaude(text, history, products, shopCfg, botCfg) {
  const shopName = shopCfg?.shop_name || 'ร้านค้า'
  const botName  = botCfg?.line_bot_name || 'น้องมิน'
  const persona  = botCfg?.line_bot_persona || 'ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง'
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL || ''

  const productList = products.length > 0
    ? products.map(p => {
        const price = p.online_price != null ? p.online_price : p.price
        return `- ${p.name} ราคา ฿${fmt(price)}/${p.unit || 'ชิ้น'} (คงเหลือ ${p.stock} ${p.unit || 'ชิ้น'})`
      }).join('\n')
    : 'ไม่พบสินค้าที่ตรงกับคำถาม'

  const systemPrompt = `คุณชื่อ "${botName}" เป็น${persona} ของร้าน "${shopName}"
ข้อมูลร้าน: โทร ${shopCfg?.shop_phone || ''} ที่อยู่: ${shopCfg?.shop_address || ''}
ลิงก์ดูสินค้า: ${appUrl}/shop

สินค้าที่เกี่ยวข้องกับคำถามลูกค้า:
${productList}

กฎการตอบ:
1. ตอบภาษาไทยสั้นๆ เป็นธรรมชาติ ไม่เกิน 3-4 ประโยค
2. ถ้าลูกค้าถามสินค้า → แนะนำจากรายการข้างบน บอกราคาและสต็อก
3. ถ้าลูกค้าต้องการคุยกับเจ้าของ/แอดมิน, ติดตามงานซ่อม, ร้องเรียน, หรือเรื่องที่เกินความสามารถบอท → ตอบว่า [ESCALATE] แล้วตามด้วยข้อความขอโทษที่จะแจ้งแอดมินให้
4. ถ้าลูกค้าส่งแค่ sticker หรือข้อความทักทายทั่วไปที่ไม่ถามอะไร → ตอบว่า [SILENT]
5. ห้ามแต่งราคา หรือข้อมูลที่ไม่มีในรายการสินค้า`

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: text },
  ]

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: systemPrompt,
    messages,
  })

  return res.content[0]?.text || ''
}

/* ── ดึง shop settings ── */
async function getShopSettings() {
  const { data } = await supabase.from('settings')
    .select('key,value')
    .in('key', ['shop_name', 'shop_phone', 'shop_address'])
  if (!data) return {}
  return Object.fromEntries(data.map(r => [r.key, r.value]))
}

export async function POST(req) {
  try {
    const body = await req.json()
    const events = body.events || []

    const [cfg, botCfg, shopCfg] = await Promise.all([
      getLineSettings(),
      getBotSettings(),
      getShopSettings(),
    ])

    if (!cfg) return new Response('OK', { status: 200 })
    const lineToken = cfg.line_channel_token
    const appUrl   = process.env.NEXT_PUBLIC_APP_URL || ''
    const botEnabled = botCfg?.line_bot_enabled !== 'false'

    for (const event of events) {

      /* ── Postback: อนุมัติ/ปฏิเสธ (staff group) ── */
      if (event.type === 'postback') {
        const replyToken = event.replyToken
        const data = event.postback?.data || ''
        const [action, idStr] = data.split(':')
        const id = parseInt(idStr)
        if (!id || isNaN(id)) continue

        if (action === 'approve_leave' || action === 'reject_leave') {
          const status = action === 'approve_leave' ? 'approved' : 'rejected'
          const { data: leave } = await supabase
            .from('leave_requests').update({ status }).eq('id', id)
            .select('date_from, date_to, employees(nickname, name)').single()
          if (leave) {
            const empName = leave.employees?.nickname || leave.employees?.name || '?'
            const dateStr = leave.date_from === leave.date_to ? fmtDate(leave.date_from) : `${fmtDate(leave.date_from)} – ${fmtDate(leave.date_to)}`
            const word = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, lineToken, `${status === 'approved' ? '✅' : '❌'} คำขอลา — ${empName} (${dateStr})\n${word}`)
          }
        }
        else if (action === 'approve_advance' || action === 'reject_advance') {
          const status = action === 'approve_advance' ? 'approved' : 'rejected'
          const { data: adv } = await supabase
            .from('salary_advances').update({ status }).eq('id', id)
            .select('amount, employees(nickname, name)').single()
          if (adv) {
            const empName = adv.employees?.nickname || adv.employees?.name || '?'
            const word = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, lineToken, `${status === 'approved' ? '✅' : '❌'} คำขอเบิก — ${empName} ฿${fmt(adv.amount)}\n${word}`)
          }
        }
        else if (action === 'approve_drawer' || action === 'reject_drawer') {
          const status = action === 'approve_drawer' ? 'approved' : 'rejected'
          const { data: dr } = await supabase
            .from('drawer_requests').update({ status }).eq('id', id)
            .select('employee_name, note').single()
          if (dr) {
            if (status === 'approved') {
              await supabase.from('drawer_logs').insert({ employee_name: dr.employee_name, note: `คำขออนุมัติ${dr.note ? ` — ${dr.note}` : ''}` })
              const now = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
              triggerDrawerVideo(`🔓 เปิดลิ้นชัก — ${dr.employee_name}  🕐 ${now}`)
            }
            const word = status === 'approved' ? 'อนุมัติแล้ว — เปิดลิ้นชักแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, lineToken, `${status === 'approved' ? '✅' : '❌'} คำขอเปิดลิ้นชัก — ${dr.employee_name}\n${word}`)
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
      if (!text || text.length < 1) continue

      // ตรวจ silent keywords
      const silentKeywords = (botCfg?.line_bot_silent_keywords || '').split(',').map(k => k.trim()).filter(Boolean)
      if (silentKeywords.some(k => k && text.includes(k))) {
        await saveMsg(lineUserId, 'user', text)
        continue
      }

      // ดึง history + ค้นสินค้า พร้อมกัน
      const [history, products] = await Promise.all([
        getHistory(lineUserId),
        searchProducts(text),
      ])

      // บันทึก user message
      await saveMsg(lineUserId, 'user', text)

      // ถาม Claude
      const aiReply = await askClaude(text, history, products, shopCfg, botCfg)

      if (aiReply.startsWith('[SILENT]')) {
        // ไม่ตอบ เงียบ
        continue
      }

      if (aiReply.startsWith('[ESCALATE]')) {
        const msg = aiReply.replace('[ESCALATE]', '').trim() ||
          `ขอโทษด้วยนะคะ เรื่องนี้จะแจ้งแอดมินให้ติดต่อกลับโดยเร็วนะคะ 🙏`
        await replyText(replyToken, lineToken, msg)
        await saveMsg(lineUserId, 'assistant', msg)
        continue
      }

      // ถ้า AI ตอบมีสินค้า และมีสินค้าจริงในระบบ → ส่ง Flex ด้วย
      const hasProductMention = products.length > 0 &&
        products.some(p => aiReply.includes(p.name) || text.split(/\s+/).some(w => w.length >= 2 && p.name.includes(w)))

      if (hasProductMention) {
        await replyProducts(replyToken, lineToken, products.slice(0, 5), shopCfg?.shop_name, appUrl)
      } else {
        await replyText(replyToken, lineToken, aiReply)
      }

      await saveMsg(lineUserId, 'assistant', aiReply)
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
