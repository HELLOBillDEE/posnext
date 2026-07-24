'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { convertThaiBarcode } from '@/lib/utils'
import { buildLabelTSPL, printViaBridge } from '@/lib/printBridge'

const fmt = n => Number(n || 0).toLocaleString('th-TH')
const fmtPrice = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ─── PIN PAD ───────────────────────────────────────────────────────────────────
function PinPad({ onSuccess }) {
  const [employees, setEmployees] = useState([])
  const [selEmp, setSelEmp]       = useState(null)
  const [pin, setPin]             = useState('')
  const [pinError, setPinError]   = useState('')
  const [busy, setBusy]           = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    supabase.from('employees')
      .select('id, name, position, nickname, pin, can_login')
      .eq('active', true)
      .order('name')
      .then(({ data }) => { setEmployees(data || []); setLoading(false) })
  }, [])

  async function handleDigit(d) {
    if (busy) return
    const next = pin + d
    setPin(next)
    setPinError('')
    const needed = selEmp?.pin ? selEmp.pin.length : 4
    if (next.length < needed) return

    setBusy(true)
    try {
      const res = await fetch('/api/emp-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: next }),
      })
      const data = await res.json()
      if (!res.ok) { setPinError(data.error || 'PIN ไม่ถูกต้อง'); setPin(''); setBusy(false); return }
      // verify against selected employee if one is chosen
      if (selEmp && data.id !== selEmp.id) {
        setPinError('PIN ไม่ตรงกับพนักงานที่เลือก'); setPin(''); setBusy(false); return
      }
      onSuccess(data)
    } catch {
      setPinError('ติดต่อเซิร์ฟเวอร์ไม่ได้'); setPin(''); setBusy(false)
    }
  }

  function handleDel() { setPin(p => p.slice(0, -1)); setPinError('') }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(160deg,#14060a 0%,#2D142C 50%,#14060a 100%)' }}>

      {/* Logo / header */}
      <div className="text-center mb-8">
        <div className="w-20 h-20 rounded-2xl mx-auto mb-4 overflow-hidden border-2 border-white/10 shadow-xl">
          <img src="/logo.png" alt="logo" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none' }} />
        </div>
        <p className="text-white/40 text-sm tracking-widest uppercase">Employee Portal</p>
        <p className="text-white font-bold text-2xl mt-1">
          {selEmp ? selEmp.name : 'เลือกพนักงาน'}
        </p>
        {selEmp && <p className="text-white/50 text-sm mt-0.5">{selEmp.position}</p>}
      </div>

      {!selEmp ? (
        /* Employee list */
        <div className="w-full max-w-xs space-y-2">
          {loading
            ? <p className="text-center text-white/40 py-8">กำลังโหลด...</p>
            : employees.length === 0
              ? <p className="text-center text-white/40 py-8">ไม่มีพนักงานที่เปิดใช้งาน</p>
              : employees.map(emp => (
                <button key={emp.id}
                  onClick={() => { setSelEmp(emp); setPin(''); setPinError('') }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left active:scale-[0.97] transition-all"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white text-lg flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
                    {emp.name[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{emp.name}</p>
                    <p className="text-white/40 text-xs">{emp.position || 'พนักงาน'}</p>
                  </div>
                  <span className="ml-auto text-white/25 text-xl">›</span>
                </button>
              ))
          }
        </div>
      ) : (
        /* PIN pad */
        <div className="w-full max-w-xs">
          {/* Dots */}
          <div className="flex justify-center gap-4 mb-3">
            {Array.from({ length: selEmp.pin ? selEmp.pin.length : 4 }).map((_, i) => (
              <div key={i} className={`w-4 h-4 rounded-full transition-all duration-150 ${
                i < pin.length ? 'bg-brand scale-110' : 'bg-white/20'
              }`} style={{ '--tw-bg-opacity': 1 }} />
            ))}
          </div>
          {pinError
            ? <p className="text-center text-red-400 text-sm mb-3">{pinError}</p>
            : <p className="text-center text-white/35 text-xs mb-3">
                {selEmp.pin ? `กรอก PIN ${selEmp.pin.length} หลัก` : 'กด ✓ เพื่อเข้าใช้งาน'}
              </p>
          }

          <div className="grid grid-cols-3 gap-2.5">
            {[1,2,3,4,5,6,7,8,9].map(d => (
              <button key={d} onClick={() => handleDigit(String(d))} disabled={busy}
                className="py-4 rounded-2xl text-2xl font-bold text-white active:scale-95 transition-all disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {d}
              </button>
            ))}
            {/* ✓ or empty */}
            {!selEmp.pin
              ? <button onClick={() => handleDigit('')} disabled={busy}
                  className="py-4 rounded-2xl active:scale-95 transition-all"
                  style={{ background: 'rgba(199,44,65,0.25)', border: '1px solid rgba(199,44,65,0.4)' }}>
                  <span className="text-brand text-2xl font-bold">✓</span>
                </button>
              : <button onClick={() => { setSelEmp(null); setPin(''); setPinError('') }}
                  className="py-4 rounded-2xl active:scale-95 transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <span className="text-white/40 text-lg">←</span>
                </button>
            }
            <button onClick={() => handleDigit('0')} disabled={busy}
              className="py-4 rounded-2xl text-2xl font-bold text-white active:scale-95 transition-all disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.08)' }}>
              0
            </button>
            <button onClick={handleDel}
              className="py-4 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(255,255,255,0.05)' }}>
              <span className="text-white/50 text-xl">⌫</span>
            </button>
          </div>

          {busy && <p className="text-center text-white/40 text-xs mt-4 animate-pulse">กำลังตรวจสอบ...</p>}
        </div>
      )}
    </div>
  )
}

// ─── PRODUCTS TAB ──────────────────────────────────────────────────────────────
function ProductsTab({ printerCfg, empName }) {
  const [products, setProducts]       = useState([])
  const [search, setSearch]           = useState('')
  const [selected, setSelected]       = useState({}) // pid -> qty
  const [printing, setPrinting]       = useState(false)
  const [printMsg, setPrintMsg]       = useState(null)
  const [labelSize, setLabelSize]     = useState({ pw: 100, ph: 25, cols: 3 })
  // order mode
  const [mode, setMode]               = useState('print') // 'print' | 'order' | 'withdraw'
  const [orderSelected, setOrderSelected] = useState(new Set())
  const [showLowOnly, setShowLowOnly] = useState(true)
  const [orderModal, setOrderModal]   = useState(false)
  const [orderNote, setOrderNote]     = useState('')
  const [isSending, setIsSending]     = useState(false)
  const [sendMsg, setSendMsg]         = useState(null)
  // withdraw mode
  const [withdrawModal, setWithdrawModal]   = useState(false)
  const [withdrawType, setWithdrawType]     = useState('ใช้ในร้าน')
  const [withdrawNote, setWithdrawNote]     = useState('')
  const [isWithdrawing, setIsWithdrawing]   = useState(false)
  const [withdrawMsg, setWithdrawMsg]       = useState(null)

  useEffect(() => {
    async function loadAll() {
      const all = []
      const PAGE = 1000
      let from = 0
      while (true) {
        const { data } = await supabase.from('products')
          .select('id, name, barcode, alt_barcode, price, stock, min_stock, unit, active, search_tags, categories(name)')
          .order('name')
          .range(from, from + PAGE - 1)
        if (!data || data.length === 0) break
        all.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      setProducts(all)
    }
    loadAll()
  }, [])

  const filtered = products.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return p.name.toLowerCase().includes(q)
      || (p.barcode || '').toLowerCase().includes(q)
      || (p.alt_barcode || '').toLowerCase().includes(q)
      || (p.categories?.name || '').toLowerCase().includes(q)
      || (p.unit || '').toLowerCase().includes(q)
      || (p.search_tags || '').toLowerCase().includes(q)
  })

  function toggleSelect(pid) {
    setSelected(prev => {
      if (prev[pid]) { const n = { ...prev }; delete n[pid]; return n }
      return { ...prev, [pid]: 1 }
    })
  }

  function adjustQty(pid, delta) {
    setSelected(prev => {
      const next = Math.max(1, Math.min(99, (prev[pid] || 1) + delta))
      return { ...prev, [pid]: next }
    })
  }

  const selCount = Object.keys(selected).length
  const totalLabels = Object.values(selected).reduce((s, q) => s + q, 0)

  // ── Order mode helpers ─────────────────────────────────────────────────
  function toggleOrder(pid) {
    setOrderSelected(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n })
  }

  const isLow = p => Number(p.stock) <= Math.max(Number(p.min_stock || 0), 5)

  async function sendOrderRequest() {
    if (!orderSelected.size) return
    setIsSending(true)
    setSendMsg(null)
    try {
      const res = await fetch('/api/order-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: [...orderSelected], note: orderNote, requestedBy: empName || '' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'ส่งไม่ได้')
      setSendMsg({ ok: true, text: `✓ ส่ง Telegram ${json.sent} รายการแล้ว` })
      setOrderSelected(new Set())
      setOrderNote('')
      setTimeout(() => { setOrderModal(false); setSendMsg(null) }, 2000)
    } catch (e) {
      setSendMsg({ ok: false, text: e.message })
    }
    setIsSending(false)
  }

  async function submitWithdraw() {
    if (!Object.keys(selected).length) return
    setIsWithdrawing(true)
    setWithdrawMsg(null)
    try {
      const items = Object.entries(selected).map(([pid, qty]) => {
        const p = products.find(x => String(x.id) === String(pid))
        return p ? { ...p, withdrawQty: qty } : null
      }).filter(Boolean)

      await Promise.all(items.map(p =>
        supabase.from('products').update({ stock: Math.max(0, Number(p.stock) - p.withdrawQty) }).eq('id', p.id)
      ))
      await Promise.all(items.map(p =>
        supabase.from('stock_history').insert({
          product_id: p.id, product_name: p.name,
          qty_before: Number(p.stock),
          qty_change: -p.withdrawQty,
          qty_after: Math.max(0, Number(p.stock) - p.withdrawQty),
          type: 'withdraw',
          note: `เบิก${withdrawType}${withdrawNote ? ` — ${withdrawNote}` : ''}`,
          created_by: empName || '',
        })
      ))
      // อัปเดต stock ใน local state
      setProducts(prev => prev.map(p => {
        const item = items.find(x => String(x.id) === String(p.id))
        if (!item) return p
        return { ...p, stock: Math.max(0, Number(p.stock) - item.withdrawQty) }
      }))
      setWithdrawMsg({ ok: true, text: `✓ เบิก ${items.length} รายการแล้ว` })
      setSelected({})
      setWithdrawNote('')
      setTimeout(() => { setWithdrawModal(false); setWithdrawMsg(null) }, 2000)
    } catch (e) {
      setWithdrawMsg({ ok: false, text: e.message || 'เบิกสินค้าไม่ได้' })
    }
    setIsWithdrawing(false)
  }

  async function handlePrint() {
    if (!printerCfg || printing || selCount === 0) return
    setPrinting(true)
    setPrintMsg(null)
    try {
      const items = Object.entries(selected).map(([pid, qty]) => {
        const p = products.find(x => x.id === parseInt(pid) || x.id === pid)
        if (!p) return null
        return { name: p.name, barcode: p.barcode || '', price: p.price || 0, qty }
      }).filter(Boolean)

      if (items.length === 0) throw new Error('ไม่พบสินค้า')
      const bytes = await buildLabelTSPL(items, labelSize)
      await printViaBridge(printerCfg.bridge_url || '', printerCfg.ip, parseInt(printerCfg.port) || 9100, bytes, [0])
      const totalPrinted = items.reduce((s, i) => s + i.qty, 0)
      setPrintMsg({ ok: true, text: `ปริ้น ${totalPrinted} แผ่น สำเร็จ` })
      setSelected({})
    } catch (e) {
      setPrintMsg({ ok: false, text: e.message || 'ปริ้นไม่ได้' })
    }
    setPrinting(false)
    setTimeout(() => setPrintMsg(null), 3500)
  }

  // products for order mode: sorted low-stock first
  const orderList = [...products].sort((a, b) => Number(a.stock) - Number(b.stock))
  const orderFiltered = orderList.filter(p => {
    const matchSearch = !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.barcode || '').toLowerCase().includes(search.toLowerCase())
      || (p.search_tags || '').toLowerCase().includes(search.toLowerCase())
    const matchLow = !showLowOnly || search.trim() || isLow(p)
    return matchSearch && matchLow
  })
  const lowCount = products.filter(isLow).length

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="px-3 pt-3 pb-2 bg-white border-b border-slate-100 flex-shrink-0">
        {/* Mode toggle */}
        <div className="flex gap-1 mb-2 p-1 bg-slate-100 rounded-xl">
          <button onClick={() => { setMode('print'); setSearch(''); setSelected({}) }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === 'print' ? 'bg-white shadow text-slate-700' : 'text-slate-400'}`}>
            🖨️ พิม
          </button>
          <button onClick={() => { setMode('withdraw'); setSearch(''); setSelected({}) }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === 'withdraw' ? 'bg-white shadow text-emerald-600' : 'text-slate-400'}`}>
            📦 เบิก
          </button>
          <button onClick={() => { setMode('order'); setSearch('') }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === 'order' ? 'bg-white shadow text-brand' : 'text-slate-400'}`}>
            🛒 สั่ง{lowCount > 0 ? `(${lowCount})` : ''}
          </button>
        </div>

        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={mode === 'order' ? '🔍 ค้นหาสินค้าที่ต้องสั่ง...' : '🔍 ค้นหาชื่อ / บาร์โค้ด...'}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand bg-slate-50"
        />

        {/* Print mode controls */}
        {mode === 'print' && selCount > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={handlePrint} disabled={printing || !printerCfg}
              className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm active:scale-[0.98] transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
              {printing ? '⏳ กำลังปริ้น...' : `🖨️ ปริ้น ${totalLabels} แผ่น (${selCount} ชนิด)`}
            </button>
            <button onClick={() => setSelected({})}
              className="px-3 py-2.5 rounded-xl text-slate-500 text-sm border border-slate-200">ยกเลิก</button>
          </div>
        )}
        {mode === 'print' && !printerCfg && (
          <p className="text-xs text-orange-500 mt-1.5 text-center">⚠️ ไม่พบเครื่องพิมพ์ (ตั้งค่าในหน้า admin)</p>
        )}
        {mode === 'print' && printMsg && (
          <p className={`text-sm text-center mt-2 font-medium ${printMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
            {printMsg.ok ? '✓' : '✗'} {printMsg.text}
          </p>
        )}

        {/* Withdraw mode controls */}
        {mode === 'withdraw' && selCount > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => setWithdrawModal(true)}
              className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}>
              📦 เบิก {totalLabels} ชิ้น ({selCount} ชนิด)
            </button>
            <button onClick={() => setSelected({})}
              className="px-3 py-2.5 rounded-xl text-slate-500 text-sm border border-slate-200">ยกเลิก</button>
          </div>
        )}

        {/* Order mode filter */}
        {mode === 'order' && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => setShowLowOnly(v => !v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${showLowOnly ? 'text-white' : 'bg-slate-100 text-slate-500'}`}
              style={showLowOnly ? { background: '#C72C41' } : {}}>
              {showLowOnly ? '⚠️ สต็อกน้อย' : '📦 ทั้งหมด'}
            </button>
            {orderSelected.size > 0 && (
              <button onClick={() => setOrderSelected(new Set())}
                className="text-xs text-slate-400 ml-auto">ยกเลิกทั้งหมด</button>
            )}
            {orderSelected.size > 0 && (
              <button onClick={() => setOrderModal(true)}
                className="text-xs font-bold text-white px-3 py-1.5 rounded-lg"
                style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
                ส่งแอดมิน {orderSelected.size} รายการ
              </button>
            )}
          </div>
        )}
      </div>

      {/* Print mode — product list */}
      {mode === 'print' && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {filtered.length === 0
            ? <p className="text-center text-slate-400 py-16 text-sm">{products.length === 0 ? 'กำลังโหลด...' : 'ไม่พบสินค้า'}</p>
            : filtered.map(p => {
              const isSelected = !!selected[p.id]
              return (
                <div key={p.id} onClick={() => toggleSelect(p.id)}
                  className={`bg-white rounded-xl p-3 shadow-sm flex items-center gap-3 active:scale-[0.99] transition-all cursor-pointer ${isSelected ? 'ring-2 ring-brand/60' : ''}`}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all`}
                    style={isSelected ? { background: 'linear-gradient(135deg,#C72C41,#801336)', color: '#fff' } : { background: 'rgba(199,44,65,0.08)', color: '#C72C41' }}>
                    {isSelected ? '✓' : p.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm leading-tight truncate">{p.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{p.barcode || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-brand text-sm">฿{fmtPrice(p.price)}</p>
                    <p className="text-xs text-slate-400">สต็อก {fmt(p.stock)} {p.unit || 'ชิ้น'}</p>
                  </div>
                  {isSelected && (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button onPointerDown={e => { e.stopPropagation(); adjustQty(p.id, -1) }}
                        className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center active:scale-90">−</button>
                      <span className="w-8 text-center text-base font-bold text-brand">{selected[p.id]}</span>
                      <button onPointerDown={e => { e.stopPropagation(); adjustQty(p.id, 1) }}
                        className="w-8 h-8 rounded-full font-bold text-lg flex items-center justify-center active:scale-90"
                        style={{ background: 'rgba(199,44,65,0.12)', color: '#C72C41' }}>+</button>
                    </div>
                  )}
                </div>
              )
            })
          }
        </div>
      )}

      {/* Withdraw mode — product list (reuses filtered + selected) */}
      {mode === 'withdraw' && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {filtered.length === 0
            ? <p className="text-center text-slate-400 py-16 text-sm">{products.length === 0 ? 'กำลังโหลด...' : 'ไม่พบสินค้า'}</p>
            : filtered.map(p => {
              const isSelected = !!selected[p.id]
              return (
                <div key={p.id} onClick={() => toggleSelect(p.id)}
                  className={`bg-white rounded-xl p-3 shadow-sm flex items-center gap-3 active:scale-[0.99] transition-all cursor-pointer ${isSelected ? 'ring-2 ring-emerald-400/60' : ''}`}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all`}
                    style={isSelected ? { background: 'linear-gradient(135deg,#059669,#047857)', color: '#fff' } : { background: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                    {isSelected ? '✓' : p.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm leading-tight truncate">{p.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{p.barcode || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-500">฿{fmtPrice(p.price)}</p>
                    <p className={`text-xs font-semibold mt-0.5 ${Number(p.stock) <= 0 ? 'text-red-500' : 'text-slate-500'}`}>
                      สต็อก {fmt(p.stock)} {p.unit || 'ชิ้น'}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button onPointerDown={e => { e.stopPropagation(); adjustQty(p.id, -1) }}
                        className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center active:scale-90">−</button>
                      <span className="w-8 text-center text-base font-bold text-emerald-600">{selected[p.id]}</span>
                      <button onPointerDown={e => { e.stopPropagation(); adjustQty(p.id, 1) }}
                        className="w-8 h-8 rounded-full font-bold text-lg flex items-center justify-center active:scale-90"
                        style={{ background: 'rgba(5,150,105,0.12)', color: '#059669' }}>+</button>
                    </div>
                  )}
                </div>
              )
            })
          }
        </div>
      )}

      {/* Order mode — low-stock list */}
      {mode === 'order' && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {orderFiltered.length === 0
            ? <p className="text-center text-slate-400 py-16 text-sm">{products.length === 0 ? 'กำลังโหลด...' : 'ไม่พบสินค้า'}</p>
            : orderFiltered.map(p => {
              const checked = orderSelected.has(p.id)
              const low     = isLow(p)
              const noStock = Number(p.stock) <= 0
              return (
                <div key={p.id} onClick={() => toggleOrder(p.id)}
                  className={`rounded-xl p-3 shadow-sm flex items-center gap-3 cursor-pointer border transition-all active:scale-[0.99] ${
                    checked ? 'border-brand/40 bg-red-50' : low ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'
                  }`}>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    checked ? 'border-brand bg-brand' : 'border-slate-300'
                  }`}>
                    {checked && <span className="text-white text-[10px] font-bold">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm leading-tight truncate">{p.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{p.barcode || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold text-sm ${noStock ? 'text-red-600' : low ? 'text-amber-600' : 'text-slate-600'}`}>
                      {noStock ? '⛔ หมด' : `${fmt(p.stock)} ${p.unit || 'ชิ้น'}`}
                    </p>
                    {p.min_stock > 0 && <p className="text-[10px] text-slate-400">min {fmt(p.min_stock)}</p>}
                  </div>
                </div>
              )
            })
          }
        </div>
      )}

      {/* ── Withdraw Modal ── */}
      {withdrawModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setWithdrawModal(false)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-700">📦 เบิกสินค้าใช้ในร้าน</p>
                <p className="text-xs text-slate-400 mt-0.5">สต็อกจะถูกหักทันที และบันทึกประวัติ</p>
              </div>
              <button onClick={() => setWithdrawModal(false)} className="text-slate-400 text-xl">✕</button>
            </div>

            {/* Type selector */}
            <div className="px-4 pt-3 pb-1 flex gap-2">
              {['ร้านซ่อม', 'ใช้ในร้าน', 'กรอกแบ่ง'].map(t => (
                <button key={t} onClick={() => setWithdrawType(t)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${withdrawType === t ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500'}`}
                  style={withdrawType === t ? { background: 'linear-gradient(135deg,#059669,#047857)' } : {}}>
                  {t === 'ร้านซ่อม' ? '🔧 ร้านซ่อม' : t === 'ใช้ในร้าน' ? '🏪 ใช้ในร้าน' : '📂 กรอกแบ่ง'}
                </button>
              ))}
            </div>

            {/* Item list */}
            <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1.5">
              {Object.entries(selected).map(([pid, qty]) => {
                const p = products.find(x => String(x.id) === String(pid))
                if (!p) return null
                return (
                  <div key={pid} className="bg-slate-50 rounded-xl px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 text-sm truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-400">{p.barcode || '—'} · สต็อก {fmt(p.stock)} {p.unit || 'ชิ้น'}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onPointerDown={e => { e.stopPropagation(); adjustQty(p.id, -1) }}
                        className="w-7 h-7 rounded-full bg-slate-200 text-slate-600 font-bold flex items-center justify-center active:scale-90">−</button>
                      <span className="w-8 text-center font-bold text-emerald-600 text-sm">{qty}</span>
                      <button onPointerDown={e => { e.stopPropagation(); adjustQty(p.id, 1) }}
                        className="w-7 h-7 rounded-full font-bold flex items-center justify-center active:scale-90"
                        style={{ background: 'rgba(5,150,105,0.15)', color: '#059669' }}>+</button>
                    </div>
                    <button onClick={() => toggleSelect(p.id)} className="text-slate-300 active:text-red-400 text-base px-1">✕</button>
                  </div>
                )
              })}
            </div>

            <div className="p-4 border-t border-slate-100 space-y-2.5">
              <textarea value={withdrawNote} onChange={e => setWithdrawNote(e.target.value)}
                placeholder="หมายเหตุ เช่น ซ่อม iPhone ลูกค้า / แบ่งใส่ถุง (ไม่บังคับ)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-emerald-400"
                rows={2} />
              {withdrawMsg && (
                <p className={`text-sm text-center font-medium ${withdrawMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{withdrawMsg.text}</p>
              )}
              <button onClick={submitWithdraw} disabled={isWithdrawing || !Object.keys(selected).length}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-40 active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}>
                {isWithdrawing ? '⏳ กำลังบันทึก...' : `📦 ยืนยันเบิก${withdrawType} ${totalLabels} ชิ้น`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Order Modal ── */}
      {orderModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setOrderModal(false)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-700">🛒 ส่งรายการสั่งซื้อให้แอดมิน</p>
                <p className="text-xs text-slate-400 mt-0.5">จะส่ง Telegram พร้อมข้อมูลยอดขายให้แอดมินตัดสินใจ</p>
              </div>
              <button onClick={() => setOrderModal(false)} className="text-slate-400 text-xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
              {[...orderSelected].map(pid => {
                const p = products.find(x => x.id === pid)
                if (!p) return null
                return (
                  <div key={pid} className="bg-slate-50 rounded-xl px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 text-sm truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-400">{p.barcode || '—'}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-bold ${Number(p.stock) <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        สต็อก {fmt(p.stock)} {p.unit}
                      </p>
                    </div>
                    <button onClick={() => toggleOrder(pid)} className="text-slate-300 active:text-red-400 text-base px-1">✕</button>
                  </div>
                )
              })}
            </div>
            <div className="p-4 border-t border-slate-100 space-y-2.5">
              <textarea value={orderNote} onChange={e => setOrderNote(e.target.value)}
                placeholder="หมายเหตุสำหรับแอดมิน เช่น ด่วน / รอลูกค้า (ไม่บังคับ)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-brand"
                rows={2} />
              {sendMsg && (
                <p className={`text-sm text-center font-medium ${sendMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{sendMsg.text}</p>
              )}
              <button onClick={sendOrderRequest} disabled={isSending || orderSelected.size === 0}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-40 active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#C72C41,#e25470)' }}>
                {isSending ? '📤 กำลังส่ง...' : `📤 ส่ง Telegram ${orderSelected.size} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── STOCK COUNT TAB ───────────────────────────────────────────────────────────
function StockCountTab({ empName }) {
  const [products, setProducts]     = useState([])
  const [counts, setCounts]         = useState([])
  const [scanInput, setScanInput]   = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [nameSuggs, setNameSuggs]   = useState([])
  const [lastMsg, setLastMsg]       = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  // session save/load
  const [sessionId, setSessionId]     = useState(null)
  const [sessions, setSessions]       = useState([])
  const [modal, setModal]             = useState(null) // 'save'|'history'|'adjust'|'order'
  const [isSaving, setIsSaving]       = useState(false)
  const [nameInput, setNameInput]     = useState('')
  const [orderNote, setOrderNote]     = useState('')
  const [selectedAdjust, setSelectedAdjust] = useState(new Set())
  const [selectedOrder, setSelectedOrder]   = useState(new Set())
  const inputRef    = useRef(null)
  const productsRef = useRef([])
  const scannerRef  = useRef(null)
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const rafRef      = useRef(null)
  const [hasBD, setHasBD] = useState(false) // BarcodeDetector available

  useEffect(() => { setHasBD(typeof window !== 'undefined' && 'BarcodeDetector' in window) }, [])

  useEffect(() => { productsRef.current = products }, [products])

  useEffect(() => {
    async function loadAll() {
      const all = []
      const PAGE = 1000
      let from = 0
      while (true) {
        const { data } = await supabase.from('products')
          .select('id, name, barcode, alt_barcode, stock, unit, search_tags, categories(name)')
          .range(from, from + PAGE - 1)
        if (!data || data.length === 0) break
        all.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      setProducts(all)
    }
    loadAll()
    try {
      const saved = JSON.parse(localStorage.getItem('stock_count_session') || 'null')
      if (saved) setCounts(saved)
    } catch {}
    inputRef.current?.focus()
  }, [])

  const flash = useCallback((text, ok = true) => {
    setLastMsg({ text, ok })
    setTimeout(() => setLastMsg(null), 3000)
  }, [])

  const addProduct = useCallback((prod, qty = 1) => {
    flash(`✓ ${prod.name}`)
    setCounts(prev => {
      const next = prev.find(c => c.pid === prod.id)
        ? prev.map(c => c.pid === prod.id ? { ...c, counted: c.counted + qty } : c)
        : [{ barcode: prod.barcode || '', pid: prod.id, name: prod.name, counted: qty, system: prod.stock || 0, unit: prod.unit || 'ชิ้น' }, ...prev]
      localStorage.setItem('stock_count_session', JSON.stringify(next))
      return next
    })
  }, [flash])

  const processBarcode = useCallback((raw) => {
    const bc = convertThaiBarcode((raw || '').trim()).toUpperCase()
    if (!bc) return
    const prod = productsRef.current.find(p =>
      (p.barcode || '').toUpperCase() === bc || (p.alt_barcode || '').toUpperCase() === bc
    )
    if (!prod) { flash(`ไม่พบ: ${bc}`, false); return }
    addProduct(prod)
  }, [flash, addProduct])

  function handleKey(e) {
    if (e.key === 'Enter') { processBarcode(scanInput); setScanInput('') }
  }

  function handleNameSearch(v) {
    setNameSearch(v)
    if (!v.trim()) { setNameSuggs([]); return }
    const q = v.toLowerCase()
    setNameSuggs(productsRef.current.filter(p =>
      p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)
      || (p.alt_barcode || '').toLowerCase().includes(q)
      || (p.categories?.name || '').toLowerCase().includes(q)
      || (p.unit || '').toLowerCase().includes(q)
      || (p.search_tags || '').toLowerCase().includes(q)
    ).slice(0, 15))
  }

  function pickSugg(prod) {
    setNameSearch(''); setNameSuggs([])
    addProduct(prod)
    inputRef.current?.focus()
  }

  async function openCamera() {
    setCameraOpen(true)
    await new Promise(r => setTimeout(r, 200))
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      scannerRef.current = stream

      if ('BarcodeDetector' in window) {
        // ── native BarcodeDetector (iOS 17+, Android Chrome) ──
        let supportedFormats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code']
        try {
          const all = await window.BarcodeDetector.getSupportedFormats()
          supportedFormats = supportedFormats.filter(f => all.includes(f))
        } catch {}
        const detector = new window.BarcodeDetector({ formats: supportedFormats.length ? supportedFormats : ['qr_code'] })

        await new Promise(r => setTimeout(r, 100))
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        let lastCode = '', lastTime = 0
        const scan = async () => {
          const vid = videoRef.current
          const cvs = canvasRef.current
          if (!vid || vid.readyState < 2 || !cvs) {
            rafRef.current = requestAnimationFrame(scan); return
          }
          cvs.width = vid.videoWidth || 640
          cvs.height = vid.videoHeight || 480
          cvs.getContext('2d').drawImage(vid, 0, 0)
          try {
            const results = await detector.detect(cvs)
            if (results.length > 0) {
              const code = results[0].rawValue
              const now = Date.now()
              if (code !== lastCode || now - lastTime > 2000) {
                lastCode = code; lastTime = now
                processBarcode(code)
                if (navigator.vibrate) navigator.vibrate(80)
              }
            }
          } catch {}
          rafRef.current = requestAnimationFrame(scan)
        }
        rafRef.current = requestAnimationFrame(scan)

      } else {
        // ── fallback: html5-qrcode (iOS 16, Firefox) ──
        stream.getTracks().forEach(t => t.stop())
        scannerRef.current = null
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        const scanner = new Html5Qrcode('emp-stock-qr-reader', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 15, qrbox: (w, h) => ({ width: Math.round(Math.min(w,h) * 0.8), height: Math.round(Math.min(w,h) * 0.4) }) },
          (text) => { processBarcode(text); if (navigator.vibrate) navigator.vibrate(80) },
          () => {}
        )
      }
    } catch (e) {
      flash('เปิดกล้องไม่ได้: ' + (e?.message || 'ไม่รองรับ'), false)
      setCameraOpen(false)
    }
  }

  async function closeCamera() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    try {
      if (scannerRef.current instanceof MediaStream) {
        scannerRef.current.getTracks().forEach(t => t.stop())
      } else if (scannerRef.current) {
        await scannerRef.current.stop()
        scannerRef.current.clear()
      }
      scannerRef.current = null
    } catch {}
    if (videoRef.current) { videoRef.current.srcObject = null }
    setCameraOpen(false)
    inputRef.current?.focus()
  }

  function adjustCount(pid, delta) {
    setCounts(prev => {
      const next = prev.map(c => c.pid === pid ? { ...c, counted: Math.max(0, c.counted + delta) } : c).filter(c => c.counted > 0)
      localStorage.setItem('stock_count_session', JSON.stringify(next))
      return next
    })
  }

  function removeItem(pid) {
    setCounts(prev => { const next = prev.filter(c => c.pid !== pid); localStorage.setItem('stock_count_session', JSON.stringify(next)); return next })
  }

  // ── Session save/load ──────────────────────────────────────────────────────
  async function loadSessions() {
    const { data } = await supabase.from('stock_count_sessions')
      .select('id, name, status, items, counted_by, created_at, updated_at')
      .order('updated_at', { ascending: false }).limit(30)
    setSessions(data || [])
  }

  async function saveSession(status) {
    if (!nameInput.trim()) return
    setIsSaving(true)
    try {
      const payload = { name: nameInput.trim(), status, items: counts, counted_by: empName || '', updated_at: new Date().toISOString() }
      if (sessionId) {
        await supabase.from('stock_count_sessions').update(payload).eq('id', sessionId)
      } else {
        const { data } = await supabase.from('stock_count_sessions').insert(payload).select('id').single()
        if (data?.id) setSessionId(data.id)
      }
      localStorage.setItem('stock_count_session', JSON.stringify(counts))
      flash(status === 'completed' ? '✓ บันทึกสำเร็จแล้ว' : '✓ บันทึกร่างแล้ว')
      setModal(null)
    } catch { flash('บันทึกไม่ได้', false) }
    finally { setIsSaving(false) }
  }

  function openSaveModal() {
    setNameInput(nameInput || `นับสต็อก ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}`)
    setModal('save')
  }

  function openHistoryModal() { loadSessions(); setModal('history') }

  function loadSessionData(sess) {
    if (counts.length > 0 && !confirm('แทนที่ข้อมูลที่นับอยู่?')) return
    setCounts(sess.items || [])
    setSessionId(sess.id)
    setNameInput(sess.name || '')
    localStorage.setItem('stock_count_session', JSON.stringify(sess.items || []))
    setModal(null)
    flash(`โหลด "${sess.name}" แล้ว`)
  }

  async function deleteSession(id, e) {
    e.stopPropagation()
    if (!confirm('ลบร่างนี้?')) return
    await supabase.from('stock_count_sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (sessionId === id) setSessionId(null)
  }

  // ── Adjust stock ───────────────────────────────────────────────────────────
  function openAdjustModal() {
    const diffPids = new Set(counts.filter(c => c.counted !== c.system).map(c => c.pid))
    setSelectedAdjust(diffPids)
    setModal('adjust')
  }

  async function applyAdjust() {
    const toAdjust = counts.filter(c => selectedAdjust.has(c.pid))
    if (!toAdjust.length) return
    setIsSaving(true)
    try {
      await Promise.all(toAdjust.map(c =>
        supabase.from('products').update({ stock: c.counted }).eq('id', c.pid)
      ))
      // log to stock_history
      await Promise.all(toAdjust.map(c =>
        supabase.from('stock_history').insert({
          product_id: c.pid, product_name: c.name,
          qty_before: c.system, qty_change: c.counted - c.system, qty_after: c.counted,
          type: 'count_adjust', note: `นับสต็อก${nameInput ? ` — ${nameInput}` : ''}`, created_by: empName || ''
        })
      ))
      // refresh system stock in counts
      setCounts(prev => prev.map(c => selectedAdjust.has(c.pid) ? { ...c, system: c.counted } : c))
      flash(`✓ ปรับสต็อก ${toAdjust.length} รายการแล้ว`)
      setModal(null)
    } catch { flash('ปรับสต็อกไม่ได้', false) }
    finally { setIsSaving(false) }
  }

  // ── Order request ──────────────────────────────────────────────────────────
  function openOrderModal() {
    setSelectedOrder(new Set(counts.filter(c => c.counted < c.system || c.counted <= 5).map(c => c.pid)))
    setOrderNote('')
    setModal('order')
  }

  async function sendOrderRequest() {
    const items = counts.filter(c => selectedOrder.has(c.pid)).map(c => ({
      pid: c.pid, name: c.name, barcode: c.barcode, unit: c.unit,
      counted: c.counted, system: c.system,
    }))
    if (!items.length) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/order-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: items.map(i => i.pid), note: orderNote, requestedBy: empName || '' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'ส่งไม่ได้')
      flash(`✓ ส่ง Telegram ${items.length} รายการแล้ว`)
      setModal(null)
    } catch (e) { flash(e.message || 'ส่งไม่ได้', false) }
    finally { setIsSaving(false) }
  }

  const totalItems = counts.reduce((s, c) => s + c.counted, 0)
  const diffCount  = counts.filter(c => c.counted !== c.system).length
  const diffItems  = counts.filter(c => c.counted !== c.system)

  return (
    <div className="flex flex-col h-full">
      {/* Camera */}
      {cameraOpen && (
        <div className="relative flex-shrink-0 overflow-hidden bg-black" style={{ height: '45vh', minHeight: 220 }}>
          {/* native BarcodeDetector path */}
          <video ref={videoRef} playsInline muted
            className="w-full h-full object-cover"
            style={{ display: hasBD ? 'block' : 'none' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          {/* html5-qrcode fallback */}
          <div id="emp-stock-qr-reader" className="w-full h-full"
            style={{ display: hasBD ? 'none' : 'block' }} />
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center px-4 pt-3 pb-6 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom,rgba(0,0,0,0.6),transparent)' }}>
            <span className="text-white text-sm font-medium">📷 จ่อกล้องที่บาร์โค้ด</span>
          </div>
          <button onClick={closeCamera}
            className="absolute top-3 right-3 z-20 text-white text-xl font-bold w-8 h-8 flex items-center justify-center active:opacity-60"
            style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 20 }}>✕</button>
          {lastMsg && (
            <div className={`absolute bottom-3 left-3 right-3 z-10 py-2.5 px-4 rounded-2xl text-center font-bold text-sm shadow-lg ${lastMsg.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
              {lastMsg.text}
            </div>
          )}
        </div>
      )}

      {/* Top controls */}
      <div className="px-3 pt-3 pb-2 bg-white border-b border-slate-100 flex-shrink-0">
        <div className="flex gap-2 mb-2">
          <input ref={inputRef} type="text" value={scanInput}
            onChange={e => setScanInput(e.target.value)} onKeyDown={handleKey}
            onBlur={() => !cameraOpen && setTimeout(() => inputRef.current?.focus(), 80)}
            placeholder="สแกนหรือพิมพ์บาร์โค้ด…"
            className="flex-1 border-2 border-brand rounded-xl px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <button onClick={cameraOpen ? closeCamera : openCamera}
            className="text-white rounded-xl px-4 text-2xl flex-shrink-0 active:opacity-80 flex items-center justify-center"
            style={{ background: cameraOpen ? '#64748b' : '#C72C41' }}>
            {cameraOpen ? '⏹' : '📷'}
          </button>
        </div>
        {!cameraOpen && lastMsg && (
          <div className={`text-sm font-semibold px-3 py-2 rounded-xl mb-1 ${lastMsg.ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
            {lastMsg.text}
          </div>
        )}
        <div className="relative">
          <input type="text" value={nameSearch} onChange={e => handleNameSearch(e.target.value)}
            onBlur={() => setTimeout(() => setNameSuggs([]), 200)}
            placeholder="🔍 ค้นหาชื่อสินค้า / บาร์โค้ด"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand bg-slate-50"
          />
          {nameSuggs.length > 0 && (
            <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-40 max-h-52 overflow-y-auto">
              {nameSuggs.map(p => (
                <li key={p.id} onMouseDown={() => pickSugg(p)}
                  className="px-3 py-2.5 flex justify-between items-center cursor-pointer border-b border-slate-50 last:border-0 active:bg-brand/5">
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.barcode || '—'}</div>
                  </div>
                  <div className="text-xs text-slate-500 flex-shrink-0">สต็อก {fmt(p.stock)} {p.unit}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2 flex-shrink-0">
        <div className="bg-white rounded-xl p-2.5 text-center shadow-sm">
          <div className="text-xl font-bold text-slate-700">{counts.length}</div>
          <div className="text-[10px] text-slate-500">SKU</div>
        </div>
        <div className="bg-white rounded-xl p-2.5 text-center shadow-sm">
          <div className="text-xl font-bold text-slate-700">{fmt(totalItems)}</div>
          <div className="text-[10px] text-slate-500">ชิ้นทั้งหมด</div>
        </div>
        <div className={`rounded-xl p-2.5 text-center shadow-sm ${diffCount > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className={`text-xl font-bold ${diffCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{diffCount}</div>
          <div className="text-[10px] text-slate-500">ต่างจากระบบ</div>
        </div>
      </div>

      {/* Count list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-1.5">
        {counts.length === 0
          ? <div className="text-center text-slate-400 py-12">
              <div className="text-4xl mb-3">📦</div>
              <p className="text-sm">สแกนบาร์โค้ดหรือค้นหาชื่อสินค้า</p>
            </div>
          : counts.map(c => {
            const diff = c.counted - c.system
            return (
              <div key={c.pid} className="bg-white rounded-xl p-3 shadow-sm flex items-center gap-2.5">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-700 text-sm leading-tight">{c.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">ระบบ: {fmt(c.system)} {c.unit}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => adjustCount(c.pid, -1)}
                    className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-bold text-base flex items-center justify-center active:scale-95">−</button>
                  <span className="text-lg font-bold text-slate-700 w-9 text-center">{c.counted}</span>
                  <button onClick={() => adjustCount(c.pid, 1)}
                    className="w-7 h-7 rounded-full font-bold text-base flex items-center justify-center active:scale-95"
                    style={{ background: 'rgba(199,44,65,0.1)', color: '#C72C41' }}>+</button>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`text-sm font-bold w-8 text-right ${diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                  </span>
                  <button onClick={() => removeItem(c.pid)} className="text-[10px] text-slate-300 active:text-red-400">ลบ</button>
                </div>
              </div>
            )
          })
        }
      </div>

      {/* Action bar */}
      {counts.length > 0 && (
        <div className="flex-shrink-0 grid grid-cols-4 gap-1.5 px-3 py-2 bg-white border-t border-slate-100">
          <button onClick={openSaveModal}
            className="flex flex-col items-center gap-0.5 py-2 rounded-xl text-center active:scale-95 transition-all"
            style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
            <span className="text-lg">💾</span>
            <span className="text-[10px] font-semibold">บันทึก</span>
          </button>
          <button onClick={openHistoryModal}
            className="flex flex-col items-center gap-0.5 py-2 rounded-xl text-center active:scale-95 transition-all"
            style={{ background: 'rgba(100,116,139,0.08)', color: '#475569' }}>
            <span className="text-lg">📋</span>
            <span className="text-[10px] font-semibold">ประวัติ</span>
          </button>
          <button onClick={openAdjustModal} disabled={diffCount === 0}
            className="flex flex-col items-center gap-0.5 py-2 rounded-xl text-center active:scale-95 transition-all disabled:opacity-40"
            style={{ background: diffCount > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.06)', color: diffCount > 0 ? '#059669' : '#94a3b8' }}>
            <span className="text-lg">📊</span>
            <span className="text-[10px] font-semibold">ปรับสต็อก</span>
          </button>
          <button onClick={openOrderModal}
            className="flex flex-col items-center gap-0.5 py-2 rounded-xl text-center active:scale-95 transition-all"
            style={{ background: 'rgba(199,44,65,0.08)', color: '#C72C41' }}>
            <span className="text-lg">🛒</span>
            <span className="text-[10px] font-semibold">สั่งซื้อ</span>
          </button>
        </div>
      )}

      {/* ── Modal: Save ── */}
      {modal === 'save' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-700 text-base mb-3">💾 บันทึกรายการนับ</p>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)}
              placeholder="ชื่อรายการ เช่น นับสต็อกเดือนกรกฎา"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand mb-3" />
            <div className="flex gap-2">
              <button onClick={() => setModal(null)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-slate-500 bg-slate-100">ยกเลิก</button>
              <button onClick={() => saveSession('draft')} disabled={isSaving || !nameInput.trim()}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-violet-700 disabled:opacity-50"
                style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)' }}>
                {isSaving ? '...' : 'บันทึกร่าง'}
              </button>
              <button onClick={() => saveSession('completed')} disabled={isSaving || !nameInput.trim()}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#a78bfa)' }}>
                {isSaving ? '...' : 'บันทึกสำเร็จ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: History ── */}
      {modal === 'history' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="font-bold text-slate-700">📋 ประวัติการนับ</p>
              <button onClick={() => setModal(null)} className="text-slate-400 text-xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-2">
              {sessions.length === 0
                ? <p className="text-center text-slate-400 py-8 text-sm">ยังไม่มีประวัติ</p>
                : sessions.map(s => (
                  <div key={s.id} onClick={() => loadSessionData(s)}
                    className="bg-slate-50 rounded-xl p-3.5 flex items-center gap-3 cursor-pointer active:bg-brand/5 border border-slate-100">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 text-sm truncate">{s.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {new Date(s.updated_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {s.counted_by ? ` • ${s.counted_by}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {s.status === 'completed' ? 'สำเร็จ' : 'ร่าง'}
                      </span>
                      <span className="text-[11px] text-slate-400">{(s.items || []).length} SKU</span>
                      <button onClick={e => deleteSession(s.id, e)} className="text-slate-300 text-base active:text-red-400 px-1">🗑</button>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Adjust Stock ── */}
      {modal === 'adjust' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-700">📊 ปรับสต็อกตามที่นับ</p>
                <p className="text-xs text-slate-400 mt-0.5">ตั้งค่าสต็อกในระบบให้ตรงกับจำนวนที่นับได้</p>
              </div>
              <button onClick={() => setModal(null)} className="text-slate-400 text-xl">✕</button>
            </div>
            <div className="px-4 py-2 border-b border-slate-50 flex items-center gap-3">
              <button onClick={() => setSelectedAdjust(new Set(diffItems.map(c => c.pid)))}
                className="text-xs text-brand font-semibold">เลือกทั้งหมด</button>
              <button onClick={() => setSelectedAdjust(new Set())}
                className="text-xs text-slate-400">ยกเลิกทั้งหมด</button>
              <span className="ml-auto text-xs text-slate-400">เลือก {selectedAdjust.size}/{diffItems.length}</span>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
              {diffItems.length === 0
                ? <p className="text-center text-slate-400 py-8 text-sm">ไม่มีรายการที่ต่างจากระบบ</p>
                : diffItems.map(c => {
                  const diff = c.counted - c.system
                  const checked = selectedAdjust.has(c.pid)
                  return (
                    <div key={c.pid} onClick={() => setSelectedAdjust(prev => { const n = new Set(prev); checked ? n.delete(c.pid) : n.add(c.pid); return n })}
                      className={`rounded-xl p-3 flex items-center gap-3 cursor-pointer border transition-all ${checked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-slate-50'}`}>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${checked ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'}`}>
                        {checked && <span className="text-white text-[10px] font-bold">✓</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-700 text-sm truncate">{c.name}</p>
                        <p className="text-[11px] text-slate-400">ระบบ: {fmt(c.system)} → นับได้: {fmt(c.counted)} {c.unit}</p>
                      </div>
                      <span className={`text-sm font-bold flex-shrink-0 ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    </div>
                  )
                })
              }
            </div>
            <div className="p-4 border-t border-slate-100">
              <button onClick={applyAdjust} disabled={isSaving || selectedAdjust.size === 0}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-40 active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#059669,#34d399)' }}>
                {isSaving ? 'กำลังปรับ...' : `✓ ปรับสต็อก ${selectedAdjust.size} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Order Request ── */}
      {modal === 'order' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-700">🛒 ส่งรายการสั่งซื้อ</p>
                <p className="text-xs text-slate-400 mt-0.5">เลือกสินค้าที่ต้องสั่งเพิ่ม ส่งให้แอดมิน</p>
              </div>
              <button onClick={() => setModal(null)} className="text-slate-400 text-xl">✕</button>
            </div>
            <div className="px-4 py-2 border-b border-slate-50 flex items-center gap-3">
              <button onClick={() => setSelectedOrder(new Set(counts.map(c => c.pid)))}
                className="text-xs text-brand font-semibold">เลือกทั้งหมด</button>
              <button onClick={() => setSelectedOrder(new Set(counts.filter(c => c.counted < c.system || c.counted <= 5).map(c => c.pid)))}
                className="text-xs text-amber-600 font-semibold">เฉพาะน้อย</button>
              <button onClick={() => setSelectedOrder(new Set())}
                className="text-xs text-slate-400">ยกเลิก</button>
              <span className="ml-auto text-xs text-slate-400">เลือก {selectedOrder.size}</span>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
              {counts.map(c => {
                const checked = selectedOrder.has(c.pid)
                const low = c.counted < c.system || c.counted <= 5
                return (
                  <div key={c.pid} onClick={() => setSelectedOrder(prev => { const n = new Set(prev); checked ? n.delete(c.pid) : n.add(c.pid); return n })}
                    className={`rounded-xl p-3 flex items-center gap-3 cursor-pointer border transition-all ${checked ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50'}`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${checked ? 'border-brand bg-brand' : 'border-slate-300'}`}>
                      {checked && <span className="text-white text-[10px] font-bold">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 text-sm truncate">{c.name}</p>
                      <p className="text-[11px] text-slate-400">นับได้ {fmt(c.counted)} {c.unit}</p>
                    </div>
                    {low && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">น้อย</span>}
                  </div>
                )
              })}
            </div>
            <div className="p-4 border-t border-slate-100 space-y-2">
              <textarea value={orderNote} onChange={e => setOrderNote(e.target.value)}
                placeholder="หมายเหตุสำหรับแอดมิน (ไม่บังคับ)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-brand"
                rows={2} />
              <button onClick={sendOrderRequest} disabled={isSaving || selectedOrder.size === 0}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-40 active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#C72C41,#e25470)' }}>
                {isSaving ? 'กำลังส่ง...' : `📤 ส่งรายการ ${selectedOrder.size} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── IFRAME TAB (expenses / repair) ───────────────────────────────────────────
function IFrameTab({ src, title }) {
  return (
    <iframe
      src={src}
      className="w-full h-full border-0"
      title={title}
      allow="camera"
    />
  )
}

// ─── MAIN PORTAL ───────────────────────────────────────────────────────────────
export default function EmpPortalPage() {
  const [session, setSession]   = useState(null)  // { id, name, position }
  const [phase, setPhase]       = useState('loading')
  const [activeTab, setActiveTab] = useState('products')
  const [printerCfg, setPrinterCfg] = useState(null)

  // Restore session from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('emp_portal_session')
      if (saved) { setSession(JSON.parse(saved)); setPhase('portal') }
      else setPhase('pin')
    } catch { setPhase('pin') }
  }, [])

  // Load shared printer config from Supabase once logged in
  useEffect(() => {
    if (phase !== 'portal') return
    supabase.from('settings').select('value').eq('key', 'printer_barcode').single()
      .then(({ data }) => {
        if (data?.value) { try { setPrinterCfg(JSON.parse(data.value)) } catch {} }
      })
  }, [phase])

  function handleLoginSuccess(emp) {
    const sess = { id: emp.id, name: emp.name, position: emp.position }
    setSession(sess)
    try {
      sessionStorage.setItem('emp_portal_session', JSON.stringify(sess))
      // ตั้ง emp_session ใน localStorage ด้วย เพื่อให้หน้าอื่น (expenses ฯลฯ) รู้จักพนักงาน
      localStorage.setItem('emp_session', JSON.stringify(sess))
      document.cookie = 'pos_emp=1;path=/;max-age=86400'
    } catch {}
    setPhase('portal')
  }

  function handleLogout() {
    try {
      sessionStorage.removeItem('emp_portal_session')
      localStorage.removeItem('emp_session')
      document.cookie = 'pos_emp=;path=/;max-age=0'
    } catch {}
    setSession(null)
    setPhase('pin')
  }

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(160deg,#14060a 0%,#2D142C 100%)' }}>
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (phase === 'pin') {
    return <PinPad onSuccess={handleLoginSuccess} />
  }

  const TABS = [
    { id: 'products', label: 'สินค้า',    icon: '🛒' },
    { id: 'stock',    label: 'นับสต็อก',  icon: '📦' },
    { id: 'repair',   label: 'คิวซ่อม',   icon: '🔧' },
    { id: 'expenses', label: 'ค่าใช้จ่าย', icon: '💸' },
  ]

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
            style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
            {session?.name?.[0]}
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">{session?.name}</p>
            <p className="text-white/40 text-[10px]">{session?.position || 'พนักงาน'}</p>
          </div>
        </div>
        <button onClick={handleLogout}
          className="text-white/40 text-xs px-3 py-1.5 rounded-lg active:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)' }}>
          ออกจากระบบ
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'products' && <ProductsTab printerCfg={printerCfg} empName={session?.name} />}
        {activeTab === 'stock'    && <StockCountTab empName={session?.name} />}
        {activeTab === 'repair'   && <IFrameTab src="/repair?embed=1"   title="คิวซ่อม" />}
        {activeTab === 'expenses' && <IFrameTab src="/expenses?embed=1" title="ค่าใช้จ่าย" />}
      </div>

      {/* Bottom tab bar */}
      <div className="flex-shrink-0 flex border-t border-slate-200 bg-white relative"
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-all relative ${
              activeTab === t.id ? 'text-brand' : 'text-slate-400'
            }`}>
            <span className="text-xl leading-none">{t.icon}</span>
            <span className={`text-[10px] font-semibold ${activeTab === t.id ? 'text-brand' : 'text-slate-400'}`}>
              {t.label}
            </span>
            {activeTab === t.id && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-12 rounded-full" style={{ background: '#C72C41' }} />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
