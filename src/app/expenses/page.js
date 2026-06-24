'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, todayISO } from '@/lib/utils'
import { getNextDocNo } from '@/lib/docBuilder'

function numberToThaiText(amount) {
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
  const placeNames = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']
  function cvt(n) {
    if (n === 0) return ''
    if (n >= 1000000) return cvt(Math.floor(n / 1000000)) + 'ล้าน' + cvt(n % 1000000)
    const s = String(n).padStart(6, '0')
    let r = ''
    const hasHigher = n >= 10
    for (let i = 0; i < 6; i++) {
      const d = parseInt(s[i]), p = 5 - i
      if (d === 0) continue
      if (p === 1) { r += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : digits[d] + 'สิบ' }
      else if (p === 0) { r += d === 1 && hasHigher ? 'เอ็ด' : digits[d] }
      else { r += digits[d] + placeNames[p] }
    }
    return r
  }
  const baht = Math.floor(amount)
  const satang = Math.round((amount - baht) * 100)
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน'
  let res = (baht > 0 ? cvt(baht) : 'ศูนย์') + 'บาท'
  return satang === 0 ? res + 'ถ้วน' : res + cvt(satang) + 'สตางค์'
}

function buildPaymentVoucherHTML({ shop, exp, payee, docRef, payMethod, bankName, branch, checkNo, checkDate, whtRate, voucherNo }) {
  const total = Number(exp.amount)
  const wht = Math.round(total * (whtRate / 100) * 100) / 100
  const net = total - wht
  const fmt2 = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const docNo = voucherNo || ('PV' + new Date().getFullYear().toString().slice(-2) + String(new Date().getMonth() + 1).padStart(2, '0') + String(Math.floor(Math.random() * 9000) + 1000))
  const today = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const pmBoxStyle = (active) => `display:inline-block;width:10px;height:10px;border:1.5px solid #333;margin-right:4px;background:${active ? '#333' : 'white'};vertical-align:middle`

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ใบสำคัญจ่าย ${docNo}</title>
<style>
  body { font-family: 'Kanit', Arial, sans-serif; font-size: 14pt; margin: 0; padding: 20mm 20mm 15mm; color: #111; }
  h1 { font-size: 18pt; font-weight: bold; text-align: center; margin: 0 0 2px; }
  .subtitle { font-size: 13pt; color: #1a56c4; text-align: center; margin: 0 0 16px; }
  .header-grid { display: flex; justify-content: space-between; margin-bottom: 12px; }
  .header-right { text-align: right; }
  .label { color: #555; font-size: 12pt; }
  .val { font-weight: bold; font-size: 13pt; border-bottom: 1px solid #aaa; padding: 0 4px; min-width: 120px; display: inline-block; }
  .payee-row { margin-bottom: 10px; }
  .payee-row span { font-size: 12pt; color: #555; }
  .pm-row { margin-bottom: 12px; font-size: 12pt; display: flex; gap: 24px; flex-wrap: wrap; align-items: center; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: #f0f0f0; border: 1px solid #bbb; padding: 6px 8px; font-size: 12pt; text-align: center; }
  td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12pt; vertical-align: top; }
  .right { text-align: right; }
  .center { text-align: center; }
  .sum-table { margin-left: auto; width: 300px; border-collapse: collapse; margin-top: 0; }
  .sum-table td { border: none; padding: 3px 8px; font-size: 12pt; }
  .net-row td { font-weight: bold; font-size: 14pt; color: #c00; border-top: 1px solid #aaa; }
  .amount-text { border: 1px solid #bbb; padding: 6px 12px; margin: 8px 0 16px; font-size: 13pt; font-weight: bold; }
  .sig-row { display: flex; gap: 20px; justify-content: space-around; margin-top: 20px; }
  .sig-box { text-align: center; flex: 1; }
  .sig-line { border-bottom: 1px solid #555; margin-bottom: 4px; height: 32px; }
  .sig-label { font-size: 11pt; color: #555; }
  .remark { font-size: 11pt; color: #555; margin-bottom: 6px; }
  @media print { body { padding: 12mm 15mm 10mm; } }
</style></head><body>
  <h1>${shop.shop_name || 'ร้านค้า'}</h1>
  ${shop.shop_address ? `<p style="text-align:center;font-size:12pt;margin:2px 0">${shop.shop_address}</p>` : ''}
  ${shop.shop_tax_id ? `<p style="text-align:center;font-size:11pt;color:#555;margin:2px 0">เลขที่ผู้เสียภาษี: ${shop.shop_tax_id}</p>` : ''}
  <p style="text-align:center;font-size:14pt;color:#1a56c4;font-weight:bold;margin:8px 0 4px">ใบสำคัญจ่าย</p>
  <p style="text-align:center;font-size:12pt;color:#1a56c4;margin:0 0 16px">PAYMENT VOUCHER</p>

  <div class="header-grid">
    <div></div>
    <div class="header-right">
      <div><span class="label">เลขที่&nbsp;</span><span class="val">${docNo}</span></div>
      <div style="margin-top:6px"><span class="label">วันที่&nbsp;</span><span class="val">${today}</span></div>
    </div>
  </div>

  <div class="payee-row">
    <span class="label">จ่ายให้แก่&nbsp;</span>
    <span class="val" style="min-width:280px">${payee || ''}</span>
  </div>

  <div class="pm-row">
    <span><span style="${pmBoxStyle(payMethod==='เงินสด')}"></span>เงินสด</span>
    <span><span style="${pmBoxStyle(payMethod==='โอน')}"></span>โอน</span>
    <span><span style="${pmBoxStyle(payMethod==='เช็ค')}"></span>เช็คธนาคาร
      ${bankName ? `<strong>${bankName}</strong>` : '_____________'}
      สาขา ${branch || '_____________'}
      เลขที่เช็ค ${checkNo || '_____________'}</span>
  </div>
  ${checkDate ? `<p style="font-size:12pt;margin:0 0 10px">เช็คลงวันที่ <strong>${checkDate}</strong>&nbsp;&nbsp;&nbsp; จำนวนเงิน <strong>${fmt2(net)}</strong></p>` : ''}

  <table>
    <thead>
      <tr>
        <th style="width:100px">วันที่เอกสาร</th>
        <th style="width:110px">เลขที่เอกสาร</th>
        <th>รายการ / Description</th>
        <th style="width:110px">จำนวนเงิน</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="center">${exp.expense_date || ''}</td>
        <td class="center">${docRef || ''}</td>
        <td>${exp.description || ''}</td>
        <td class="right">${fmt2(total)}</td>
      </tr>
      <tr><td></td><td></td><td></td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td></tr>
    </tbody>
  </table>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
    <div class="remark">หมายเหตุ: ${exp.note || ''}</div>
    <table class="sum-table">
      <tr><td>จำนวนเงินรวม</td><td class="right">${fmt2(total)}</td></tr>
      ${whtRate > 0 ? `<tr><td>หัก ณ ที่จ่าย ${whtRate}%</td><td class="right">${fmt2(wht)}</td></tr>` : ''}
      <tr class="net-row"><td>คงเหลือสุทธิ</td><td class="right">${fmt2(net)}</td></tr>
    </table>
  </div>

  <div>
    <span class="label">จำนวนเงิน&nbsp;</span>
    <span class="amount-text">${numberToThaiText(net)}</span>
  </div>

  <div class="sig-row">
    <div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้จ่าย</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้ตรวจสอบ</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้อนุมัติ</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้รับเงิน</div></div>
  </div>

<script>window.onload = () => { window.print() }</script>
</body></html>`
}

function PaymentVoucherModal({ exp, onClose }) {
  const [shop, setShop] = useState({})
  const [voucherNo, setVoucherNo] = useState('')
  const [payee, setPayee] = useState('')
  const [docRef, setDocRef] = useState('')
  const [payMethod, setPayMethod] = useState('เงินสด')
  const [bankName, setBankName] = useState('')
  const [branch, setBranch] = useState('')
  const [checkNo, setCheckNo] = useState('')
  const [checkDate, setCheckDate] = useState('')
  const [whtRate, setWhtRate] = useState(0)

  useEffect(() => {
    supabase.from('settings').select('key,value')
      .then(({ data }) => {
        const s = {}
        ;(data || []).forEach(r => { s[r.key] = r.value })
        setShop(s)
      })
    getNextDocNo('paymentvoucher').then(no => setVoucherNo(no))
  }, [])

  function print() {
    const html = buildPaymentVoucherHTML({ shop, exp, payee, docRef, payMethod, bankName, branch, checkNo, checkDate, whtRate: Number(whtRate), voucherNo })
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in">
        <div className="bg-slate-800 text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-bold text-base">🧾 ใบสำคัญจ่าย</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className="bg-slate-50 rounded-2xl p-3 text-sm">
            <p className="font-bold text-slate-700">{exp.description}</p>
            <p className="text-slate-500">{exp.expense_date} · ฿{Number(exp.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">จ่ายให้แก่ (ชื่อผู้รับเงิน)</label>
            <input value={payee} onChange={e => setPayee(e.target.value)} placeholder="ชื่อบริษัท / บุคคล"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">เลขที่เอกสารอ้างอิง</label>
            <input value={docRef} onChange={e => setDocRef(e.target.value)} placeholder="เลขที่บิล/ใบกำกับภาษี"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">วิธีชำระ</label>
            <div className="flex gap-2">
              {['เงินสด', 'โอน', 'เช็ค'].map(m => (
                <button key={m} onClick={() => setPayMethod(m)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${payMethod === m ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {(payMethod === 'โอน' || payMethod === 'เช็ค') && (
            <div className="space-y-2">
              <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="ธนาคาร (เช่น กสิกรไทย)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
              {payMethod === 'เช็ค' && (
                <>
                  <input value={branch} onChange={e => setBranch(e.target.value)} placeholder="สาขา"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
                  <div className="flex gap-2">
                    <input value={checkNo} onChange={e => setCheckNo(e.target.value)} placeholder="เลขที่เช็ค"
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
                    <input type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)}
                      className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
                  </div>
                </>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">หัก ณ ที่จ่าย (WHT)</label>
            <div className="flex gap-2 flex-wrap">
              {[0, 1, 1.5, 3, 5].map(r => (
                <button key={r} onClick={() => setWhtRate(r)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${whtRate === r ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                  {r === 0 ? 'ไม่หัก' : `${r}%`}
                </button>
              ))}
            </div>
          </div>

          {whtRate > 0 && (
            <div className="bg-amber-50 rounded-xl p-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">ยอดรวม</span><span>฿{Number(exp.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">หัก {whtRate}%</span><span className="text-red-500">-฿{(Number(exp.amount) * whtRate / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between font-bold border-t border-amber-200 mt-1 pt-1"><span>สุทธิ</span><span className="text-brand">฿{(Number(exp.amount) * (1 - whtRate / 100)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span></div>
            </div>
          )}

          <button onClick={print}
            className="w-full bg-slate-800 text-white font-bold py-3.5 rounded-2xl text-base active:scale-[0.98] transition-transform shadow-lg">
            🖨️ พิมพ์ใบสำคัญจ่าย
          </button>
        </div>
      </div>
    </div>
  )
}

const CATS = ['ค่าน้ำไฟ', 'ค่าเช่า', 'ค่าวัสดุสิ้นเปลือง', 'ค่าขนส่ง', 'ค่าซ่อมบำรุง', 'ค่าอาหาร', 'อื่นๆ']
const CAT_COLOR = {
  'ค่าน้ำไฟ':'bg-yellow-100 text-yellow-700',
  'ค่าเช่า':'bg-pink-100 text-pink-700',
  'ค่าวัสดุสิ้นเปลือง':'bg-orange-100 text-orange-700',
  'ค่าขนส่ง':'bg-green-100 text-green-700',
  'ค่าซ่อมบำรุง':'bg-orange-100 text-orange-700',
  'ค่าอาหาร':'bg-pink-100 text-pink-700',
  'อื่นๆ':'bg-slate-100 text-slate-600',
}

function catColor(c) { return CAT_COLOR[c] || 'bg-slate-100 text-slate-600' }

export default function ExpensesPage() {
  const [expenses, setExpenses]   = useState([])
  const [payslips, setPayslips]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [voucherExp, setVoucherExp] = useState(null)
  const [dateFrom, setDateFrom]   = useState(todayISO().slice(0,7) + '-01')
  const [dateTo, setDateTo]       = useState(todayISO())
  const [activeTab, setActiveTab] = useState('expenses') // 'expenses' | 'payroll'

  useEffect(() => { loadData() }, [dateFrom, dateTo])

  async function loadData() {
    setLoading(true)
    const [{ data: exp }, { data: pay }] = await Promise.all([
      supabase.from('expenses')
        .select('*').gte('expense_date', dateFrom).lte('expense_date', dateTo)
        .order('expense_date', { ascending: false }),
      supabase.from('payslips')
        .select('*, employees(name,position)')
        .order('period_year', { ascending: false }).order('period_month', { ascending: false })
        .limit(50),
    ])
    setExpenses(exp || [])
    setPayslips(pay || [])
    setLoading(false)
  }

  const totalExp     = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const totalPayroll = payslips.reduce((s, p) => s + Number(p.net_pay || 0), 0)
  const totalBonus   = payslips.reduce((s, p) => s + Number(p.bonus || 0), 0)

  // Group by category
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount)
    return acc
  }, {})

  return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading font-bold text-xl text-brand">💸 ค่าใช้จ่าย</h1>
        <button onClick={() => setShowModal(true)}
          className="bg-brand text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-transform">
          + เพิ่ม
        </button>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap gap-2 mb-4 bg-white rounded-2xl p-3 border border-gray-100 shadow-sm">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand" />
        <span className="text-gray-300 self-center">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand" />
        <button onClick={() => {
          const d = new Date(); d.setDate(1)
          setDateFrom(d.toISOString().slice(0,10))
          setDateTo(todayISO())
        }} className="text-xs text-brand font-semibold px-3 py-2 bg-brand/8 rounded-xl">เดือนนี้</button>
        <button onClick={() => { setDateFrom(todayISO()); setDateTo(todayISO()) }}
          className="text-xs text-brand font-semibold px-3 py-2 bg-brand/8 rounded-xl">วันนี้</button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <p className="text-[11px] text-slate-400 font-semibold uppercase mb-1">ค่าใช้จ่าย</p>
          <p className="text-xl font-bold text-red-500">฿{fmt(totalExp)}</p>
          <p className="text-xs text-slate-400 mt-1">{expenses.length} รายการ</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <p className="text-[11px] text-slate-400 font-semibold uppercase mb-1">เงินเดือน</p>
          <p className="text-xl font-bold text-brand">฿{fmt(totalPayroll)}</p>
          <p className="text-xs text-slate-400 mt-1">ทุกพนักงาน</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <p className="text-[11px] text-slate-400 font-semibold uppercase mb-1">รวมทั้งหมด</p>
          <p className="text-xl font-bold text-slate-700">฿{fmt(totalExp + totalPayroll)}</p>
          <p className="text-xs text-slate-400 mt-1">ค่าใช้จ่าย + เงินเดือน</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-3">
        <button onClick={() => setActiveTab('expenses')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${activeTab==='expenses' ? 'bg-brand text-white border-brand' : 'bg-white text-gray-500 border-gray-200'}`}>
          💸 ค่าใช้จ่าย ({expenses.length})
        </button>
        <button onClick={() => setActiveTab('payroll')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${activeTab==='payroll' ? 'bg-brand text-white border-brand' : 'bg-white text-gray-500 border-gray-200'}`}>
          👷 เงินเดือน ({payslips.length})
        </button>
        {activeTab === 'expenses' && Object.keys(byCategory).length > 0 && (
          <div className="flex-1 flex flex-wrap gap-1 items-center justify-end">
            {Object.entries(byCategory).sort((a,b) => b[1]-a[1]).slice(0,3).map(([c,v]) => (
              <span key={c} className={`text-[10px] px-2 py-1 rounded-full font-semibold ${catColor(c)}`}>
                {c} ฿{fmt(v)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {loading && <div className="text-center py-12 text-slate-400 text-sm">กำลังโหลด...</div>}

      {!loading && activeTab === 'expenses' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {expenses.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">
              <p className="text-4xl mb-3">💸</p>
              <p>ยังไม่มีค่าใช้จ่าย</p>
              <button onClick={() => setShowModal(true)}
                className="mt-3 text-brand text-xs underline">+ เพิ่มรายการแรก</button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {expenses.map(e => (
                <ExpenseRow key={e.id} exp={e}
                  onVoucher={() => setVoucherExp(e)}
                  onDelete={() => {
                    if (confirm('ลบรายการนี้?'))
                      supabase.from('expenses').delete().eq('id', e.id).then(() => loadData())
                  }} />
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && activeTab === 'payroll' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {payslips.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">
              <p className="text-4xl mb-3">👷</p>
              <p>ยังไม่มีข้อมูลเงินเดือน</p>
              <a href="/employees" className="mt-2 block text-brand text-xs underline">ไปจัดการพนักงาน →</a>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {payslips.map(p => (
                <div key={p.id} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{p.employees?.name || '—'}</p>
                    <p className="text-xs text-slate-400">{p.employees?.position} · {p.period_month}/{p.period_year}</p>
                    {p.bonus > 0 && <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-semibold">โบนัส ฿{fmt(p.bonus)}</span>}
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-brand text-sm">฿{fmt(p.net_pay)}</p>
                    <p className="text-[10px] text-slate-400">สุทธิ</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Expense Modal */}
      {showModal && (
        <AddExpenseModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadData() }}
        />
      )}

      {/* Payment Voucher Modal */}
      {voucherExp && (
        <PaymentVoucherModal exp={voucherExp} onClose={() => setVoucherExp(null)} />
      )}
    </div>
  )
}

function ExpenseRow({ exp, onDelete, onVoucher }) {
  return (
    <div className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50/60 transition-colors group">
      {exp.image_url && (
        <img src={exp.image_url} alt="" className="w-10 h-10 rounded-xl object-cover border border-gray-100 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${catColor(exp.category)}`}>{exp.category}</span>
          <p className="text-sm font-medium text-slate-700 truncate">{exp.description}</p>
        </div>
        <p className="text-xs text-slate-400">{exp.expense_date}</p>
        {exp.note && <p className="text-[10px] text-slate-400 italic">{exp.note}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <p className="font-bold text-red-500 text-sm">฿{fmt(exp.amount)}</p>
        <button onClick={onVoucher}
          className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
          🧾
        </button>
        <button onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-400 transition-all text-sm">×</button>
      </div>
    </div>
  )
}

function AddExpenseModal({ onClose, onSaved }) {
  const [category, setCategory] = useState(CATS[0])
  const [description, setDesc]  = useState('')
  const [amount, setAmount]     = useState('')
  const [date, setDate]         = useState(todayISO())
  const [note, setNote]         = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const fileRef = useRef(null)

  async function scanBill(file) {
    setScanError('')
    setScanning(true)
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(',')[1]
        const mediaType = file.type || 'image/jpeg'
        setImageUrl(reader.result)
        const res = await fetch('/api/analyze-expense', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mediaType }),
        })
        const json = await res.json()
        if (json.error) { setScanError(json.error); return }
        if (json.description) setDesc(json.description)
        if (json.amount)      setAmount(String(json.amount))
        if (json.category)    setCategory(CATS.includes(json.category) ? json.category : 'อื่นๆ')
        if (json.expense_date) setDate(json.expense_date)
        setScanError('')
      } catch (e) {
        setScanError('สแกนไม่ได้: ' + e.message)
      } finally {
        setScanning(false)
      }
    }
    reader.onerror = () => { setScanError('อ่านไฟล์ไม่ได้'); setScanning(false) }
  }

  async function save() {
    if (!description.trim() || !amount) return alert('กรุณากรอกรายละเอียดและจำนวนเงิน')
    const { error } = await supabase.from('expenses').insert({
      category, description: description.trim(),
      amount: parseFloat(amount), expense_date: date,
      note: note.trim() || null,
      image_url: imageUrl.startsWith('data:') ? null : imageUrl || null,
    })
    if (error) return alert('เกิดข้อผิดพลาด: ' + error.message)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in">
        <div className="bg-brand text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-bold text-base">💸 เพิ่มค่าใช้จ่าย</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">

          {/* Scan bill */}
          <div>
            <button onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-brand/30 rounded-2xl py-3 flex items-center justify-center gap-2 text-brand/70 hover:border-brand/60 hover:bg-brand/5 transition-colors text-sm font-medium">
              {scanning ? '⏳ กำลังสแกน...' : imageUrl ? '🔄 สแกนใหม่' : '📷 สแกนบิล (AI อ่านอัตโนมัติ)'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment"
              className="hidden" onChange={e => e.target.files[0] && scanBill(e.target.files[0])} />
            {scanError && <p className="text-xs text-red-500 mt-1">{scanError}</p>}
            {imageUrl && !imageUrl.startsWith('http') && (
              <img src={imageUrl} alt="bill" className="mt-2 w-full max-h-32 object-contain rounded-xl border border-gray-100" />
            )}
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">หมวดหมู่</label>
            <div className="flex flex-wrap gap-1.5">
              {CATS.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all
                    ${category === c ? 'bg-brand text-white border-brand' : 'bg-white text-slate-500 border-slate-200'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">รายละเอียด *</label>
            <input value={description} onChange={e => setDesc(e.target.value)}
              placeholder="เช่น ค่าไฟฟ้าเดือนมิถุนายน"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
          </div>

          {/* Amount + Date */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">จำนวนเงิน (บาท) *</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right font-bold focus:border-brand outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">วันที่</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
          </div>

          {/* Note */}
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="หมายเหตุ (ถ้ามี)"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />

          <button onClick={save}
            className="w-full bg-brand text-white font-bold py-3.5 rounded-2xl text-base active:scale-[0.98] transition-transform shadow-lg shadow-brand/25">
            ✓ บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}
