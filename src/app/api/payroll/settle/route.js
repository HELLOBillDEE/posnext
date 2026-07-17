import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

// POST /api/payroll/settle — ปิดบัญชีรายเดือน
export async function POST(req) {
  try {
    const body = await req.json()
    const {
      employee_id, period, days_worked, daily_rate, gross_pay,
      streak_bonus, commission, total_withdrawn, installment_deduct,
      carry_forward_in, net_pay_due, note, settled_by,
      installment_updates, // [{ id, days_to_add }]
    } = body

    if (!employee_id || !period) return Response.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 })

    // carry_forward_out: ถ้า netPayDue < 0 แสดงว่าพนักงานยังติดหนี้ → ทบเดือนหน้า
    const carry_forward_out = net_pay_due < 0 ? Math.abs(net_pay_due) : 0

    // Upsert settlement record
    const { error: settleErr } = await supabase.from('payroll_settlements').upsert({
      employee_id,
      period,
      days_worked: Number(days_worked || 0),
      daily_rate: Number(daily_rate || 0),
      gross_pay: Number(gross_pay || 0),
      streak_bonus: Number(streak_bonus || 0),
      commission: Number(commission || 0),
      total_withdrawn: Number(total_withdrawn || 0),
      installment_deduct: Number(installment_deduct || 0),
      carry_forward_in: Number(carry_forward_in || 0),
      carry_forward_out: Number(carry_forward_out || 0),
      net_pay_due: Math.max(0, Number(net_pay_due || 0)),
      note: note || null,
      settled_at: new Date().toISOString(),
      settled_by: settled_by || 'admin',
    }, { onConflict: 'employee_id,period' })

    if (settleErr) throw settleErr

    // อัปเดต paid_days ของ installments ที่ถูกหักเดือนนี้
    if (installment_updates?.length) {
      for (const upd of installment_updates) {
        if (!upd.id || !upd.days_to_add) continue
        await supabase.rpc('increment_installment_paid_days', {
          p_id: upd.id,
          p_days: upd.days_to_add,
        }).then(null, () => {})
        // Fallback: manual update if RPC not exists
        const { data: inst } = await supabase.from('employee_installments')
          .select('paid_days, total_days').eq('id', upd.id).single()
        if (inst) {
          const newPaid = Math.min(inst.paid_days + upd.days_to_add, inst.total_days)
          await supabase.from('employee_installments')
            .update({ paid_days: newPaid, active: newPaid < inst.total_days })
            .eq('id', upd.id)
        }
      }
    }

    return Response.json({ ok: true, carry_forward_out })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
