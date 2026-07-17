import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  : ''

async function getLineSettings() {
  const { data } = await supabase.from('settings')
    .select('key, value')
    .in('key', ['line_channel_token', 'line_group_id', 'shop_name'])
  if (!data) return null
  const s = Object.fromEntries(data.map(r => [r.key, r.value]))
  if (!s.line_channel_token || !s.line_group_id) return null
  return s
}

async function pushFlex(token, groupId, altText, bubble) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: 'flex', altText, contents: bubble }],
    }),
  })
  const body = await res.json().catch(() => ({}))
  console.log('[LINE push]', res.status, JSON.stringify(body))
  if (!res.ok) throw new Error(`LINE ${res.status}: ${body.message || ''}`)
  return res
}

export async function replyText(replyToken, token, text) {
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  })
}

function infoRow(icon, label, value, valueColor = '#1e293b') {
  return {
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [
      { type: 'text', text: `${icon}  ${label}`, size: 'sm', color: '#64748b', flex: 4 },
      { type: 'text', text: String(value), size: 'sm', color: valueColor, weight: 'bold', flex: 5, align: 'end', wrap: true },
    ],
  }
}

function separator() {
  return { type: 'separator', margin: 'sm', color: '#e2e8f0' }
}

function approveFooter(approveData, rejectData, approveText, rejectText) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px',
    contents: [
      {
        type: 'button', style: 'primary', color: '#16a34a', height: 'sm',
        action: { type: 'postback', label: '✅ อนุมัติ', data: approveData, displayText: approveText },
      },
      {
        type: 'button', style: 'secondary', height: 'sm',
        action: { type: 'postback', label: '✗ ปฏิเสธ', data: rejectData, displayText: rejectText },
      },
    ],
  }
}

/* ── แจ้งเตือนคำขอลา ── */
export async function notifyLeave({ id, empName, dateFrom, dateTo, period, leaveType, note }) {
  const cfg = await getLineSettings()
  if (!cfg) return

  const shopName = cfg.shop_name || 'ช่างเชิด'
  const dateStr = dateFrom === dateTo
    ? fmtDate(dateFrom)
    : `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
  const periodMap   = { full: 'เต็มวัน', morning: 'ครึ่งเช้า', afternoon: 'ครึ่งบ่าย' }
  const leaveTypeMap = { holiday: 'วันหยุด', sick: 'ลาป่วย', personal: 'ธุระส่วนตัว', other: 'อื่นๆ' }

  const rows = [
    infoRow('👤', 'พนักงาน', empName),
    separator(),
    infoRow('📅', 'วันที่', dateStr),
    separator(),
    infoRow('⏰', 'ช่วงเวลา', periodMap[period] || period || 'เต็มวัน'),
    separator(),
    infoRow('🏷', 'ประเภทการลา', leaveTypeMap[leaveType] || leaveType || 'วันหยุด'),
    ...(note ? [separator(), infoRow('📝', 'หมายเหตุ', note, '#64748b')] : []),
  ]

  const bubble = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#d97706', paddingAll: '14px',
      contents: [
        { type: 'text', text: '📋  คำขอลา', color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: shopName, color: '#fef3c7', size: 'xs', margin: 'xs' },
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: rows },
    footer: approveFooter(
      `approve_leave:${id}`, `reject_leave:${id}`,
      `อนุมัติการลา - ${empName}`, `ไม่อนุมัติการลา - ${empName}`
    ),
  }

  await pushFlex(cfg.line_channel_token, cfg.line_group_id, `📋 คำขอลา - ${empName} (${dateStr})`, bubble)
}

/* ── แจ้งเตือนคำขอเบิก ── */
export async function notifyAdvance({ id, empName, amount, note }) {
  const cfg = await getLineSettings()
  if (!cfg) return

  const shopName  = cfg.shop_name || 'ช่างเชิด'
  const amountStr = `฿${Number(amount).toLocaleString('th-TH')}`

  const rows = [
    infoRow('👤', 'พนักงาน', empName),
    separator(),
    infoRow('💰', 'ยอดเบิก', amountStr, '#ea580c'),
    ...(note ? [separator(), infoRow('📝', 'หมายเหตุ', note, '#64748b')] : []),
  ]

  const bubble = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#ea580c', paddingAll: '14px',
      contents: [
        { type: 'text', text: '💵  คำขอเบิก', color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: shopName, color: '#ffedd5', size: 'xs', margin: 'xs' },
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: rows },
    footer: approveFooter(
      `approve_advance:${id}`, `reject_advance:${id}`,
      `อนุมัติการเบิก - ${empName}`, `ไม่อนุมัติการเบิก - ${empName}`
    ),
  }

  await pushFlex(cfg.line_channel_token, cfg.line_group_id, `💵 คำขอเบิก - ${empName} ${amountStr}`, bubble)
}

/* ── แจ้งเตือนคำขอเปิดลิ้นชัก ── */
export async function notifyDrawerRequest({ id, empName, note }) {
  const cfg = await getLineSettings()
  if (!cfg) return

  const shopName = cfg.shop_name || 'ช่างเชิด'
  const now = new Date().toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
  })
  const today = new Date().toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit',
  })

  const rows = [
    infoRow('👤', 'พนักงาน', empName),
    separator(),
    infoRow('📅', 'วันที่', today),
    separator(),
    infoRow('🕐', 'เวลา', now),
    ...(note ? [separator(), infoRow('📝', 'หมายเหตุ', note, '#64748b')] : []),
  ]

  const bubble = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#7c3aed', paddingAll: '14px',
      contents: [
        { type: 'text', text: '🔓  คำขอเปิดลิ้นชัก', color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: shopName, color: '#ede9fe', size: 'xs', margin: 'xs' },
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: rows },
    footer: approveFooter(
      `approve_drawer:${id}`, `reject_drawer:${id}`,
      `อนุมัติเปิดลิ้นชัก - ${empName}`, `ไม่อนุมัติเปิดลิ้นชัก - ${empName}`
    ),
  }

  await pushFlex(cfg.line_channel_token, cfg.line_group_id, `🔓 คำขอเปิดลิ้นชัก - ${empName} ${now}`, bubble)
}

export { getLineSettings }
