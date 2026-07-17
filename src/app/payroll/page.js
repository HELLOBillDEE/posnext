'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'

const MONTH_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function fmt(n) { return Number(n || 0).toLocaleString('th-TH') }
function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
}

// ---- Installment Modal ----
function InstallmentModal({ empId, empName, onClose, onSaved }) {
  const [list, setList]   = useState([])
  const [form, setForm]   = useState({ name: '', amount_per_day: '', total_days: '', start_date: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/payroll/installment?employee_id=${empId}`)
      .then(r => r.json()).then(d => setList(Array.isArray(d) ? d : []))
  }, [empId])

  async function add() {
    if (!form.name || !form.amount_per_day || !form.total_days) return
    setSaving(true)
    const res = await fetch('/api/payroll/installment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: empId, ...form, amount_per_day: Number(form.amount_per_day), total_days: Number(form.total_days), start_date: form.start_date || null }),
    })
    const data = await res.json()
    if (!data.error) { setList(p => [...p, data]); setForm({ name: '', amount_per_day: '', total_days: '', start_date: '' }); onSaved() }
    setSaving(false)
  }

  async function toggle(inst) {
    await fetch('/api/payroll/installment', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: inst.id, active: !inst.active }),
    })
    setList(p => p.map(i => i.id === inst.id ? { ...i, active: !i.active } : i))
    onSaved()
  }

  async function remove(id) {
    if (!confirm('ลบรายการผ่อนนี้?')) return
    await fetch(`/api/payroll/installment?id=${id}`, { method: 'DELETE' })
    setList(p => p.filter(i => i.id !== id))
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="bg-violet-600 text-white px-4 py-3 flex justify-between items-center">
          <h3 className="font-bold">💳 รายการผ่อน — {empName}</h3>
          <button onClick={onClose} className="text-xl opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {list.length === 0 && <p className="text-slate-400 text-sm text-center py-4">ยังไม่มีรายการผ่อน</p>}
          {list.map(inst => {
            const remaining = inst.total_days - inst.paid_days
            const pct = Math.round((inst.paid_days / inst.total_days) * 100)
            return (
              <div key={inst.id} className={`border rounded-xl p-3 ${inst.active ? 'border-violet-200 bg-violet-50' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{inst.name}</p>
                    <p className="text-xs text-slate-500">฿{fmt(inst.amount_per_day)}/วัน × {inst.total_days} วัน</p>
                    {inst.start_date && <p className="text-xs text-slate-400">เริ่ม {new Date(inst.start_date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => toggle(inst)} className={`text-xs px-2 py-0.5 rounded-full ${inst.active ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-600'}`}>
                      {inst.active ? 'หยุด' : 'เปิด'}
                    </button>
                    <button onClick={() => remove(inst.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span>ชำระแล้ว {inst.paid_days} วัน</span>
                    <span>เหลือ {remaining} วัน ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            )
          })}

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-slate-500 mb-2">+ เพิ่มรายการผ่อนใหม่</p>
            <input placeholder="ชื่อรายการ (เช่น ผ่อนโทรศัพท์)" value={form.name}
              onChange={e => setForm(p=>({...p, name: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-violet-400" />
            <div className="flex gap-2 mb-2">
              <div className="flex-1">
                <label className="text-[10px] text-slate-400">ตัดต่อวัน (บาท)</label>
                <input type="number" placeholder="50" value={form.amount_per_day}
                  onChange={e => setForm(p=>({...p, amount_per_day: e.target.value}))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-400" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-slate-400">จำนวนวัน</label>
                <input type="number" placeholder="80" value={form.total_days}
                  onChange={e => setForm(p=>({...p, total_days: e.target.value}))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-400" />
              </div>
            </div>
            <div className="mb-2">
              <label className="text-[10px] text-slate-400">วันเริ่มผ่อน (ไม่บังคับ — ค่าเริ่มต้น: เดือนนี้)</label>
              <input type="date" value={form.start_date}
                onChange={e => setForm(p=>({...p, start_date: e.target.value}))}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-400" />
            </div>
            <button onClick={add} disabled={saving || !form.name || !form.amount_per_day || !form.total_days}
              className="w-full py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40">
              {saving ? '...' : '+ เพิ่มรายการ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Bonus Modal ----
function BonusModal({ empId, empName, period, onClose, onSaved }) {
  const [list, setList]     = useState([])
  const [amount, setAmount] = useState('')
  const [note, setNote]     = useState('')
  const [paidCash, setPaidCash] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/payroll/bonus?employee_id=${empId}&period=${period}`)
      .then(r => r.json()).then(d => setList(Array.isArray(d) ? d : []))
  }, [empId, period])

  async function add() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return
    setSaving(true)
    const res = await fetch('/api/payroll/bonus', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: empId, period, amount: Number(amount), note: note.trim() || null, paid_cash: paidCash }),
    })
    const data = await res.json()
    if (!data.error) {
      setList(p => [...p, data])
      setAmount(''); setNote(''); setPaidCash(false)
      onSaved()
    }
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('ลบโบนัสนี้?')) return
    await fetch(`/api/payroll/bonus?id=${id}`, { method: 'DELETE' })
    setList(p => p.filter(b => b.id !== id))
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="bg-amber-500 text-white px-4 py-3 flex justify-between items-center">
          <h3 className="font-bold">🎁 โบนัส — {empName}</h3>
          <button onClick={onClose} className="text-xl opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {list.length === 0 && <p className="text-slate-400 text-sm text-center py-4">ยังไม่มีโบนัสเดือนนี้</p>}
          {list.map(b => (
            <div key={b.id} className="flex items-center justify-between border border-amber-100 bg-amber-50 rounded-xl px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">{b.note || 'โบนัสพิเศษ'}</p>
                <p className="text-xs text-emerald-600 font-bold">+฿{Number(b.amount).toLocaleString('th-TH')}</p>
              </div>
              <button onClick={() => remove(b.id)} className="text-xs text-red-400 hover:text-red-600 ml-3">✕</button>
            </div>
          ))}

          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500">+ เพิ่มโบนัส</p>
            <input type="number" placeholder="จำนวนเงิน (บาท)" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
            <input placeholder="หมายเหตุ เช่น โบนัส 10 วันติด" value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={paidCash} onChange={e => setPaidCash(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500" />
              <span className="text-sm text-slate-600">รับเงินสดไปแล้ว (หักออกจากยอดจ่าย)</span>
            </label>
            <button onClick={add} disabled={saving || !amount}
              className="w-full py-2 bg-amber-500 text-white rounded-xl text-sm font-semibold disabled:opacity-40">
              {saving ? '...' : '+ เพิ่มโบนัส'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Employee Payroll Card ----
function EmpCard({ emp, period, onSettled }) {
  const [settling, setSettling]     = useState(false)
  const [unsettling, setUnsettling] = useState(false)
  const [showInst, setShowInst]     = useState(false)
  const [showBonus, setShowBonus]   = useState(false)
  const [expanded, setExpanded]     = useState(false)
  const [editRate, setEditRate]   = useState(false)
  const [rateVal, setRateVal]     = useState(String(emp.daily_rate || ''))
  const isSettled = !!emp.settled

  async function saveRate() {
    const rate = parseFloat(rateVal)
    if (isNaN(rate) || rate < 0) return
    await fetch('/api/payroll', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: emp.id, daily_rate: rate }),
    })
    setEditRate(false)
    onSettled()
  }

  async function unsettle() {
    if (!confirm(`ยกเลิกปิดบัญชีของ ${emp.nickname || emp.name}?\nรายการผ่อนจะถูกคืนกลับด้วย`)) return
    setUnsettling(true)
    await fetch(`/api/payroll/settle?employee_id=${emp.id}&period=${period}`, { method: 'DELETE' })
    setUnsettling(false)
    onSettled()
  }

  async function settle() {
    if (!confirm(`ปิดบัญชีเดือนนี้ให้ ${emp.nickname || emp.name}?\nพนักงานได้รับเงิน ฿${fmt(Math.max(0, emp.netPayDue))}`)) return
    setSettling(true)
    const installment_updates = emp.installmentDetail
      .filter(i => i.thisMonth > 0)
      .map(i => ({ id: i.id, days_to_add: i.thisMonth }))

    await fetch('/api/payroll/settle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: emp.id, period,
        days_worked: emp.daysWorked,
        daily_rate: emp.daily_rate,
        gross_pay: emp.grossPay,
        streak_bonus: emp.streakBonus,
        commission: emp.commission,
        total_withdrawn: emp.totalWithdrawn,
        installment_deduct: emp.installmentDeduct,
        carry_forward_in: emp.carryForwardIn,
        net_pay_due: emp.netPayDue,
        settled_by: 'admin',
        installment_updates,
      }),
    })
    setSettling(false)
    onSettled()
  }

  function printSlip() {
    const [y, m] = period.split('-').map(Number)
    const monthLabel = `${MONTH_TH[m-1]} ${y}`
    const name = emp.nickname || emp.name
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>สลิปเงินเดือน ${name}</title>
<style>
  body{font-family:Arial,sans-serif;max-width:320px;margin:0 auto;padding:16px;font-size:13px}
  h2{text-align:center;margin:0 0 4px;font-size:16px}
  .sub{text-align:center;color:#666;margin-bottom:12px;font-size:12px}
  .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee}
  .row.total{border-top:2px solid #333;border-bottom:none;font-weight:bold;font-size:14px;margin-top:4px}
  .deduct{color:#dc2626}
  .earn{color:#16a34a}
  .net{color:#2563eb;font-size:16px}
  footer{text-align:center;color:#999;font-size:10px;margin-top:16px}
</style></head><body>
<h2>สลิปค่าแรง</h2>
<div class="sub">${name} · ${monthLabel}</div>
<div class="row"><span>วันทำงาน</span><span>${emp.daysWorked} วัน</span></div>
<div class="row"><span>ค่าแรง (${fmt(emp.daily_rate)}/วัน)</span><span class="earn">฿${fmt(emp.grossPay)}</span></div>
${emp.streakBonus>0?`<div class="row"><span>โบนัส 10 วันติด</span><span class="earn">+฿${fmt(emp.streakBonus)}</span></div>`:''}
${(emp.bonusDetail||[]).map(b=>`<div class="row"><span>${b.note||'โบนัสพิเศษ'}</span><span class="earn">+฿${fmt(b.amount)}</span></div>`).join('')}
${emp.commission>0?`<div class="row"><span>ค่าคอม (${emp.repair_commission_pct}%)</span><span class="earn">+฿${fmt(emp.commission)}</span></div>`:''}
<div class="row"><span>รวมรายได้</span><span class="earn">฿${fmt(emp.totalEarned)}</span></div>
<div style="height:8px"></div>
${emp.totalWithdrawn>0?`<div class="row"><span>เบิกไปแล้ว</span><span class="deduct">-฿${fmt(emp.totalWithdrawn)}</span></div>`:''}
${emp.installmentDetail.filter(i=>i.deductAmount>0).map(i=>`<div class="row"><span>${i.name} (${i.thisMonth} วัน)</span><span class="deduct">-฿${fmt(i.deductAmount)}</span></div>`).join('')}
${emp.carryForwardIn>0?`<div class="row"><span>ทบจากเดือนก่อน</span><span class="deduct">-฿${fmt(emp.carryForwardIn)}</span></div>`:''}
<div class="row total"><span>${emp.netPayDue>=0?'คงเหลือจ่าย':'ทบเดือนหน้า'}</span><span class="${emp.netPayDue>=0?'net':'deduct'}">${emp.netPayDue>=0?'':'−'}฿${fmt(Math.abs(emp.netPayDue))}</span></div>
<footer>พิมพ์ ${new Date().toLocaleDateString('th-TH')}</footer>
</body></html>`
    const w = window.open('', '_blank', 'width=380,height=600')
    w.document.write(html)
    w.document.close()
    w.print()
  }

  return (
    <>
      {showInst  && <InstallmentModal empId={emp.id} empName={emp.nickname||emp.name} onClose={() => setShowInst(false)}  onSaved={onSettled} />}
      {showBonus && <BonusModal empId={emp.id} empName={emp.nickname||emp.name} period={period} onClose={() => setShowBonus(false)} onSaved={onSettled} />}
      <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${isSettled ? 'border-emerald-200' : 'border-slate-100'}`}>
        {/* Header */}
        <div className={`px-4 py-3 flex items-center justify-between ${isSettled ? 'bg-emerald-50' : 'bg-slate-50'}`}>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800">{emp.nickname || emp.name}</p>
            {editRate ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-slate-400">฿</span>
                <input autoFocus type="number" value={rateVal} onChange={e => setRateVal(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter') saveRate(); if (e.key==='Escape') setEditRate(false) }}
                  className="w-24 text-xs border border-slate-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-brand" />
                <span className="text-xs text-slate-400">/วัน</span>
                <button onClick={saveRate} className="text-xs text-emerald-600 font-semibold">บันทึก</button>
                <button onClick={() => setEditRate(false)} className="text-xs text-slate-400">ยกเลิก</button>
              </div>
            ) : (
              <button onClick={() => { setRateVal(String(emp.daily_rate||'')); setEditRate(true) }}
                className="text-xs text-slate-500 hover:text-brand text-left">
                {emp.position}{emp.position ? ' · ' : ''}
                <span className={emp.daily_rate ? 'text-slate-600' : 'text-red-400 font-medium'}>
                  {emp.daily_rate ? `฿${fmt(emp.daily_rate)}/วัน` : '⚠️ ยังไม่ตั้งค่าแรง'}
                </span>
                <span className="text-slate-300 ml-1">✎</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isSettled && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">✅ ปิดแล้ว</span>}
            <button onClick={() => setExpanded(p => !p)} className="text-slate-400 text-lg w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200">
              {expanded ? '▲' : '▼'}
            </button>
          </div>
        </div>

        {/* Summary row */}
        <div className="px-4 py-3 grid grid-cols-4 gap-2 text-center border-b border-slate-50">
          <div>
            <p className="text-[10px] text-slate-400">วันทำงาน</p>
            <p className="font-bold text-slate-800">{emp.daysWorked}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400">รายได้รวม</p>
            <p className="font-bold text-emerald-600">฿{fmt(emp.totalEarned)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400">เบิก+หัก</p>
            <p className="font-bold text-red-500">฿{fmt(emp.totalWithdrawn + emp.installmentDeduct + emp.carryForwardIn)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400">{emp.netPayDue >= 0 ? 'คงเหลือ' : 'ทบเดือนหน้า'}</p>
            <p className={`font-bold ${emp.netPayDue >= 0 ? 'text-blue-600' : 'text-orange-500'}`}>
              {emp.netPayDue < 0 ? '−' : ''}฿{fmt(Math.abs(emp.netPayDue))}
            </p>
          </div>
        </div>

        {/* Detail (expandable) */}
        {expanded && (
          <div className="px-4 py-3 space-y-1.5 text-sm border-b border-slate-50">
            <div className="flex justify-between text-slate-600">
              <span>ค่าแรง ({emp.daysWorked} วัน × ฿{fmt(emp.daily_rate)})</span>
              <span className="text-emerald-600">+฿{fmt(emp.grossPay)}</span>
            </div>
            {emp.streakBonus > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>โบนัส 10 วันติด</span>
                <span className="text-emerald-600">+฿{fmt(emp.streakBonus)}</span>
              </div>
            )}
            {(emp.bonusDetail || []).map((b, i) => (
              <div key={i} className="flex justify-between text-slate-600">
                <span>{b.note || 'โบนัสพิเศษ'}</span>
                <span className="text-emerald-600">+฿{fmt(b.amount)}</span>
              </div>
            ))}
            {emp.commission > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>ค่าคอมมิชชั่น ({emp.repair_commission_pct}% × ฿{fmt(emp.laborTotal)})</span>
                <span className="text-emerald-600">+฿{fmt(emp.commission)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-slate-700 border-t border-dashed pt-1.5">
              <span>รายได้รวม</span>
              <span className="text-emerald-700">฿{fmt(emp.totalEarned)}</span>
            </div>
            {emp.totalWithdrawn > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>เบิกค่าแรง (รวม {emp.advances.length} ครั้ง)</span>
                <span className="text-red-500">−฿{fmt(emp.totalWithdrawn)}</span>
              </div>
            )}
            {emp.installmentDetail.filter(i => i.thisMonth > 0).map(inst => (
              <div key={inst.id} className="flex justify-between text-slate-600">
                <span>{inst.name} ({inst.thisMonth} วัน · เหลือ {inst.remaining - inst.thisMonth} วัน)</span>
                <span className="text-red-500">−฿{fmt(inst.deductAmount)}</span>
              </div>
            ))}
            {emp.carryForwardIn > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>ทบจากเดือนก่อน</span>
                <span className="text-orange-500">−฿{fmt(emp.carryForwardIn)}</span>
              </div>
            )}
            <div className={`flex justify-between font-bold border-t-2 border-slate-200 pt-1.5 ${emp.netPayDue >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>
              <span>{emp.netPayDue >= 0 ? 'คงเหลือต้องจ่าย' : 'ขาด → ทบเดือนหน้า'}</span>
              <span>{emp.netPayDue < 0 ? '−' : ''}฿{fmt(Math.abs(emp.netPayDue))}</span>
            </div>

            {/* Withdrawal history */}
            {emp.advances.length > 0 && (
              <div className="mt-2 pt-2 border-t border-dashed">
                <p className="text-[10px] text-slate-400 mb-1.5">ประวัติเบิก</p>
                {emp.advances.map((a, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-500 py-0.5">
                    <span>{fmtDate(a.requested_at)}</span>
                    <span className="text-red-500">−฿{fmt(a.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex gap-2">
            <button onClick={() => setShowInst(true)}
              className="flex-1 py-2 border border-violet-200 text-violet-600 rounded-xl text-sm font-medium hover:bg-violet-50 transition-colors">
              💳 ผ่อน
            </button>
            <button onClick={() => setShowBonus(true)}
              className="flex-1 py-2 border border-amber-200 text-amber-600 rounded-xl text-sm font-medium hover:bg-amber-50 transition-colors">
              🎁 โบนัส
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={printSlip}
              className="flex-1 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              🖨️ สลิป
            </button>
            {!isSettled ? (
              <button onClick={settle} disabled={settling}
                className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40">
                {settling ? '...' : '✅ ปิดบัญชี'}
              </button>
            ) : (
              <button onClick={unsettle} disabled={unsettling}
                className="flex-1 py-2 border border-red-200 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-40">
                {unsettling ? '...' : '↩ ยกเลิกปิด'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ---- Main Page ----
export default function PayrollPage() {
  const { user } = useAuth() || {}
  const now = new Date()
  const [period, setPeriod] = useState(now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7))
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/payroll?period=${period}`)
      const json = await res.json()
      setData(json)
    } catch {}
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  const [y, m] = period.split('-').map(Number)
  const monthLabel = `${MONTH_TH[m - 1]} ${y}`

  function changeMonth(delta) {
    const d = new Date(y, m - 1 + delta, 1)
    setPeriod(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7))
  }

  const totalNetPay = (data?.employees || []).reduce((s, e) => s + Math.max(0, e.netPayDue), 0)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-brand text-white px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold">💰 สรุปค่าแรงพนักงาน</h1>
          <button onClick={load} className="text-white/70 text-sm">↻</button>
        </div>
        <div className="flex items-center gap-3 justify-center">
          <button onClick={() => changeMonth(-1)} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">‹</button>
          <p className="text-xl font-bold w-28 text-center">{monthLabel}</p>
          <button onClick={() => changeMonth(1)} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">›</button>
        </div>
        {!loading && data && (
          <p className="text-center text-white/70 text-sm mt-2">
            รวมต้องจ่าย ฿{fmt(totalNetPay)} · {data.employees?.length} คน
          </p>
        )}
      </div>

      <div className="px-4 py-4 space-y-3 max-w-lg mx-auto">
        {loading && (
          <div className="py-16 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">กำลังคำนวณ...</p>
          </div>
        )}
        {!loading && data?.employees?.length === 0 && (
          <div className="py-16 text-center text-slate-400">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-sm">ไม่มีพนักงาน active</p>
          </div>
        )}
        {!loading && data?.employees?.map(emp => (
          <EmpCard key={emp.id} emp={emp} period={period} onSettled={load} />
        ))}
      </div>
    </div>
  )
}
