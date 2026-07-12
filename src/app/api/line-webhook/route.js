import { createClient } from '@supabase/supabase-js'
import { getLineSettings, replyText } from '@/lib/lineStaff'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  : ''

export async function POST(req) {
  try {
    const body = await req.json()
    const events = body.events || []

    for (const event of events) {
      /* ── บันทึก Group ID อัตโนมัติ ── */
      if (event.source?.type === 'group' && event.source?.groupId) {
        await supabase.from('settings').upsert(
          { key: 'line_group_id', value: event.source.groupId },
          { onConflict: 'key' }
        )
      }

      /* ── Postback: อนุมัติ / ปฏิเสธ ── */
      if (event.type === 'postback') {
        const data = event.postback?.data || ''
        const replyToken = event.replyToken

        const [action, idStr] = data.split(':')
        const id = parseInt(idStr)
        if (!id || isNaN(id)) continue

        const cfg = await getLineSettings()
        const token = cfg?.line_channel_token

        if (action === 'approve_leave' || action === 'reject_leave') {
          const status = action === 'approve_leave' ? 'approved' : 'rejected'
          const { data: leave } = await supabase
            .from('leave_requests')
            .update({ status })
            .eq('id', id)
            .select('date_from, date_to, employees(nickname, name)')
            .single()

          if (leave && token && replyToken) {
            const empName = leave.employees?.nickname || leave.employees?.name || '?'
            const dateStr = leave.date_from === leave.date_to
              ? fmtDate(leave.date_from)
              : `${fmtDate(leave.date_from)} – ${fmtDate(leave.date_to)}`
            const emoji = status === 'approved' ? '✅' : '❌'
            const word  = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, token, `${emoji} การลาของ ${empName} (${dateStr})\n${word}`)
          }
        }

        if (action === 'approve_advance' || action === 'reject_advance') {
          const status = action === 'approve_advance' ? 'approved' : 'rejected'
          const { data: adv } = await supabase
            .from('salary_advances')
            .update({ status })
            .eq('id', id)
            .select('amount, employees(nickname, name)')
            .single()

          if (adv && token && replyToken) {
            const empName = adv.employees?.nickname || adv.employees?.name || '?'
            const amtStr  = `฿${Number(adv.amount).toLocaleString('th-TH')}`
            const emoji   = status === 'approved' ? '✅' : '❌'
            const word    = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
            await replyText(replyToken, token, `${emoji} การเบิก ${amtStr} ของ ${empName}\n${word}`)
          }
        }
      }
    }

    return new Response('OK', { status: 200 })
  } catch {
    return new Response('OK', { status: 200 })
  }
}

export async function GET() {
  return new Response('LINE webhook OK', { status: 200 })
}
