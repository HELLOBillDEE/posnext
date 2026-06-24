import { createClient } from '@supabase/supabase-js'

const posSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// ดึง LINE channel token และ group ID จาก pos.settings
export async function getLineSettings() {
  const { data } = await posSupabase.from('settings')
    .select('key,value')
    .in('key', ['line_channel_token', 'line_group_id'])
  if (!data?.length) return {}
  return Object.fromEntries(data.map(r => [r.key, r.value]))
}

// Reply ด้วย reply token (ใช้ได้ครั้งเดียว ตอบทันที)
export async function replyMessage(replyToken, messages) {
  const { line_channel_token: token } = await getLineSettings()
  if (!token) return
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: Array.isArray(messages) ? messages : [messages] }),
  })
}

// Push ไปที่ group
export async function pushToGroup(messages) {
  const { line_channel_token: token, line_group_id: groupId } = await getLineSettings()
  if (!token || !groupId) return
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: Array.isArray(messages) ? messages : [messages] }),
  })
}

// ดาวน์โหลดรูปจาก LINE → base64
export async function downloadLineImage(messageId) {
  const { line_channel_token: token } = await getLineSettings()
  if (!token) return null
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const buf = await res.arrayBuffer()
  return Buffer.from(buf).toString('base64')
}

// สร้าง LIFF URL สำหรับ confirm bill
export function liffConfirmUrl(scanId) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID
  if (!liffId) return null
  const path = encodeURIComponent(`/liff/confirm?id=${scanId}`)
  return `https://liff.line.me/${liffId}?liff.state=${path}`
}

// สร้าง LIFF URL สำหรับเพิ่มรายรับ
export function liffIncomeUrl() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID
  if (!liffId) return null
  return `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent('/liff/income')}`
}

// Flex Message สำหรับผลสแกนบิล
export function buildBillFlexMessage(scanId, ai, bizName) {
  const liffUrl = liffConfirmUrl(scanId)
  const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const dueText = ai.due_date
    ? new Date(ai.due_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
    : 'ไม่ระบุ'

  return {
    type: 'flex',
    altText: `📋 อ่านบิลได้: ฿${fmt(ai.amount)} — กรุณายืนยัน`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1e3a5f', paddingAll: '12px',
        contents: [
          { type: 'text', text: '📋 อ่านบิลได้แล้ว', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: bizName || 'ธุรกิจ', color: '#93c5fd', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          _row('🏢 ผู้ออกบิล', ai.vendor || 'ไม่ระบุ'),
          _row('💰 ยอด', `฿${fmt(ai.amount)}`),
          _row('📅 ครบกำหนด', dueText),
          _row('📂 หมวด', ai.category || 'อื่นๆ'),
          ai.description
            ? { type: 'text', text: ai.description, size: 'xs', color: '#6b7280', wrap: true, margin: 'sm' }
            : { type: 'spacer', size: 'xs' },
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '10px',
        contents: [
          {
            type: 'button', style: 'primary', color: '#059669', height: 'sm',
            action: liffUrl
              ? { type: 'uri', label: '✅ ยืนยัน', uri: liffUrl }
              : { type: 'message', label: '✅ ยืนยัน', text: `ยืนยัน ${scanId}` },
          },
          {
            type: 'button', style: 'secondary', height: 'sm',
            action: { type: 'postback', label: '❌ ยกเลิก', data: `action=cancel_scan&id=${scanId}`, displayText: 'ยกเลิกบิลนี้' },
          },
        ],
      },
    },
  }
}

function _row(label, value) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#6b7280', flex: 2 },
      { type: 'text', text: String(value), size: 'sm', weight: 'bold', flex: 3, wrap: true },
    ],
  }
}
