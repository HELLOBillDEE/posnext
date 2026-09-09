import { createClient } from '@supabase/supabase-js'
import { replyText, getLineSettings } from '@/lib/lineStaff'
import { triggerDrawerVideo } from '@/lib/cameraRecord'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  : ''

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/* ── ตอบ Flex Carousel สินค้า ── */
async function replyProducts(replyToken, lineToken, products, shopName, appUrl) {
  const bubbles = products.slice(0, 10).map(p => {
    const contents = []

    contents.push({
      type: 'text',
      text: p.name,
      weight: 'bold',
      size: 'sm',
      wrap: true,
      color: '#1e293b',
    })
    const displayPrice = p.online_price != null ? p.online_price : p.price
    const hasDiscount  = p.online_price != null && p.online_price < p.price

    contents.push({
      type: 'text',
      text: `฿${fmt(displayPrice)} / ${p.unit || 'ชิ้น'}${hasDiscount ? ` (ลดจาก ฿${fmt(p.price)})` : ''}`,
      size: 'xl',
      weight: 'bold',
      color: '#C72C41',
      margin: 'sm',
    })
    contents.push({
      type: 'text',
      text: p.stock > 0 ? `✅ คงเหลือ ${fmt(p.stock)} ${p.unit || 'ชิ้น'}` : '❌ สินค้าหมด',
      size: 'xs',
      color: p.stock > 0 ? '#16a34a' : '#dc2626',
      margin: 'xs',
    })
    if (p.categories?.name) {
      contents.push({
        type: 'text',
        text: `🏷 ${p.categories.name}`,
        size: 'xs',
        color: '#64748b',
        margin: 'xs',
      })
    }

    const bubble = {
      type: 'bubble',
      size: 'micro',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        contents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '10px',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#C72C41',
          height: 'sm',
          action: {
            type: 'message',
            label: '🛒 สนใจสินค้านี้',
            text: `สนใจสินค้า: ${p.name} ราคา ฿${fmt(p.price)}`,
          },
        }],
      },
    }

    if (p.image_url) {
      bubble.hero = {
        type: 'image',
        url: p.image_url,
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'cover',
      }
    }

    return bubble
  })

  const shopUrl = appUrl ? `${appUrl}/shop` : null

  const container = {
    type: 'carousel',
    contents: bubbles,
  }

  // ถ้ามีแค่ 1 ชิ้น ส่งเป็น bubble เดี่ยว
  const flexContents = bubbles.length === 1 ? bubbles[0] : container

  const messages = [
    {
      type: 'text',
      text: `🔍 พบสินค้า ${products.length} รายการจาก "${shopName || 'ร้านของเรา'}"`,
    },
    {
      type: 'flex',
      altText: `พบสินค้า ${products.length} รายการ`,
      contents: flexContents,
    },
  ]

  if (shopUrl) {
    messages.push({
      type: 'text',
      text: `ดูสินค้าทั้งหมด: ${shopUrl}`,
    })
  }

  const cfg = await getLineSettings()
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${lineToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  })
}

/* ── ค้นหาสินค้าตาม keyword ── */
async function searchProducts(keyword) {
  const q = `%${keyword}%`
  const { data } = await supabase
    .from('products')
    .select('id,name,price,online_price,stock,unit,image_url,categories(name)')
    .eq('active', true)
    .or(`name.ilike.${q},search_tags.ilike.${q}`)
    .gt('stock', 0)
    .order('name')
    .limit(10)
  return data || []
}

export async function POST(req) {
  try {
    const body = await req.json()
    const events = body.events || []

    const cfg = await getLineSettings()
    if (!cfg) return new Response('OK', { status: 200 })

    const lineToken = cfg.line_channel_token
    const appUrl   = process.env.NEXT_PUBLIC_APP_URL || ''

    for (const event of events) {
      /* ── Postback: อนุมัติ/ปฏิเสธ (จาก staff group) ── */
      if (event.type === 'postback') {
        const replyToken = event.replyToken
        const data = event.postback?.data || ''
        const [action, idStr] = data.split(':')
        const id = parseInt(idStr)
        if (!id || isNaN(id)) continue

        if (action === 'approve_leave' || action === 'reject_leave') {
          const status = action === 'approve_leave' ? 'approved' : 'rejected'
          const { data: leave } = await supabase
            .from('leave_requests')
            .update({ status })
            .eq('id', id)
            .select('date_from, date_to, employees(nickname, name)')
            .single()
          if (leave) {
            const empName = leave.employees?.nickname || leave.employees?.name || '?'
            const dateStr = leave.date_from === leave.date_to
              ? fmtDate(leave.date_from)
              : `${fmtDate(leave.date_from)} – ${fmtDate(leave.date_to)}`
            const emoji = status === 'approved' ? '✅' : '❌'
            const word  = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, lineToken, `${emoji} คำขอลา — ${empName} (${dateStr})\n${word}`)
          }
        }

        else if (action === 'approve_advance' || action === 'reject_advance') {
          const status = action === 'approve_advance' ? 'approved' : 'rejected'
          const { data: adv } = await supabase
            .from('salary_advances')
            .update({ status })
            .eq('id', id)
            .select('amount, employees(nickname, name)')
            .single()
          if (adv) {
            const empName = adv.employees?.nickname || adv.employees?.name || '?'
            const amtStr  = `฿${fmt(adv.amount)}`
            const emoji   = status === 'approved' ? '✅' : '❌'
            const word    = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, lineToken, `${emoji} คำขอเบิก — ${empName} ${amtStr}\n${word}`)
          }
        }

        else if (action === 'approve_drawer' || action === 'reject_drawer') {
          const status = action === 'approve_drawer' ? 'approved' : 'rejected'
          const { data: dr } = await supabase
            .from('drawer_requests')
            .update({ status })
            .eq('id', id)
            .select('employee_name, note')
            .single()
          if (dr) {
            if (status === 'approved') {
              await supabase.from('drawer_logs').insert({
                employee_name: dr.employee_name,
                note: `คำขออนุมัติ${dr.note ? ` — ${dr.note}` : ''}`,
              })
              const now = new Date().toLocaleTimeString('th-TH', {
                timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
              })
              triggerDrawerVideo(`🔓 เปิดลิ้นชัก — ${dr.employee_name}  🕐 ${now}`)
            }
            const emoji = status === 'approved' ? '✅' : '❌'
            const word  = status === 'approved' ? 'อนุมัติแล้ว — เปิดลิ้นชักแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, lineToken, `${emoji} คำขอเปิดลิ้นชัก — ${dr.employee_name}\n${word}`)
          }
        }
      }

      /* ── Message: ลูกค้าถามสินค้า ── */
      else if (event.type === 'message' && event.message?.type === 'text') {
        const replyToken = event.replyToken
        const text = (event.message.text || '').trim()

        // ไม่ตอบข้อความสั้นเกินไป
        if (text.length < 2) continue

        // ถ้าเป็น keyword คำสั่ง ไม่ตอบสินค้า
        const skipPhrases = ['สวัสดี', 'hello', 'hi', 'สนใจสินค้า:']
        if (skipPhrases.some(s => text.toLowerCase().startsWith(s.toLowerCase()))) {
          if (text.toLowerCase().startsWith('สนใจสินค้า:')) {
            await replyText(replyToken, lineToken,
              `ขอบคุณที่สนใจครับ 😊\nทางร้านจะติดต่อกลับเร็วๆ นี้\nหรือโทรหาเราได้เลยที่ ${cfg.shop_phone || ''}`)
          } else {
            await replyText(replyToken, lineToken,
              `สวัสดีครับ! 👋 ${cfg.shop_name || 'ร้านของเรา'}\n\nพิมพ์ชื่อสินค้าที่ต้องการค้นหาได้เลยครับ เช่น "สายยาง", "ปุ๋ย", "ยาฆ่าแมลง"\n\nหรือดูสินค้าทั้งหมดที่: ${appUrl}/shop`)
          }
          continue
        }

        // ค้นสินค้า
        const results = await searchProducts(text)
        if (results.length === 0) {
          await replyText(replyToken, lineToken,
            `ขออภัยครับ ไม่พบสินค้า "${text}" ในร้าน\n\nลองค้นหาด้วยคำอื่น หรือดูสินค้าทั้งหมดที่:\n${appUrl}/shop`)
        } else {
          await replyProducts(replyToken, lineToken, results, cfg.shop_name, appUrl)
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
