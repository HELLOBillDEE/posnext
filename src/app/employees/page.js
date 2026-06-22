'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDate, MONTHS_TH } from '@/lib/utils'

const now = new Date()
const EMPTY_EMP = { code:'', name:'', position:'', salary:'', ot_rate:'', social_security:'750', bank_account:'', bank_name:'', start_date:'', pin:'', can_login:true, active:true }
const EMPTY_SLIP = { ot_hours:'0', ot_rate:'', bonus:'0', allowance:'0', absent_days:'0', other_deduct:'0', note:'' }

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([])
  const [payslips, setPayslips]   = useState([])
  const [settings, setSettings]   = useState({})
  const [tab, setTab]             = useState('list')
  const [modal, setModal]         = useState(null)
  const [form, setForm]           = useState(EMPTY_EMP)
  const [slipForm, setSlipForm]   = useState(EMPTY_SLIP)
  const [slipEmp, setSlipEmp]     = useState(null)
  const [slipPeriod, setSlipPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [saving, setSaving]       = useState(false)
  const [histEmp, setHistEmp]     = useState(null)
  const [empHistory, setEmpHistory] = useState([])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: e }, { data: p }, { data: s }] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase.from('payslips').select('*, employees(name)').order('created_at', { ascending: false }).limit(30),
      supabase.from('settings').select('*'),
    ])
    setEmployees(e || [])
    setPayslips(p || [])
    if (s) setSettings(Object.fromEntries(s.map(r => [r.key, r.value])))
  }

  function openAdd() { setForm(EMPTY_EMP); setModal('add') }
  function openEdit(e) { setForm({ ...e, salary: String(e.salary||''), ot_rate: String(e.ot_rate||''), social_security: String(e.social_security||750) }); setModal({ type:'edit', id: e.id }) }

  async function saveEmployee() {
    if (!form.name) return alert('กรุณากรอกชื่อพนักงาน')
    setSaving(true)
    const payload = {
      code: form.code || null, name: form.name, position: form.position,
      salary: parseFloat(form.salary) || 0,
      ot_rate: parseFloat(form.ot_rate) || parseFloat(settings.ot_rate) || 75,
      social_security: parseFloat(form.social_security) || 750,
      bank_account: form.bank_account, bank_name: form.bank_name,
      pin: form.pin || null, can_login: form.can_login !== false,
      start_date: form.start_date || null, active: form.active,
    }
    try {
      if (modal === 'add') {
        await supabase.from('employees').insert(payload)
      } else {
        await supabase.from('employees').update(payload).eq('id', modal.id)
      }
      setModal(null); loadAll()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  function openSlip(emp) {
    setSlipEmp(emp)
    setSlipForm({ ...EMPTY_SLIP, ot_rate: String(emp.ot_rate || settings.ot_rate || 75) })
    setTab('slip')
  }

  async function openHistory(emp) {
    setHistEmp(emp)
    const { data } = await supabase.from('payslips').select('*').eq('employee_id', emp.id).order('period_year', { ascending: false }).order('period_month', { ascending: false })
    setEmpHistory(data || [])
    setTab('history')
  }

  function calcSlip() {
    const baseSalary    = parseFloat(slipEmp?.salary || 0)
    const otHours       = parseFloat(slipForm.ot_hours || 0)
    const otRate        = parseFloat(slipForm.ot_rate || 0)
    const otAmount      = otHours * otRate
    const bonus         = parseFloat(slipForm.bonus || 0)
    const allowance     = parseFloat(slipForm.allowance || 0)
    const absentDays    = parseFloat(slipForm.absent_days || 0)
    const dailyRate     = baseSalary / 30
    const absentDeduct  = absentDays * dailyRate
    const socialSec     = parseFloat(slipEmp?.social_security || 750)
    const otherDeduct   = parseFloat(slipForm.other_deduct || 0)
    const income        = baseSalary + otAmount + bonus + allowance
    const deductions    = absentDeduct + socialSec + otherDeduct
    const netPay        = income - deductions
    return { baseSalary, otHours, otRate, otAmount, bonus, allowance, absentDays, absentDeduct, socialSec, otherDeduct, income, deductions, netPay }
  }

  async function saveSlip() {
    if (!slipEmp) return
    const c = calcSlip()
    setSaving(true)
    try {
      const { data: existing } = await supabase.from('payslips')
        .select('id').eq('employee_id', slipEmp.id).eq('period_year', slipPeriod.year).eq('period_month', slipPeriod.month).single()
      if (existing && !confirm('มีสลิปเดือนนี้แล้ว ต้องการเขียนทับ?')) { setSaving(false); return }
      if (existing) {
        await supabase.from('payslips').update({
          salary: c.baseSalary, ot_hours: c.otHours, ot_rate: c.otRate, ot_amount: c.otAmount,
          bonus: c.bonus, allowance: c.allowance, absent_days: c.absentDays, absent_deduct: c.absentDeduct,
          social_security: c.socialSec, other_deduct: c.otherDeduct, net_pay: c.netPay, note: slipForm.note,
        }).eq('id', existing.id)
      } else {
        await supabase.from('payslips').insert({
          employee_id: slipEmp.id, period_year: slipPeriod.year, period_month: slipPeriod.month,
          salary: c.baseSalary, ot_hours: c.otHours, ot_rate: c.otRate, ot_amount: c.otAmount,
          bonus: c.bonus, allowance: c.allowance, absent_days: c.absentDays, absent_deduct: c.absentDeduct,
          social_security: c.socialSec, other_deduct: c.otherDeduct, net_pay: c.netPay, note: slipForm.note,
        })
      }
      loadAll()
      printSlip(slipEmp, slipPeriod, c, settings)
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  const slip = slipEmp ? calcSlip() : null

  // ===== List tab =====
  if (tab === 'list') return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-heading font-bold text-xl text-brand">👥 พนักงาน</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab('history_all')} className="border border-gray-300 text-gray-600 px-3 py-2 rounded-xl text-sm">📄 ประวัติสลิป</button>
          <button onClick={openAdd} className="bg-brand text-white px-4 py-2 rounded-xl text-sm font-medium shadow active:scale-95 transition-transform">+ เพิ่มพนักงาน</button>
        </div>
      </div>

      <div className="grid gap-3">
        {employees.map(e => (
          <div key={e.id} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center text-2xl font-bold text-brand shrink-0">
              {e.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-semibold text-gray-800">{e.name}</p>
                {!e.active && <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">ไม่ใช้งาน</span>}
              </div>
              <p className="text-xs text-gray-400">{e.position || 'ไม่ระบุตำแหน่ง'} · เงินเดือน ฿{fmt(e.salary)}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => openSlip(e)} className="bg-emerald-600 text-white px-3 py-2 rounded-xl text-xs font-medium active:scale-95">💰 สลิป</button>
              <button onClick={() => openHistory(e)} className="border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-xs active:bg-gray-50">ประวัติ</button>
              <button onClick={() => openEdit(e)} className="border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-xs active:bg-gray-50">แก้ไข</button>
            </div>
          </div>
        ))}
        {employees.length === 0 && <div className="text-center py-12 text-gray-400">ยังไม่มีพนักงาน</div>}
      </div>

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="bg-brand text-white px-4 py-3 flex justify-between items-center">
              <h2 className="font-heading font-bold">{modal === 'add' ? 'เพิ่มพนักงาน' : 'แก้ไขพนักงาน'}</h2>
              <button onClick={() => setModal(null)} className="text-2xl opacity-80">×</button>
            </div>
            <div className="p-4 space-y-3">
              <EmpField label="รหัสพนักงาน" k="code" form={form} setForm={setForm} placeholder="EMP001" />
              <EmpField label="ชื่อ-นามสกุล *" k="name" form={form} setForm={setForm} />
              <EmpField label="ตำแหน่ง" k="position" form={form} setForm={setForm} placeholder="พนักงานขาย" />
              <div className="grid grid-cols-2 gap-3">
                <EmpField label="เงินเดือน (บาท)" k="salary" form={form} setForm={setForm} type="number" placeholder="15000" />
                <EmpField label="ค่า OT/ชม. (บาท)" k="ot_rate" form={form} setForm={setForm} type="number" placeholder="75" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <EmpField label="ประกันสังคม/เดือน" k="social_security" form={form} setForm={setForm} type="number" placeholder="750" />
                <EmpField label="วันเริ่มงาน" k="start_date" form={form} setForm={setForm} type="date" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <EmpField label="ธนาคาร" k="bank_name" form={form} setForm={setForm} placeholder="กสิกร" />
                <EmpField label="เลขบัญชี" k="bank_account" form={form} setForm={setForm} placeholder="xxx-x-xxxxx-x" />
                <div>
                  <label className="text-xs text-gray-500 block mb-1">PIN เข้าระบบ (4 หลัก)</label>
                  <input value={form.pin||''} onChange={e => setForm(p=>({...p,pin:e.target.value.replace(/\D/g,'').slice(0,4)}))}
                    type="text" inputMode="numeric" maxLength={4} placeholder="ไม่กรอก = ไม่ต้องใส่ PIN"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none font-mono tracking-widest" />
                  <p className="text-[10px] text-gray-400 mt-0.5">พนักงานใช้ PIN นี้ล็อกอินในแท็บ "พนักงาน"</p>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="can_login" checked={form.can_login !== false}
                    onChange={e => setForm(p=>({...p,can_login:e.target.checked}))}
                    className="w-4 h-4 rounded accent-brand" />
                  <label htmlFor="can_login" className="text-xs text-gray-600">อนุญาตให้ Login ได้</label>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(p=>({...p,active:e.target.checked}))} className="w-4 h-4 accent-brand" />
                พนักงานยังทำงานอยู่
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setModal(null)} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl text-sm">ยกเลิก</button>
                <button onClick={saveEmployee} disabled={saving} className="flex-1 bg-brand text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 shadow">
                  {saving ? 'บันทึก...' : '💾 บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ===== Slip tab =====
  if (tab === 'slip' && slipEmp && slip) return (
    <div className="max-w-2xl mx-auto px-3 py-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setTab('list')} className="text-gray-400 text-xl">←</button>
        <h1 className="font-heading font-bold text-xl text-brand">💰 ออกสลิปเงินเดือน</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm mb-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center text-2xl font-bold text-brand">
            {slipEmp.name.charAt(0)}
          </div>
          <div>
            <p className="font-bold text-gray-800">{slipEmp.name}</p>
            <p className="text-xs text-gray-400">{slipEmp.position}</p>
          </div>
        </div>

        {/* Period */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">ปี</label>
            <select value={slipPeriod.year} onChange={e => setSlipPeriod(p=>({...p,year:parseInt(e.target.value)}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              {[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => <option key={y} value={y}>{y + 543}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">เดือน</label>
            <select value={slipPeriod.month} onChange={e => setSlipPeriod(p=>({...p,month:parseInt(e.target.value)}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              {MONTHS_TH.slice(1).map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Income */}
        <div className="mb-3">
          <p className="text-xs font-semibold text-green-700 mb-2 uppercase tracking-wide">รายได้</p>
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <SlipRow label="เงินเดือน" val={`฿${fmt(slipEmp.salary)}`} />
            <div className="grid grid-cols-2 gap-2">
              <SlipInput label="OT (ชั่วโมง)" val={slipForm.ot_hours} onChange={v => setSlipForm(p=>({...p,ot_hours:v}))} />
              <SlipInput label="อัตรา OT/ชม." val={slipForm.ot_rate} onChange={v => setSlipForm(p=>({...p,ot_rate:v}))} />
            </div>
            {parseFloat(slipForm.ot_hours || 0) > 0 && <SlipRow label="รวม OT" val={`฿${fmt(slip.otAmount)}`} />}
            <SlipInput label="โบนัส (บาท)" val={slipForm.bonus} onChange={v => setSlipForm(p=>({...p,bonus:v}))} />
            <SlipInput label="เบี้ยเลี้ยง / ค่าน้ำมัน (บาท)" val={slipForm.allowance} onChange={v => setSlipForm(p=>({...p,allowance:v}))} />
            <SlipRow label="รวมรายได้" val={`฿${fmt(slip.income)}`} bold />
          </div>
        </div>

        {/* Deductions */}
        <div className="mb-3">
          <p className="text-xs font-semibold text-red-600 mb-2 uppercase tracking-wide">รายหัก</p>
          <div className="bg-red-50 rounded-xl p-3 space-y-2">
            <SlipInput label="ขาด/ลา (วัน)" val={slipForm.absent_days} onChange={v => setSlipForm(p=>({...p,absent_days:v}))} />
            {parseFloat(slipForm.absent_days || 0) > 0 && <SlipRow label="หักขาด/ลา" val={`฿${fmt(slip.absentDeduct)}`} cls="text-red-500" />}
            <SlipRow label="ประกันสังคม" val={`฿${fmt(slip.socialSec)}`} cls="text-red-500" />
            <SlipInput label="หักอื่นๆ (บาท)" val={slipForm.other_deduct} onChange={v => setSlipForm(p=>({...p,other_deduct:v}))} />
            <SlipRow label="รวมหัก" val={`฿${fmt(slip.deductions)}`} bold cls="text-red-600" />
          </div>
        </div>

        {/* Net */}
        <div className="bg-brand rounded-2xl p-4 text-white text-center">
          <p className="text-sm opacity-80">เงินเดือนสุทธิ</p>
          <p className="font-heading font-bold text-4xl">฿{fmt(slip.netPay)}</p>
          <p className="text-xs opacity-70 mt-1">{slipEmp.bank_name} {slipEmp.bank_account}</p>
        </div>

        <input value={slipForm.note} onChange={e => setSlipForm(p=>({...p,note:e.target.value}))}
          placeholder="หมายเหตุ"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mt-3 focus:border-brand outline-none" />
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('list')} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl text-sm">ยกเลิก</button>
        <button onClick={saveSlip} disabled={saving} className="flex-1 bg-brand text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 shadow active:scale-95 transition-transform">
          {saving ? 'กำลังบันทึก...' : '🖨️ บันทึก + พิมพ์สลิป'}
        </button>
      </div>
    </div>
  )

  // ===== History tab =====
  if (tab === 'history' && histEmp) return (
    <div className="max-w-3xl mx-auto px-3 py-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setTab('list')} className="text-gray-400 text-xl">←</button>
        <h1 className="font-heading font-bold text-xl text-brand">ประวัติสลิป: {histEmp.name}</h1>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-xs text-gray-500">
            <th className="text-left px-4 py-2 font-medium">งวด</th>
            <th className="text-right px-3 py-2 font-medium">เงินเดือน</th>
            <th className="text-right px-3 py-2 font-medium">OT</th>
            <th className="text-right px-3 py-2 font-medium">หัก</th>
            <th className="text-right px-4 py-2 font-medium">สุทธิ</th>
            <th className="w-12 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {empHistory.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-800">{MONTHS_TH[p.period_month]} {p.period_year + 543}</td>
                <td className="px-3 py-2 text-right text-gray-600">฿{fmt(p.salary)}</td>
                <td className="px-3 py-2 text-right text-gray-600">฿{fmt(p.ot_amount)}</td>
                <td className="px-3 py-2 text-right text-red-500">-฿{fmt(Number(p.absent_deduct)+Number(p.social_security)+Number(p.other_deduct))}</td>
                <td className="px-4 py-2 text-right font-bold text-brand">฿{fmt(p.net_pay)}</td>
                <td className="px-2 py-2">
                  <button onClick={() => {
                    const c = {
                      baseSalary: p.salary, otHours: p.ot_hours, otRate: p.ot_rate, otAmount: p.ot_amount,
                      bonus: p.bonus, allowance: p.allowance, absentDays: p.absent_days, absentDeduct: p.absent_deduct,
                      socialSec: p.social_security, otherDeduct: p.other_deduct,
                      income: Number(p.salary)+Number(p.ot_amount)+Number(p.bonus)+Number(p.allowance),
                      deductions: Number(p.absent_deduct)+Number(p.social_security)+Number(p.other_deduct),
                      netPay: p.net_pay,
                    }
                    printSlip(histEmp, { year: p.period_year, month: p.period_month }, c, settings)
                  }} className="text-xs text-brand underline">พิมพ์</button>
                </td>
              </tr>
            ))}
            {empHistory.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">ยังไม่มีประวัติสลิป</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )

  // Fallback
  return null
}

function EmpField({ label, k, form, setForm, type='text', placeholder='' }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input type={type} value={form[k]||''} onChange={e => setForm(p=>({...p,[k]:e.target.value}))}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
    </div>
  )
}

function SlipRow({ label, val, bold, cls='' }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold' : ''} ${cls}`}>
      <span className="text-gray-600">{label}</span>
      <span>{val}</span>
    </div>
  )
}

function SlipInput({ label, val, onChange }) {
  return (
    <div>
      <label className="text-[10px] text-gray-500 block mb-0.5">{label}</label>
      <input type="number" value={val} onChange={e => onChange(e.target.value)} min="0"
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:border-brand outline-none bg-white" />
    </div>
  )
}

function printSlip(emp, period, c, settings) {
  const win = window.open('', '_blank', 'width=460,height=700')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Sarabun',sans-serif;font-size:13px;max-width:10cm;margin:auto;padding:10mm;border:1px solid #ccc}
    h2{font-size:16px;text-align:center;margin-bottom:4px}
    h3{font-size:13px;color:#1a4731;border-bottom:1px solid #1a4731;padding-bottom:3px;margin:10px 0 6px}
    .center{text-align:center;font-size:11px;color:#555;margin-bottom:8px}
    .row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}
    .row.bold{font-weight:bold;font-size:14px;color:#1a4731}
    .row.deduct{color:#c0392b}
    .net{background:#1a4731;color:white;padding:10px;text-align:center;border-radius:8px;margin-top:10px}
    .net h4{font-size:11px;opacity:.8;margin-bottom:2px}
    .net p{font-size:24px;font-weight:bold}
    .sig{display:flex;justify-content:space-between;margin-top:20px;text-align:center;font-size:11px;color:#888}
    .sig div hr{width:100px;margin:0 auto 4px}
    @media print{body{border:none;padding:5mm;margin:0}}
  </style></head><body>
  <h2>${settings.shop_name || 'ร้านค้า'}</h2>
  <p class="center">สลิปเงินเดือน ${MONTHS_TH[period.month]} ${period.year + 543}</p>
  <p class="center">พนักงาน: <b>${emp.name}</b> · ${emp.position || ''}</p>
  ${emp.bank_name ? `<p class="center">ธนาคาร${emp.bank_name} · ${emp.bank_account}</p>` : ''}
  <h3>รายได้</h3>
  <div class="row"><span>เงินเดือน</span><span>฿${fmt(c.baseSalary)}</span></div>
  ${c.otHours > 0 ? `<div class="row"><span>OT ${c.otHours} ชม. × ฿${fmt(c.otRate)}</span><span>฿${fmt(c.otAmount)}</span></div>` : ''}
  ${c.bonus > 0 ? `<div class="row"><span>โบนัส</span><span>฿${fmt(c.bonus)}</span></div>` : ''}
  ${c.allowance > 0 ? `<div class="row"><span>เบี้ยเลี้ยง</span><span>฿${fmt(c.allowance)}</span></div>` : ''}
  <div class="row bold"><span>รวมรายได้</span><span>฿${fmt(c.income)}</span></div>
  <h3>รายหัก</h3>
  ${c.absentDays > 0 ? `<div class="row deduct"><span>หักขาด/ลา ${c.absentDays} วัน</span><span>-฿${fmt(c.absentDeduct)}</span></div>` : ''}
  <div class="row deduct"><span>ประกันสังคม</span><span>-฿${fmt(c.socialSec)}</span></div>
  ${c.otherDeduct > 0 ? `<div class="row deduct"><span>หักอื่นๆ</span><span>-฿${fmt(c.otherDeduct)}</span></div>` : ''}
  <div class="row bold deduct"><span>รวมหัก</span><span>-฿${fmt(c.deductions)}</span></div>
  <div class="net"><h4>เงินเดือนสุทธิ</h4><p>฿${fmt(c.netPay)}</p></div>
  <div class="sig">
    <div><hr><p>ผู้จ่าย</p></div>
    <div><hr><p>ผู้รับ</p></div>
  </div>
  <script>window.onload=()=>window.print()</script>
  </body></html>`)
  win.document.close()
}
