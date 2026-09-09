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

export async function POST(req) {
  try {
    const body = await req.json()
    const events = body.events || []

    const cfg = await getLineSettings()
    if (!cfg) return new Response('OK', { status: 200 })

    const lineToken = cfg.line_channel_token

    for (const event of events) {
      if (event.type !== 'postback') continue

      const replyToken = event.replyToken
      const data = event.postback?.data || ''
      const byName = event.source?.userId ? 'แอดมิน' : 'แอดมิน'

      const [action, idStr] = data.split(':')
      const id = parseInt(idStr)
      if (!id || isNaN(id)) continue

      /* ── ลา ── */
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

      /* ── เบิกเงิน ── */
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
          const amtStr  = `฿${Number(adv.amount).toLocaleString('th-TH')}`
          const emoji   = status === 'approved' ? '✅' : '❌'
          const word    = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
          await replyText(replyToken, lineToken, `${emoji} คำขอเบิก — ${empName} ${amtStr}\n${word}`)
        }
      }

      /* ── เปิดลิ้นชัก ── */
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

    return new Response('OK', { status: 200 })
  } catch (e) {
    console.error('[line-webhook]', e.message)
    return new Response('OK', { status: 200 })
  }
}

export async function GET() {
  return new Response('LINE webhook OK', { status: 200 })
}
