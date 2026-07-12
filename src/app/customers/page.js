'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDT } from '@/lib/utils'
import { cacheSet, cacheGet, addToQueue } from '@/lib/offlineQueue'

const PAY_LABEL = { cash:'เงินสด', transfer:'โอน/QR', credit:'เชื่อ', mixed:'ผสม' }

const REPAIR_STATUS = {
  waiting:     { label: 'รอรับงาน',    emoji: '⏳', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  in_progress: { label: 'กำลังซ่อม',   emoji: '🔧', color: '#C72C41', bg: 'rgba(199,44,65,0.15)'  },
  done:        { label: 'เสร็จ รอรับ', emoji: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  picked_up:   { label: 'รับแล้ว',     emoji: '📦', color: '#801336', bg: 'rgba(128,19,54,0.15)'  },
  cancelled:   { label: 'ยกเลิก',      emoji: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState([])
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)
  const [sales, setSales]         = useState([])
  const [repairs, setRepairs]     = useState([])
  const [salesLoading, setSalesLoading] = useState(false)
  // undefined = form ปิด, null = เพิ่มใหม่, object = แก้ไข
  const [formTarget, setFormTarget] = useState(undefined)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (!navigator.onLine) {
        const cached = cacheGet('customers')
        setCustomers(cached || [])
        return
      }
      const { data } = await supabase.from('customers').select('id,code,name,phone,address,tax_id,credit_limit,balance').order('name')
      setCustomers(data || [])
      cacheSet('customers', data || [])
    } catch (e) {
      console.error('customers load error:', e)
      const cached = cacheGet('customers')
      if (cached) setCustomers(cached)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Realtime: รีเฟรชอัตโนมัติเมื่อมีการเพิ่ม/แก้ไขลูกค้าจากอุปกรณ์อื่น
  useEffect(() => {
    const ch = supabase.channel('customers-realtime')
      .on('postgres_changes', { event: '*', schema: 'pos', table: 'customers' }, () => loadData())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [loadData])

  async function openCustomer(c) {
    setSelected(c)
    setSales([])
    setRepairs([])
    setSalesLoading(true)
    try {
      const cleanPhone = c.phone ? c.phone.replace(/\D/g, '') : null
      const [{ data: salesData }, { data: repairsData }] = await Promise.all([
        supabase.from('sales')
          .select('id,receipt_no,created_at,total,payment_method,status')
          .eq('customer_id', c.id)
          .order('created_at', { ascending: false })
          .limit(30),
        cleanPhone
          ? supabase.from('repair_orders')
              .select('id,repair_no,device,status,created_at,price')
              .eq('phone', cleanPhone)
              .order('created_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] }),
      ])
      setSales(salesData || [])
      setRepairs(repairsData || [])
    } catch (e) {
      console.error('openCustomer error:', e)
    } finally {
      setSalesLoading(false)
    }
  }

  const filtered = customers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone||'').includes(search) || (c.code||'').includes(search)
  )

  return (
    <div className="min-h-screen"
      style={{ background: 'linear-gradient(135deg,#fdf4f5 0%,#fff8f0 100%)' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 no-print"
        style={{ background: 'linear-gradient(135deg,#14060a 0%,#2D142C 100%)' }}>
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold text-white">ลูกค้า</h1>
              <p className="text-xs text-white/40">{customers.length} ราย</p>
            </div>
            <button onClick={() => setFormTarget(null)}
              className="bg-brand text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-lg active:scale-95">
              + เพิ่มลูกค้า
            </button>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-base">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อ, เบอร์, รหัส..."
              className="w-full bg-white/10 text-white placeholder-white/30 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-brand/50" />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="p-3 space-y-2">
        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            {search ? 'ไม่พบลูกค้า' : 'ยังไม่มีลูกค้า กด + เพิ่มได้เลย'}
          </div>
        ) : filtered.map(c => (
          <button key={c.id} onClick={() => openCustomer(c)}
            className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100/80 text-left active:scale-[0.98] transition-transform">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-white text-lg shrink-0"
                style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
                {c.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-800 truncate">{c.name}</p>
                  {c.code && <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-md shrink-0">{c.code}</span>}
                </div>
                {c.phone && <p className="text-xs text-slate-400 mt-0.5">{c.phone}</p>}
              </div>
              <div className="text-right shrink-0">
                {(c.balance > 0 || c.credit_limit > 0) ? (
                  <>
                    <p className={`text-sm font-bold ${c.balance > 0 ? 'text-red-500' : 'text-slate-300'}`}>
                      {c.balance > 0 ? `ค้าง ฿${fmt(c.balance)}` : '-'}
                    </p>
                    {c.credit_limit > 0 && (
                      <p className="text-[10px] text-slate-300 mt-0.5">วงเงิน ฿{fmt(c.credit_limit)}</p>
                    )}
                  </>
                ) : (
                  <span className="text-slate-200 text-xs">→</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Detail Sheet */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}>
          <div className="w-full md:max-w-md bg-white rounded-t-3xl md:rounded-3xl overflow-hidden max-h-[90vh] flex flex-col">

            {/* Sheet header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white text-xl shrink-0"
                style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
                {selected.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 text-base truncate">{selected.name}</p>
                <p className="text-xs text-slate-400">{selected.phone || 'ไม่มีเบอร์'}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setFormTarget(selected); setSelected(null) }}
                  className="bg-amber-400 text-white px-3 py-1.5 rounded-xl text-xs font-semibold">✏️ แก้ไข</button>
                <button onClick={() => setSelected(null)} className="text-slate-300 hover:text-slate-500 text-2xl leading-none">×</button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Info */}
              <div className="px-5 py-4 grid grid-cols-2 gap-3">
                {selected.code && <InfoBlock label="รหัส" value={selected.code} />}
                {selected.address && <InfoBlock label="ที่อยู่" value={selected.address} span />}
                {selected.tax_id && <InfoBlock label="เลขภาษี" value={selected.tax_id} />}
                {selected.credit_limit > 0 && <InfoBlock label="วงเงินเครดิต" value={`฿${fmt(selected.credit_limit)}`} />}
                {selected.balance > 0 && <InfoBlock label="ยอดค้างชำระ" value={`฿${fmt(selected.balance)}`} highlight />}
              </div>

              {/* Repair history */}
              {(salesLoading || repairs.length > 0) && (
                <div className="px-5 pb-2 pt-1">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">ประวัติคิวซ่อม</p>
                </div>
              )}
              {!salesLoading && repairs.length > 0 && (
                <div className="px-4 pb-2 space-y-2">
                  {repairs.map(r => {
                    const s = REPAIR_STATUS[r.status] || REPAIR_STATUS.waiting
                    return (
                      <div key={r.id} className="flex items-center gap-3 p-3 rounded-2xl border bg-white border-gray-100">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-700">{r.repair_no}</p>
                          <p className="text-xs text-slate-500 truncate">{r.device}</p>
                          <p className="text-xs text-slate-400">{fmtDT(r.created_at)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {r.price != null && <p className="text-sm font-bold text-brand">฿{fmt(r.price)}</p>}
                          <p className="text-[10px] rounded-md px-1.5 py-0.5 inline-block mt-0.5"
                            style={{ background: s.bg, color: s.color }}>{s.emoji} {s.label}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Sales history */}
              <div className="px-5 pb-2 pt-1">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">ประวัติซื้อ</p>
              </div>
              {salesLoading ? (
                <div className="text-center py-8 text-slate-400 text-sm">กำลังโหลด...</div>
              ) : sales.length === 0 ? (
                <div className="text-center py-8 text-slate-300 text-sm">ยังไม่มีประวัติ</div>
              ) : (
                <div className="px-4 pb-6 space-y-2">
                  {sales.map(s => (
                    <div key={s.id} className={`flex items-center gap-3 p-3 rounded-2xl border ${s.status==='voided'?'opacity-40 bg-gray-50':'bg-white border-gray-100'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700">{s.receipt_no}</p>
                        <p className="text-xs text-slate-400">{fmtDT(s.created_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-brand">฿{fmt(s.total)}</p>
                        <p className={`text-[10px] rounded-md px-1.5 py-0.5 inline-block mt-0.5 ${
                          s.payment_method==='credit' ? 'bg-orange-100 text-orange-600' :
                          s.status==='voided' ? 'bg-gray-100 text-gray-400' :
                          'bg-green-50 text-green-600'
                        }`}>{s.status==='voided'?'ยกเลิก':PAY_LABEL[s.payment_method]||s.payment_method}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form */}
      {formTarget !== undefined && (
        <CustomerForm
          key={formTarget?.id ?? 'new'}
          initial={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={async (saved) => {
            const wasEdit = formTarget
            setFormTarget(undefined)
            await loadData()
            if (wasEdit) openCustomer(saved)
          }}
        />
      )}
    </div>
  )
}

function InfoBlock({ label, value, span, highlight }) {
  return (
    <div className={`bg-slate-50 rounded-2xl p-3 ${span ? 'col-span-2' : ''}`}>
      <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? 'text-red-500' : 'text-slate-700'}`}>{value}</p>
    </div>
  )
}

function CustomerForm({ initial, onClose, onSaved }) {
  const [name, setName]               = useState(initial?.name || '')
  const [phone, setPhone]             = useState(initial?.phone || '')
  const [address, setAddress]         = useState(initial?.address || '')
  const [taxId, setTaxId]             = useState(initial?.tax_id || '')
  const [code, setCode]               = useState(initial?.code || '')
  const [creditLimit, setCreditLimit] = useState(String(initial?.credit_limit || ''))
  const [balance, setBalance]         = useState(String(initial?.balance || ''))
  const [saving, setSaving]           = useState(false)

  async function save() {
    if (!name.trim()) return alert('กรุณากรอกชื่อลูกค้า')
    setSaving(true)
    const payload = {
      name: name.trim(),
      phone: phone.trim() || null,
      address: address.trim() || null,
      tax_id: taxId.trim() || null,
      code: code.trim() || null,
      credit_limit: creditLimit ? Number(creditLimit) : null,
      balance: balance ? Number(balance) : null,
    }
    if (!navigator.onLine) {
      addToQueue('customer', { action: initial ? 'update' : 'insert', id: initial?.id, payload })
      window.dispatchEvent(new Event('offline-queue-changed'))
      onSaved({ ...payload, id: initial?.id || `offline_${Date.now()}` })
      return
    }
    if (initial) {
      const { error } = await supabase.from('customers').update(payload).eq('id', initial.id)
      if (error) { alert('เกิดข้อผิดพลาด: ' + error.message); setSaving(false); return }
      onSaved({ ...initial, ...payload })
    } else {
      const { data, error } = await supabase.from('customers').insert(payload).select().single()
      if (error) { alert('เกิดข้อผิดพลาด: ' + error.message); setSaving(false); return }
      onSaved(data)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full md:max-w-md bg-white rounded-t-3xl md:rounded-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <p className="font-bold text-slate-800">{initial ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}</p>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500 text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <Field label="ชื่อ *" value={name} onChange={setName} placeholder="ชื่อลูกค้าหรือบริษัท" />
          <Field label="เบอร์โทร" value={phone} onChange={setPhone} placeholder="0812345678" type="tel" />
          <Field label="รหัสลูกค้า" value={code} onChange={setCode} placeholder="CUS001" />
          <Field label="ที่อยู่" value={address} onChange={setAddress} placeholder="ที่อยู่สำหรับออกเอกสาร" multiline />
          <Field label="เลขประจำตัวผู้เสียภาษี" value={taxId} onChange={setTaxId} placeholder="0123456789012" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="วงเงินเครดิต (฿)" value={creditLimit} onChange={setCreditLimit} placeholder="0" type="number" />
            <Field label="ยอดค้าง (฿)" value={balance} onChange={setBalance} placeholder="0" type="number" />
          </div>
        </div>
        <div className="px-5 pb-5 pt-2 shrink-0">
          <button onClick={save} disabled={saving}
            className="w-full bg-brand text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-50 active:scale-[0.98] transition-transform">
            {saving ? '⏳ กำลังบันทึก...' : (initial ? '✓ บันทึกการแก้ไข' : '+ เพิ่มลูกค้า')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type='text', multiline }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none resize-none" />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
      )}
    </div>
  )
}
