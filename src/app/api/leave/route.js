import { createClient } from '@supabase/supabase-js'
import { notifyLeave } from '@/lib/telegramStaff'
import { sendPushToAll } from '@/lib/webPush'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { employee_id, pin, password, leave_type, date_from, date_to, note, leave_period } = await req.json()
    if (!employee_id || (!pin && !password)) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    let eq = supabase.from('employees').select('id, name, nickname').eq('id', employee_id).eq('active', true)
    if (password) eq = eq.eq('password', password.trim())
    else eq = eq.eq('pin', pin.trim())
    const { data: emp } = await eq.maybeSingle()
    if (!emp) return Response.json({ error: password ? 'รหัสผ่านไม่ถูกต้อง' : 'PIN ไม่ถูกต้อง' }, { status: 401 })

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const from  = date_from || today
    const to    = (leave_period === 'morning' || leave_period === 'afternoon') ? from : (date_to || from)
    const period = leave_period || 'full'

    // ตรวจสอบซ้ำ: ห้ามลาซ้ำวันเดิม/ช่วงเดิม
    const { data: conflicts } = await supabase
      .from('leave_requests')
      .select('id, date_from, date_to, leave_period')
      .eq('employee_id', emp.id)
      .in('status', ['pending', 'approved'])
      .lte('date_from', to)
      .gte('date_to', from)

    if (conflicts?.length > 0) {
      for (const c of conflicts) {
        if (period === 'full' || c.leave_period === 'full') {
          return Response.json({ error: 'มีคำขอลาในช่วงวันนี้อยู่แล้ว' }, { status: 409 })
        }
        if (period === c.leave_period) {
          return Response.json({ error: `มีคำขอลา${period === 'morning' ? 'เช้า' : 'บ่าย'}ในวันนี้อยู่แล้ว` }, { status: 409 })
        }
      }
    }

    const { data: inserted } = await supabase.from('leave_requests').insert({
      employee_id: emp.id,
      leave_type: leave_type || 'holiday',
      leave_period: period,
      date_from: from,
      date_to: to,
      note: note || null,
      status: 'pending',
    }).select('id').single()

    if (inserted?.id) {
      const empName  = emp.nickname || emp.name
      const fmtD = d => new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
      const dateStr  = from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`
      notifyLeave({ id: inserted.id, empName, dateFrom: from, dateTo: to, period, leaveType: leave_type, note: note || null })
        .catch(e => console.error('[leave notify]', e?.message))
      sendPushToAll({
        title: '🏖 คำขอลา',
        body: `${empName} — ${dateStr}${note ? `\n${note}` : ''}`,
        tag: `leave-${inserted.id}`,
        actions: [
          { action: 'approve', title: '✅ อนุมัติ' },
          { action: 'reject',  title: '❌ ปฏิเสธ' },
        ],
        meta: { type: 'leave', id: inserted.id },
      }).catch(() => {})
    }

    return Response.json({ name: emp.nickname || emp.name, leave_type, date_from: from, date_to: to, leave_period: period })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
