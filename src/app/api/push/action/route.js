import { createClient } from '@supabase/supabase-js'
import { triggerDrawerVideo } from '@/lib/cameraRecord'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

export async function POST(req) {
  try {
    const { action, type, id, approved_by } = await req.json()
    if (!action || !type || !id) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })
    const approvedBy = approved_by || 'push'

    const status = action === 'approve' ? 'approved' : 'rejected'

    if (type === 'leave') {
      await supabase.from('leave_requests').update({ status }).eq('id', id)
    }

    if (type === 'advance') {
      const now = new Date().toISOString()
      await supabase.from('salary_advances').update({
        status,
        approved_at: status === 'approved' ? now : null,
        approved_by: status === 'approved' ? approvedBy : null,
      }).eq('id', id)
    }

    if (type === 'expense') {
      const now = new Date().toISOString()
      const { data: exp } = await supabase.from('expenses')
        .update({ status, approved_at: status === 'approved' ? now : null, approved_by: status === 'approved' ? approvedBy : null })
        .eq('id', id)
        .select('paid_by_employee_id, paid_by_name, amount, description, expense_date')
        .single()
      // เมื่ออนุมัติ → สร้าง salary_advance เบิกคืนให้พนักงาน
      if (exp && status === 'approved' && exp.paid_by_employee_id) {
        const { data: emp } = await supabase.from('employees').select('name,nickname').eq('id', exp.paid_by_employee_id).single()
        const empName = emp ? (emp.nickname || emp.name) : (exp.paid_by_name || 'ไม่ระบุ')
        await supabase.from('salary_advances').insert({
          employee_id: exp.paid_by_employee_id,
          employee_name: empName,
          amount: Number(exp.amount),
          note: `เบิกคืนค่าใช้จ่าย: ${exp.description || ''} (${exp.expense_date || ''})`,
          status: 'approved',
          approved_at: now,
          approved_by: approvedBy,
          requested_at: now,
        })
      }
    }

    if (type === 'drawer') {
      const { data: dr } = await supabase
        .from('drawer_requests')
        .update({ status })
        .eq('id', id)
        .select('employee_name, note')
        .single()

      if (dr && status === 'approved') {
        await supabase.from('drawer_logs').insert({
          employee_name: dr.employee_name,
          note: `คำขออนุมัติ${dr.note ? ` — ${dr.note}` : ''}`,
        })
        const now = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
        triggerDrawerVideo(`🔓 เปิดลิ้นชัก — ${dr.employee_name}  🕐 ${now}`)
      }
    }

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
