import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  : ''

async function getTelegramSettings() {
  const { data } = await supabase.from('settings')
    .select('key, value')
    .in('key', ['telegram_bot_token', 'telegram_chat_id', 'telegram_webhook_secret'])
  if (!data) return null
  const s = Object.fromEntries(data.map(r => [r.key, r.value]))
  if (!s.telegram_bot_token || !s.telegram_chat_id) return null
  return s
}

async function sendMessage(token, chatId, text, replyMarkup) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' }
  if (replyMarkup) body.reply_markup = replyMarkup
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) console.error('[Telegram]', json.description)
  return json
}

export async function answerCallback(token, callbackQueryId, text) {
  return fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  })
}

export async function editMessageText(token, chatId, messageId, text) {
  return fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }),
  })
}

export async function saveChatId(chatId) {
  // ไม่ overwrite ถ้ามีค่าอยู่แล้ว (ป้องกันการยึดกลุ่ม)
  const { data } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').maybeSingle()
  if (data?.value && data.value !== '' && data.value !== 'undefined') return
  await supabase.from('settings').upsert(
    { key: 'telegram_chat_id', value: String(chatId) },
    { onConflict: 'key' }
  )
}

export async function getTgSettings() {
  return getTelegramSettings()
}

/* ── แจ้งเตือนเข้า/ออกงาน ── */
export async function notifyAttendance({ empName, action, time }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const timeStr = new Date(time).toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
  })
  const emoji = action === 'in' ? '🟢' : '🔴'
  const word  = action === 'in' ? 'เข้างาน' : 'ออกงาน'

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id,
    `${emoji} <b>${word}</b> — ${empName}\n🕐 ${timeStr}`)
}

/* ── แจ้งเตือนคำขอลา ── */
export async function notifyLeave({ id, empName, dateFrom, dateTo, period, leaveType, note }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const dateStr     = dateFrom === dateTo ? fmtDate(dateFrom) : `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
  const periodMap   = { full: 'เต็มวัน', morning: 'ครึ่งเช้า', afternoon: 'ครึ่งบ่าย' }
  const leaveTypeMap = { holiday: 'วันหยุด', sick: 'ลาป่วย', personal: 'ธุระส่วนตัว', other: 'อื่นๆ' }

  const lines = [
    `🏖 <b>คำขอลา</b>`,
    `──────────────`,
    `👤 พนักงาน: <b>${empName}</b>`,
    `📅 วันที่: ${dateStr}`,
    `⏰ ช่วงเวลา: ${periodMap[period] || period || 'เต็มวัน'}`,
    `🏷 ประเภท: ${leaveTypeMap[leaveType] || leaveType || 'วันหยุด'}`,
    ...(note ? [`📝 หมายเหตุ: ${note}`] : []),
  ]

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, lines.join('\n'), {
    inline_keyboard: [[
      { text: '✅ อนุมัติ', callback_data: `approve_leave:${id}` },
      { text: '❌ ปฏิเสธ', callback_data: `reject_leave:${id}` },
    ]],
  })
}

const PAY_LABEL = { cash: 'เงินสด', transfer: 'โอน/QR', credit: 'เชื่อ', mixed: 'ผสม' }
const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/* ── แจ้งเตือนยอดขาย (POS) ── */
export async function notifySale(sale) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const shopName = sale.shopName || 'ร้านค้า'
  const itemLines = (sale.items || [])
    .map(i => `  • ${i.name} ×${i.qty} = ฿${fmt(i.price * i.qty - (i.disc || 0))}`)
    .join('\n')
  const payMethod = PAY_LABEL[sale.payment_method] || sale.payment_method || ''
  const mixNote = sale.payment_method === 'mixed' && sale.note
    ? '\n' + (sale.note.match(/\[ผสม:([^\]]+)\]/)?.[1]?.trim() || '') : ''

  const lines = [
    `🛒 <b>${shopName}</b>`,
    `📄 ${sale.receipt_no}`,
    sale.customerName ? `👤 ${sale.customerName}` : null,
    ``,
    itemLines,
    ``,
    sale.subtotal !== sale.total
      ? `ยอดรวม ฿${fmt(sale.subtotal)}\nส่วนลด -฿${fmt((sale.subtotal || 0) - (sale.total || 0))}` : null,
    `💰 รวม ฿${fmt(sale.total)}`,
    `💳 ${payMethod}${mixNote}`,
  ].filter(l => l !== null).join('\n')

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, lines)
}

/* ── แจ้งเตือนเปิดลิ้นชักเงิน ── */
export async function notifyDrawer({ employeeName, shopName, note }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const now = new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  const text = [
    `🔓 <b>เปิดลิ้นชักเงิน</b>`,
    `🏪 ${shopName || 'ร้านค้า'}`,
    `👤 ${employeeName || 'ไม่ระบุ'}`,
    `🕐 ${now}`,
    note ? `📝 ${note}` : null,
  ].filter(Boolean).join('\n')

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, text)
}

/* ── แจ้งเตือนคำขอเปิดลิ้นชัก ── */
export async function notifyDrawerRequest({ id, empName, note }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const now   = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
  const today = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' })

  const lines = [
    `🔓 <b>คำขอเปิดลิ้นชัก</b>`,
    `──────────────`,
    `👤 พนักงาน: <b>${empName}</b>`,
    `📅 วันที่: ${today}`,
    `🕐 เวลา: ${now}`,
    ...(note ? [`📝 หมายเหตุ: ${note}`] : []),
  ]

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, lines.join('\n'), {
    inline_keyboard: [[
      { text: '✅ อนุมัติ', callback_data: `approve_drawer:${id}` },
      { text: '❌ ปฏิเสธ', callback_data: `reject_drawer:${id}` },
    ]],
  })
}

/* ── แจ้งเตือนปิดกะ ── */
export async function notifyShiftClose({ cashierName, shopName, openedAt, salesTotal, salesCount, cashSales, closingCash, expected, diff, expSafe, expWages, expAdvance, expOther, cashRemaining }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const f = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const timeStr = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
  const openStr = openedAt ? new Date(openedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '-'

  const expSafeN    = Number(expSafe    || 0)
  const expWagesN   = Number(expWages   || 0)
  const expAdvanceN = Number(expAdvance || 0)
  const expOtherArr = Array.isArray(expOther) ? expOther : []
  const expOtherN   = expOtherArr.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalExp    = expSafeN + expWagesN + expAdvanceN + expOtherN

  const diffSign = Number(diff) >= 0 ? `✅ เกิน +฿${f(Math.abs(diff))}` : `⚠️ ขาด −฿${f(Math.abs(diff))}`

  const lines = [
    `🔴 <b>ปิดกะ</b>${cashierName ? ` — ${cashierName}` : ''}`,
    `🏪 ${shopName || 'ร้านค้า'}  |  🕐 ${openStr} – ${timeStr}`,
    ``,
    `🧾 ยอดขาย: <b>฿${f(salesTotal)}</b> (${salesCount} บิล)`,
    `💵 เงินสดรับ: ฿${f(cashSales)}`,
    ``,
    `📦 เงินนับได้: ฿${f(closingCash)}`,
    `   ตามระบบ: ฿${f(expected)}`,
    `   ${diffSign}`,
  ]

  if (totalExp > 0) {
    lines.push(``)
    lines.push(`💸 <b>เงินออก</b>`)
    if (expSafeN   > 0) lines.push(`   ฝากเซฟ: ฿${f(expSafeN)}`)
    if (expWagesN  > 0) lines.push(`   ค่าแรง: ฿${f(expWagesN)}`)
    if (expAdvanceN> 0) lines.push(`   เบิกล่วงหน้า: ฿${f(expAdvanceN)}`)
    for (const e of expOtherArr) {
      if (parseFloat(e.amount) > 0) lines.push(`   ${e.label || 'อื่นๆ'}: ฿${f(e.amount)}`)
    }
    lines.push(`   รวมออก: ฿${f(totalExp)}`)
  }

  lines.push(``)
  lines.push(`💰 <b>เงินคงเหลือ (เปิดกะพรุ่งนี้): ฿${f(cashRemaining)}</b>`)

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, lines.join('\n'))
}

/* ── แจ้งเตือนพนักงานให้ส่วนลด/แก้ราคา ── */
export async function notifyDiscount({ empName, receiptNo, discItems, billDisc, tierName, tierDisc, totalDisc, total, shopName }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const f = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  const lines = [
    `⚠️ <b>พนักงานให้ส่วนลด</b>`,
    `🏪 ${shopName || 'ร้านค้า'}  |  👤 ${empName || '?'}`,
    `📄 ${receiptNo}`,
    ``,
  ]

  for (const i of (discItems || [])) {
    if (i.origPrice !== undefined && i.price !== i.origPrice) {
      const diff = (i.origPrice - i.price) * i.qty
      lines.push(`  • ${i.name} ×${i.qty}  ฿${f(i.origPrice)} → ฿${f(i.price)}  (ลด ฿${f(diff)})`)
    } else if (i.disc > 0) {
      lines.push(`  • ${i.name} ×${i.qty}  ส่วนลด −฿${f(i.disc)}`)
    }
  }

  if (tierName && tierDisc > 0) lines.push(`  ${tierName}: −฿${f(tierDisc)}`)
  if (billDisc > 0) lines.push(`  ส่วนลดบิล: −฿${f(billDisc)}`)

  lines.push(``)
  lines.push(`รวมลด: −฿${f(totalDisc)}  |  ยอดสุทธิ: ฿${f(total)}`)

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, lines.join('\n'))
}

/* ── แจ้งเตือนคำขอเบิก ── */
export async function notifyAdvance({ id, empName, amount, note }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const lines = [
    `💵 <b>คำขอเบิก</b>`,
    `──────────────`,
    `👤 พนักงาน: <b>${empName}</b>`,
    `💰 ยอดเบิก: <b>฿${Number(amount).toLocaleString('th-TH')}</b>`,
    ...(note ? [`📝 หมายเหตุ: ${note}`] : []),
  ]

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, lines.join('\n'), {
    inline_keyboard: [[
      { text: '✅ อนุมัติ', callback_data: `approve_advance:${id}` },
      { text: '❌ ปฏิเสธ', callback_data: `reject_advance:${id}` },
    ]],
  })
}
