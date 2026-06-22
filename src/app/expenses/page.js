'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, todayISO } from '@/lib/utils'

const CATS = ['ค่าน้ำไฟ', 'ค่าเช่า', 'ค่าวัสดุสิ้นเปลือง', 'ค่าขนส่ง', 'ค่าซ่อมบำรุง', 'ค่าอาหาร', 'อื่นๆ']
const CAT_COLOR = {
  'ค่าน้ำไฟ':'bg-yellow-100 text-yellow-700',
  'ค่าเช่า':'bg-purple-100 text-purple-700',
  'ค่าวัสดุสิ้นเปลือง':'bg-blue-100 text-blue-700',
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
          <p className="text-xl font-bold text-violet-600">฿{fmt(totalPayroll)}</p>
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
          className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${activeTab==='payroll' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200'}`}>
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
                <ExpenseRow key={e.id} exp={e} onDelete={() => {
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
                    <p className="font-bold text-violet-600 text-sm">฿{fmt(p.net_pay)}</p>
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
    </div>
  )
}

function ExpenseRow({ exp, onDelete }) {
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
    try {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1]
        const mediaType = file.type || 'image/jpeg'
        setImageUrl(reader.result) // preview
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
      }
    } catch (e) {
      setScanError('สแกนไม่ได้: ' + e.message)
    } finally {
      setScanning(false)
    }
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
