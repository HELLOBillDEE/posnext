import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  : ''

async function getLineSettings() {
  const { data } = await supabase.from('settings')
    .select('key, value')
    .in('key', ['line_channel_token', 'line_group_id'])
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

/* ── แจ้งเตือนคำขอลา ── */
export async function notifyLeave({ id, empName, dateFrom, dateTo, note }) {
  const cfg = await getLineSettings()
  if (!cfg) return

  const dateStr = dateFrom === dateTo
    ? fmtDate(dateFrom)
    : `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`

  const bubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box', layout: 'vertical',
      backgroundColor: '#f59e0b', paddingAll: '14px',
      contents: [{ type: 'text', text: '🏖  คำขอลา', color: '#ffffff', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: [
        { type: 'text', text: empName, weight: 'bold', size: 'lg', color: '#1e293b' },
        { type: 'text', text: dateStr, size: 'sm', color: '#475569' },
        ...(note ? [{ type: 'text', text: note, size: 'sm', color: '#94a3b8', wrap: true }] : []),
      ],
    },
    footer: {
      type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px',
      contents: [
        {
          type: 'button', style: 'primary', color: '#22c55e', height: 'sm',
          action: { type: 'postback', label: '✅ อนุมัติ', data: `approve_leave:${id}`, displayText: `อนุมัติการลา - ${empName}` },
        },
        {
          type: 'button', style: 'primary', color: '#ef4444', height: 'sm',
          action: { type: 'postback', label: '❌ ปฏิเสธ', data: `reject_leave:${id}`, displayText: `ไม่อนุมัติการลา - ${empName}` },
        },
      ],
    },
  }

  await pushFlex(cfg.line_channel_token, cfg.line_group_id, `คำขอลา - ${empName}`, bubble)
}

/* ── แจ้งเตือนคำขอเบิก ── */
export async function notifyAdvance({ id, empName, amount }) {
  const cfg = await getLineSettings()
  if (!cfg) return

  const amountStr = `฿${Number(amount).toLocaleString('th-TH')}`

  const bubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box', layout: 'vertical',
      backgroundColor: '#f97316', paddingAll: '14px',
      contents: [{ type: 'text', text: '💵  คำขอเบิก', color: '#ffffff', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: [
        { type: 'text', text: empName, weight: 'bold', size: 'lg', color: '#1e293b' },
        { type: 'text', text: amountStr, size: 'xxl', weight: 'bold', color: '#f97316' },
      ],
    },
    footer: {
      type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '12px',
      contents: [
        {
          type: 'button', style: 'primary', color: '#22c55e', height: 'sm',
          action: { type: 'postback', label: '✅ อนุมัติ', data: `approve_advance:${id}`, displayText: `อนุมัติการเบิก - ${empName}` },
        },
        {
          type: 'button', style: 'primary', color: '#ef4444', height: 'sm',
          action: { type: 'postback', label: '❌ ปฏิเสธ', data: `reject_advance:${id}`, displayText: `ไม่อนุมัติการเบิก - ${empName}` },
        },
      ],
    },
  }

  await pushFlex(cfg.line_channel_token, cfg.line_group_id, `คำขอเบิก - ${empName}`, bubble)
}

export { getLineSettings }
