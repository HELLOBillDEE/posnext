import { createClient } from '@supabase/supabase-js'
import { answerCallback, editMessageText, saveChatId, getTgSettings } from '@/lib/telegramStaff'

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

    /* ── บันทึก chat_id อัตโนมัติจากข้อความแรกในกลุ่ม ── */
    const msg = body.message || body.edited_message
    if (msg?.chat?.id && msg?.chat?.type !== 'private') {
      await saveChatId(msg.chat.id)
    }

    /* ── Callback query: กดปุ่ม อนุมัติ/ปฏิเสธ ── */
    const cb = body.callback_query
    if (!cb) return new Response('OK', { status: 200 })

    const cfg = await getTgSettings()
    if (!cfg) return new Response('OK', { status: 200 })

    const data = cb.data || ''
    const [action, idStr] = data.split(':')
    const id = parseInt(idStr)
    if (!id || isNaN(id)) return new Response('OK', { status: 200 })

    const chatId    = cb.message?.chat?.id
    const messageId = cb.message?.message_id
    const byName    = cb.from?.first_name || 'admin'

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
        await answerCallback(cfg.telegram_bot_token, cb.id, `${word}`)
        await editMessageText(cfg.telegram_bot_token, chatId, messageId,
          `🏖 <b>คำขอลา</b> — ${empName} (${dateStr})\n${emoji} ${word} โดย ${byName}`)
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

      if (adv) {
        const empName = adv.employees?.nickname || adv.employees?.name || '?'
        const amtStr  = `฿${Number(adv.amount).toLocaleString('th-TH')}`
        const emoji   = status === 'approved' ? '✅' : '❌'
        const word    = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
        await answerCallback(cfg.telegram_bot_token, cb.id, `${word}`)
        await editMessageText(cfg.telegram_bot_token, chatId, messageId,
          `💵 <b>คำขอเบิก</b> — ${empName} ${amtStr}\n${emoji} ${word} โดย ${byName}`)
      }
    }

    if (action === 'approve_drawer' || action === 'reject_drawer') {
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
        }
        const emoji = status === 'approved' ? '✅' : '❌'
        const word  = status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'
        await answerCallback(cfg.telegram_bot_token, cb.id, word)
        await editMessageText(cfg.telegram_bot_token, chatId, messageId,
          `🔓 <b>คำขอเปิดลิ้นชัก</b> — ${dr.employee_name}\n${emoji} ${word} โดย ${byName}`)
      }
    }

    return new Response('OK', { status: 200 })
  } catch (e) {
    console.error('[telegram-webhook]', e.message)
    return new Response('OK', { status: 200 })
  }
}

export async function GET() {
  return new Response('Telegram webhook OK', { status: 200 })
}
