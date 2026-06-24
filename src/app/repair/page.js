'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { genReceiptNo } from '@/lib/utils'

const STATUS = {
  waiting:     { label: 'รอรับงาน',    emoji: '⏳', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.3)'  },
  in_progress: { label: 'กำลังซ่อม',   emoji: '🔧', color: '#C72C41', bg: 'rgba(199,44,65,0.15)',   border: 'rgba(199,44,65,0.3)'   },
  done:        { label: 'เสร็จ รอรับ', emoji: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.3)'  },
  picked_up:   { label: 'รับแล้ว',     emoji: '📦', color: '#801336', bg: 'rgba(128,19,54,0.15)',   border: 'rgba(128,19,54,0.3)'   },
  cancelled:   { label: 'ยกเลิก',      emoji: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.25)'  },
}
const STATUS_ORDER = ['waiting', 'in_progress', 'done', 'picked_up']

const TABS = [
  { key: 'all',         label: 'ทั้งหมด' },
  { key: 'waiting',     label: '⏳ รอรับงาน' },
  { key: 'in_progress', label: '🔧 กำลังซ่อม' },
  { key: 'done',        label: '✅ เสร็จ รอรับ' },
  { key: 'picked_up',   label: '📦 รับแล้ว' },
]

const EMPTY_FORM = {
  customer_name: '', phone: '', device: '', description: '',
  appointment_date: '', appointment_time: '', price: '', deposit: '', note: '', status: 'waiting',
}

const PAY_LABEL = { cash: 'เงินสด', transfer: 'โอน/QR', credit: 'เชื่อ' }

function fmt(n) {
  if (!n && n !== 0) return '—'
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function RepairPage() {
  const [jobs, setJobs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState('all')
  const [search, setSearch]           = useState('')
  const [modal, setModal]             = useState(null)
  const [form, setForm]               = useState(EMPTY_FORM)
  const [editId, setEditId]           = useState(null)
  const [saving, setSaving]           = useState(false)

  // billing modal state
  const [billJob, setBillJob]         = useState(null)
  const [billItems, setBillItems]     = useState([])
  const [billPayMethod, setBillPayMethod] = useState('cash')
  const [billPaid, setBillPaid]       = useState('')
  const [billing, setBilling]         = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('repair_orders')
      .select('*').order('created_at', { ascending: false })
    setJobs(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // product search for parts
  useEffect(() => {
    if (!productSearch.trim()) { setProductResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('products')
        .select('id,name,price,cost,unit').ilike('name', `%${productSearch}%`).limit(8)
      setProductResults(data || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [productSearch])

  // ── Status update ──
  async function updateStatus(job, newStatus) {
    await supabase.from('repair_orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', job.id)
    await load()
  }

  // ── Open billing modal ──
  function openBill(job) {
    setBillJob(job)
    setBillItems([{
      product_id: null,
      product_name: `ค่าซ่อม: ${job.device}${job.description ? ` (${job.description})` : ''}`,
      qty: 1,
      price: job.price || 0,
      unit: 'งาน',
    }])
    setBillPayMethod('cash')
    setBillPaid('')
    setProductSearch('')
    setProductResults([])
  }

  function closeBill() { setBillJob(null); setBillItems([]) }

  function addPart(p) {
    setBillItems(prev => [...prev, { product_id: p.id, product_name: p.name, qty: 1, price: p.price, cost: p.cost || 0, unit: p.unit || 'ชิ้น' }])
    setProductSearch('')
    setProductResults([])
  }

  function updateBillItem(idx, field, val) {
    setBillItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }

  function removeBillItem(idx) {
    setBillItems(prev => prev.filter((_, i) => i !== idx))
  }

  const billSubtotal = billItems.reduce((s, it) => s + (parseFloat(it.price) || 0) * (parseFloat(it.qty) || 1), 0)
  const deposit      = parseFloat(billJob?.deposit) || 0
  const billTotal    = Math.max(0, billSubtotal - deposit)
  const paidAmt      = parseFloat(billPaid) || billTotal
  const changeAmt    = paidAmt - billTotal

  async function confirmBill() {
    if (billItems.length === 0) return
    setBilling(true)
    try {
      // find customer_id by phone
      let customerId = null
      if (billJob.phone) {
        const { data: cust } = await supabase.from('customers').select('id').eq('phone', billJob.phone).single()
        customerId = cust?.id || null
      }

      const receiptNo = genReceiptNo()
      const { data: sale, error: saleErr } = await supabase.from('sales').insert({
        receipt_no:     receiptNo,
        customer_id:    customerId,
        subtotal:       billSubtotal,
        discount:       deposit,
        vat:            0,
        total:          billTotal,
        payment_method: billPayMethod,
        payment_amount: paidAmt,
        change_amount:  Math.max(0, changeAmt),
        note:           `[ซ่อม:${billJob.repair_no}]${deposit > 0 ? ` มัดจำ ฿${fmt(deposit)}` : ''}`,
        status:         'completed',
      }).select('id').single()

      if (saleErr) throw saleErr

      // insert sale_items
      const items = billItems.map(it => ({
        sale_id:      sale.id,
        product_id:   it.product_id || null,
        product_name: it.product_name,
        unit:         it.unit || 'ชิ้น',
        qty:          parseFloat(it.qty) || 1,
        price:        parseFloat(it.price) || 0,
        cost:         parseFloat(it.cost) || 0,
        discount:     0,
        subtotal:     (parseFloat(it.price) || 0) * (parseFloat(it.qty) || 1),
      }))
      await supabase.from('sale_items').insert(items)

      // mark repair picked_up + link sale_id
      await supabase.from('repair_orders').update({
        status:     'picked_up',
        sale_id:    sale.id,
        updated_at: new Date().toISOString(),
      }).eq('id', billJob.id)

      await load()
      closeBill()
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setBilling(false)
    }
  }

  // ── Add/Edit form ──
  async function saveJob() {
    if (!form.customer_name.trim()) return alert('กรุณากรอกชื่อลูกค้า')
    if (!form.device.trim())        return alert('กรุณากรอกชื่ออุปกรณ์')
    setSaving(true)
    try {
      if (modal === 'add') {
        const { data: seq } = await supabase.from('doc_sequences')
          .select('last_seq').eq('prefix', 'REPW').eq('year_month', 'all').single()
        const next = (seq?.last_seq || 0) + 1
        await supabase.from('doc_sequences')
          .upsert({ prefix: 'REPW', year_month: 'all', last_seq: next }, { onConflict: 'prefix,year_month' })
        const repair_no = `REPW-${String(next).padStart(3, '0')}`
        const { error } = await supabase.from('repair_orders').insert({
          repair_no,
          customer_name: form.customer_name.trim(),
          phone: form.phone.trim() || null,
          device: form.device.trim(),
          description: form.description.trim() || null,
          appointment_date: form.appointment_date || null,
          appointment_time: form.appointment_time.trim() || null,
          price: form.price ? parseFloat(form.price) : null,
          deposit: form.deposit ? parseFloat(form.deposit) : 0,
          note: form.note.trim() || null,
          status: form.status,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.from('repair_orders').update({
          customer_name: form.customer_name.trim(),
          phone: form.phone.trim() || null,
          device: form.device.trim(),
          description: form.description.trim() || null,
          appointment_date: form.appointment_date || null,
          appointment_time: form.appointment_time.trim() || null,
          price: form.price ? parseFloat(form.price) : null,
          deposit: form.deposit ? parseFloat(form.deposit) : 0,
          note: form.note.trim() || null,
          status: form.status,
          updated_at: new Date().toISOString(),
        }).eq('id', editId)
        if (error) throw error
      }
      await load()
      closeModal()
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteJob(id) {
    if (!confirm('ลบรายการนี้?')) return
    await supabase.from('repair_orders').delete().eq('id', id)
    await load()
    closeModal()
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM, appointment_date: new Date().toISOString().slice(0, 10) })
    setEditId(null)
    setModal('add')
  }

  function openEdit(job) {
    setForm({
      customer_name: job.customer_name || '', phone: job.phone || '',
      device: job.device || '', description: job.description || '',
      appointment_date: job.appointment_date || '', appointment_time: job.appointment_time || '',
      price: job.price != null ? String(job.price) : '',
      deposit: job.deposit != null ? String(job.deposit) : '',
      note: job.note || '', status: job.status || 'waiting',
    })
    setEditId(job.id)
    setModal('edit')
  }

  function closeModal() { setModal(null); setForm(EMPTY_FORM); setEditId(null) }

  const filtered = jobs.filter(j => {
    if (tab !== 'all' && j.status !== tab) return false
    if (search) {
      const q = search.toLowerCase()
      return (j.repair_no||'').toLowerCase().includes(q) ||
             (j.customer_name||'').toLowerCase().includes(q) ||
             (j.phone||'').includes(q) ||
             (j.device||'').toLowerCase().includes(q)
    }
    return true
  })
  const counts = {}
  jobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1 })

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg,#14060a 0%,#2D142C 100%)', fontFamily: 'Kanit,sans-serif' }}>
      <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">🔧 คิวซ่อม</h1>
            <p className="text-white/40 text-sm mt-0.5">{jobs.length} รายการทั้งหมด</p>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)', boxShadow: '0 4px 14px rgba(199,44,65,0.4)' }}>
            <span className="text-lg leading-none">+</span> เพิ่มคิว
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-sm">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา ชื่อ, เบอร์, อุปกรณ์, เลขคิว..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/30 outline-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 scroll-hidden">
          {TABS.map(t => {
            const cnt = t.key === 'all' ? jobs.length : (counts[t.key] || 0)
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={active
                  ? { background: 'rgba(199,44,65,0.3)', border: '1px solid rgba(199,44,65,0.5)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                {t.label}
                {cnt > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                  style={{ background: active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', color: active ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  {cnt}
                </span>}
              </button>
            )
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-16 text-white/30">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <div className="text-5xl mb-3">🔧</div>
            <p>{search ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีคิวซ่อม'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(job => {
              const st      = STATUS[job.status] || STATUS.waiting
              const nextSts = STATUS_ORDER[STATUS_ORDER.indexOf(job.status) + 1]
              const nextSt  = nextSts ? STATUS[nextSts] : null
              const billed  = !!job.sale_id
              return (
                <div key={job.id} onClick={() => openEdit(job)}
                  className="rounded-2xl p-4 cursor-pointer transition-all active:scale-[0.99] hover:brightness-110"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>

                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold text-white/40">{job.repair_no}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.color }}>
                          {st.emoji} {st.label}
                        </span>
                        {billed && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>
                            🧾 ออกบิลแล้ว
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-white mt-1">{job.customer_name}</p>
                      {job.phone && <p className="text-white/40 text-xs">{job.phone}</p>}
                    </div>
                    {job.price != null && (
                      <div className="text-right flex-shrink-0">
                        <p className="text-white font-bold">฿{fmt(job.price)}</p>
                        {job.deposit > 0 && <p className="text-white/40 text-xs">มัดจำ ฿{fmt(job.deposit)}</p>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">🔩</span>
                    <p className="text-white/80 text-sm font-semibold">{job.device}</p>
                  </div>
                  {job.description && (
                    <p className="text-white/50 text-xs mb-3 line-clamp-2">{job.description}</p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-white/35">
                      {job.appointment_date && (
                        <span>📅 {fmtDate(job.appointment_date)}{job.appointment_time ? ` ${job.appointment_time}` : ''}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Bill button — only for done + not yet billed */}
                      {job.status === 'done' && !billed && (
                        <button
                          onClick={e => { e.stopPropagation(); openBill(job) }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                          style={{ background: 'linear-gradient(135deg,#059669,#34d399)', color: '#fff', boxShadow: '0 2px 8px rgba(5,150,105,0.4)' }}>
                          💰 คิดเงิน / รับเครื่อง
                        </button>
                      )}
                      {/* Next status button — skip 'done→picked_up' (use billing instead) */}
                      {nextSt && nextSts !== 'picked_up' && (
                        <button
                          onClick={e => { e.stopPropagation(); updateStatus(job, nextSts) }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                          style={{ background: nextSt.bg, border: `1px solid ${nextSt.border}`, color: nextSt.color }}>
                          {nextSt.emoji} {nextSt.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Billing Modal ── */}
      {billJob && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeBill() }}>
          <div className="w-full md:max-w-lg rounded-t-3xl md:rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '94vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0"
              style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <h2 className="font-bold text-white text-lg">💰 คิดเงิน / รับเครื่อง</h2>
                <p className="text-white/40 text-xs mt-0.5">{billJob.repair_no} · {billJob.customer_name} · {billJob.device}</p>
              </div>
              <button onClick={closeBill} className="text-white/40 hover:text-white text-2xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>

            <div className="overflow-y-auto px-5 py-4 space-y-4" style={{ maxHeight: 'calc(94vh - 80px)' }}>

              {/* Items */}
              <div>
                <p className="text-white/50 text-xs mb-2">รายการ</p>
                <div className="space-y-2">
                  {billItems.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2.5 rounded-xl"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <div className="flex-1 min-w-0">
                        <input value={it.product_name}
                          onChange={e => updateBillItem(idx, 'product_name', e.target.value)}
                          className="w-full text-sm text-white bg-transparent outline-none"
                          placeholder="ชื่อรายการ" />
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <input type="number" value={it.qty}
                          onChange={e => updateBillItem(idx, 'qty', e.target.value)}
                          className="w-12 text-center text-sm text-white rounded-lg px-1 py-1 outline-none"
                          style={{ background: 'rgba(255,255,255,0.08)' }} min="1" />
                        <span className="text-white/30 text-xs">×</span>
                        <input type="number" value={it.price}
                          onChange={e => updateBillItem(idx, 'price', e.target.value)}
                          className="w-20 text-right text-sm text-white rounded-lg px-2 py-1 outline-none"
                          style={{ background: 'rgba(255,255,255,0.08)' }} />
                        <button onClick={() => removeBillItem(idx)} className="text-red-400/60 hover:text-red-400 text-lg leading-none w-6">×</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add parts search */}
                <div className="mt-2 relative">
                  <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                    placeholder="🔍 ค้นหาอะไหล่จากสต๊อก..."
                    className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-white/30 outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
                  {productResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 rounded-xl overflow-hidden shadow-xl"
                      style={{ background: '#2D142C', border: '1px solid rgba(255,255,255,0.12)' }}>
                      {productResults.map(p => (
                        <button key={p.id} onClick={() => addPart(p)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-white/10 transition-colors">
                          <span className="text-white">{p.name}</span>
                          <span className="text-white/50 text-xs">฿{fmt(p.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button onClick={() => setBillItems(prev => [...prev, { product_id: null, product_name: 'ค่าแรง', qty: 1, price: 0, unit: 'ครั้ง' }])}
                  className="mt-2 text-xs text-white/40 hover:text-white/70 transition-colors">
                  + เพิ่มรายการเอง
                </button>
              </div>

              {/* Summary */}
              <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">รวมค่าซ่อม</span>
                  <span className="text-white">฿{fmt(billSubtotal)}</span>
                </div>
                {deposit > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-400/80">หักมัดจำที่รับไป</span>
                    <span className="text-amber-400">-฿{fmt(deposit)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t border-white/10">
                  <span className="text-white">ยอดรับเพิ่ม</span>
                  <span className="text-emerald-400">฿{fmt(billTotal)}</span>
                </div>
              </div>

              {/* Payment method */}
              <div>
                <p className="text-white/50 text-xs mb-2">รับเงินด้วย</p>
                <div className="flex gap-2">
                  {Object.entries(PAY_LABEL).map(([k, v]) => (
                    <button key={k} onClick={() => setBillPayMethod(k)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                      style={billPayMethod === k
                        ? { background: 'rgba(199,44,65,0.3)', border: '1px solid rgba(199,44,65,0.6)', color: '#fff' }
                        : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash received */}
              {billPayMethod === 'cash' && (
                <div>
                  <p className="text-white/50 text-xs mb-1.5">รับเงินมา (฿)</p>
                  <input type="number" value={billPaid} onChange={e => setBillPaid(e.target.value)}
                    placeholder={fmt(billTotal)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  {billPaid && changeAmt >= 0 && (
                    <p className="text-emerald-400 text-sm mt-1.5 font-semibold">ทอน ฿{fmt(changeAmt)}</p>
                  )}
                </div>
              )}

              {/* Confirm */}
              <div className="flex gap-3 pb-2">
                <button onClick={closeBill}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white/60"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  ยกเลิก
                </button>
                <button onClick={confirmBill} disabled={billing || billItems.length === 0}
                  className="flex-2 flex-grow-[2] py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#059669,#34d399)', boxShadow: '0 4px 14px rgba(5,150,105,0.4)' }}>
                  {billing ? 'กำลังออกบิล...' : `✅ ออกบิล ฿${fmt(billTotal)} · รับเครื่องแล้ว`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="w-full md:max-w-lg rounded-t-3xl md:rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '92vh' }}>

            <div className="flex items-center justify-between px-5 pt-5 pb-4 sticky top-0"
              style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <h2 className="font-bold text-white text-lg">{modal === 'add' ? '➕ เพิ่มคิวซ่อม' : '✏️ แก้ไขคิว'}</h2>
                {editId && <p className="text-white/40 text-xs mt-0.5">{jobs.find(j => j.id === editId)?.repair_no}</p>}
              </div>
              <button onClick={closeModal} className="text-white/40 hover:text-white text-2xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 'calc(92vh - 80px)' }}>
              <div className="px-5 py-4 space-y-4">

                {modal === 'edit' && (
                  <div>
                    <label className="text-white/50 text-xs mb-2 block">สถานะ</label>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(STATUS).map(([k, v]) => (
                        <button key={k} onClick={() => setForm(f => ({ ...f, status: k }))}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                          style={form.status === k
                            ? { background: v.bg, border: `1px solid ${v.border}`, color: v.color }
                            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                          {v.emoji} {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">ชื่อลูกค้า *</label>
                    <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                      placeholder="ชื่อลูกค้า"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">เบอร์โทร</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="0XX-XXX-XXXX" type="tel"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                </div>

                <div>
                  <label className="text-white/50 text-xs mb-1.5 block">อุปกรณ์ / เครื่อง *</label>
                  <input value={form.device} onChange={e => setForm(f => ({ ...f, device: e.target.value }))}
                    placeholder="เช่น เครื่องตัดหญ้า, เลื่อยไฟฟ้า..."
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                </div>

                <div>
                  <label className="text-white/50 text-xs mb-1.5 block">อาการ / รายละเอียดงาน</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="เช่น สตาร์ทไม่ติด, เปลี่ยนหัวเกียร์..."
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">วันที่นัด</label>
                    <input type="date" value={form.appointment_date} onChange={e => setForm(f => ({ ...f, appointment_date: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', colorScheme: 'dark' }} />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">เวลานัด</label>
                    <input type="time" value={form.appointment_time} onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', colorScheme: 'dark' }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">ค่าซ่อม (฿)</label>
                    <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                      placeholder="0.00" min="0"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">มัดจำ (฿)</label>
                    <input type="number" value={form.deposit} onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))}
                      placeholder="0.00" min="0"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                </div>

                <div>
                  <label className="text-white/50 text-xs mb-1.5 block">หมายเหตุ</label>
                  <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="หมายเหตุเพิ่มเติม..."
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                </div>

                <div className="flex gap-3 pt-2 pb-2">
                  {modal === 'edit' && (
                    <button onClick={() => deleteJob(editId)}
                      className="px-4 py-3 rounded-xl text-sm font-semibold text-red-400 transition-all active:scale-95"
                      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                      ลบ
                    </button>
                  )}
                  <button onClick={closeModal}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold text-white/60"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    ยกเลิก
                  </button>
                  <button onClick={saveJob} disabled={saving}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)', boxShadow: '0 4px 14px rgba(199,44,65,0.4)' }}>
                    {saving ? 'กำลังบันทึก...' : modal === 'add' ? 'เพิ่มคิว' : 'บันทึก'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
