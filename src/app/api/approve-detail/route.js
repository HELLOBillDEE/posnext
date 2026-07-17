import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  : ''

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const id   = searchParams.get('id')
  if (!type || !id) return Response.json({ error: 'ไม่ระบุ type/id' }, { status: 400 })

  try {
    if (type === 'drawer') {
      const { data } = await supabase
        .from('drawer_requests')
        .select('id, employee_name, note, status, created_at')
        .eq('id', id).maybeSingle()
      if (!data) return Response.json({ error: 'ไม่พบรายการ' }, { status: 404 })
      const time = new Date(data.created_at).toLocaleTimeString('th-TH', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit',
      })
      const date = new Date(data.created_at).toLocaleDateString('th-TH', {
        timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit',
      })
      return Response.json({
        type, id, status: data.status,
        title: '🔓 คำขอเปิดลิ้นชัก',
        rows: [
          { label: '👤 พนักงาน', value: data.employee_name },
          { label: '📅 วันที่', value: date },
          { label: '🕐 เวลา', value: time },
          ...(data.note ? [{ label: '📝 หมายเหตุ', value: data.note }] : []),
        ],
      })
    }

    if (type === 'leave') {
      const { data } = await supabase
        .from('leave_requests')
        .select('id, employee_id, leave_type, leave_period, date_from, date_to, note, status')
        .eq('id', id).maybeSingle()
      if (!data) return Response.json({ error: 'ไม่พบรายการ' }, { status: 404 })
      const { data: emp } = await supabase.from('employees')
        .select('name, nickname').eq('id', data.employee_id).maybeSingle()
      const empName = emp?.nickname || emp?.name || '-'
      const dateStr = data.date_from === data.date_to
        ? fmtDate(data.date_from)
        : `${fmtDate(data.date_from)} – ${fmtDate(data.date_to)}`
      const periodMap = { full: 'เต็มวัน', morning: 'ครึ่งเช้า', afternoon: 'ครึ่งบ่าย' }
      const leaveMap  = { holiday: 'วันหยุด', sick: 'ลาป่วย', personal: 'ธุระส่วนตัว', other: 'อื่นๆ' }
      return Response.json({
        type, id, status: data.status,
        title: '📋 คำขอลา',
        rows: [
          { label: '👤 พนักงาน', value: empName },
          { label: '📅 วันที่', value: dateStr },
          { label: '⏰ ช่วงเวลา', value: periodMap[data.leave_period] || data.leave_period },
          { label: '🏷 ประเภท', value: leaveMap[data.leave_type] || data.leave_type },
          ...(data.note ? [{ label: '📝 หมายเหตุ', value: data.note }] : []),
        ],
      })
    }

    if (type === 'advance') {
      const { data } = await supabase
        .from('salary_advances')
        .select('id, employee_id, amount, note, status')
        .eq('id', id).maybeSingle()
      if (!data) return Response.json({ error: 'ไม่พบรายการ' }, { status: 404 })
      const { data: emp } = await supabase.from('employees')
        .select('name, nickname').eq('id', data.employee_id).maybeSingle()
      const empName = emp?.nickname || emp?.name || '-'
      return Response.json({
        type, id, status: data.status,
        title: '💵 คำขอเบิก',
        rows: [
          { label: '👤 พนักงาน', value: empName },
          { label: '💰 ยอดเบิก', value: `฿${Number(data.amount).toLocaleString('th-TH')}`, highlight: true },
          ...(data.note ? [{ label: '📝 หมายเหตุ', value: data.note }] : []),
        ],
      })
    }

    return Response.json({ error: 'ประเภทไม่ถูกต้อง' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
