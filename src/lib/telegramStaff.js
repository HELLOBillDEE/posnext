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
    .in('key', ['telegram_bot_token', 'telegram_chat_id'])
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
  await supabase.from('settings').upsert(
    { key: 'telegram_chat_id', value: String(chatId) },
    { onConflict: 'key' }
  )
}

export async function getTgSettings() {
  return getTelegramSettings()
}

/* ── แจ้งเตือนคำขอลา ── */
export async function notifyLeave({ id, empName, dateFrom, dateTo, note }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const dateStr = dateFrom === dateTo
    ? fmtDate(dateFrom)
    : `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`

  const text = [
    `🏖 <b>คำขอลา</b>`,
    `👤 ${empName}`,
    `📅 ${dateStr}`,
    note ? `📝 ${note}` : null,
  ].filter(Boolean).join('\n')

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, text, {
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

  const now = new Date().toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
  })

  const text = [
    `🔓 <b>คำขอเปิดลิ้นชัก</b>`,
    `👤 ${empName}`,
    `🕐 ${now}`,
    note ? `📝 ${note}` : null,
  ].filter(Boolean).join('\n')

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, text, {
    inline_keyboard: [[
      { text: '✅ อนุมัติ', callback_data: `approve_drawer:${id}` },
      { text: '❌ ปฏิเสธ', callback_data: `reject_drawer:${id}` },
    ]],
  })
}

/* ── แจ้งเตือนคำขอเบิก ── */
export async function notifyAdvance({ id, empName, amount }) {
  const cfg = await getTelegramSettings()
  if (!cfg) return

  const text = [
    `💵 <b>คำขอเบิก</b>`,
    `👤 ${empName}`,
    `💰 ฿${Number(amount).toLocaleString('th-TH')}`,
  ].join('\n')

  await sendMessage(cfg.telegram_bot_token, cfg.telegram_chat_id, text, {
    inline_keyboard: [[
      { text: '✅ อนุมัติ', callback_data: `approve_advance:${id}` },
      { text: '❌ ปฏิเสธ', callback_data: `reject_advance:${id}` },
    ]],
  })
}
