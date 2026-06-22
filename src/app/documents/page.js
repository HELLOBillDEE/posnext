'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDT, todayISO, PAY_LABEL } from '@/lib/utils'

const TABS = ['ใบเสร็จขาย', 'ใบสั่งซื้อ (PO)', 'ลูกหนี้ AR', 'เจ้าหนี้ AP']

export default function DocumentsPage() {
  const [tab, setTab]         = useState(0)
  const [sales, setSales]     = useState([])
  const [pos, setPOs]         = useState([])
  const [settings, setSettings] = useState({})
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo]   = useState(todayISO())
  const [search, setSearch]   = useState('')
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => { loadData() }, [tab, dateFrom, dateTo])

  async function loadData() {
    setLoading(true)
    const { data: cfg } = await supabase.from('settings').select('*')
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))
    const from = dateFrom + 'T00:00:00'
    const to   = dateTo   + 'T23:59:59'
    if (tab === 0) {
      const { data } = await supabase.from('sales')
        .select('*, customers(name)')
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false })
      setSales(data || [])
    }
    if (tab === 1) {
      const { data } = await supabase.from('purchase_orders')
        .select('*, suppliers(name)')
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false })
      setPOs(data || [])
    }
    setLoading(false)
  }

  async function openSaleDetail(sale) {
    const { data } = await supabase.from('sales')
      .select('*, customers(*), sale_items(*)')
      .eq('id', sale.id).single()
    setDetail({ type: 'sale', data })
  }

  async function openPODetail(po) {
    const { data } = await supabase.from('purchase_orders')
      .select('*, suppliers(*), po_items(*)')
      .eq('id', po.id).single()
    setDetail({ type: 'po', data })
  }

  async function voidSale(id) {
    if (!confirm('ยกเลิกบิลนี้? สต็อกจะถูกคืนอัตโนมัติ')) return
    try {
      const items = detail?.data?.sale_items
        ?? (await supabase.from('sale_items').select('*').eq('sale_id', id)).data ?? []
      const { error } = await supabase.from('sales').update({ status: 'voided' }).eq('id', id)
      if (error) throw error
      for (const item of items) {
        if (!item.product_id) continue
        await supabase.rpc('increment_stock', { p_id: item.product_id, qty: Number(item.qty) })
      }
      setDetail(null)
      loadData()
      alert('ยกเลิกบิลและคืนสต็อกเรียบร้อย')
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    }
  }

  function printDetail() {
    if (!detail) return
    const html = detail.type === 'sale'
      ? buildFullReceiptHTML(detail.data, settings)
      : buildFullPOHTML(detail.data, settings)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const win  = window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    if (!win) alert('กรุณาอนุญาต Popup ใน Safari Settings')
  }

  const filteredSales = sales.filter(s => !search || s.receipt_no.includes(search) || s.customers?.name?.includes(search))
  const filteredPOs   = pos.filter(p => !search || p.po_no.includes(search) || p.suppliers?.name?.includes(search))

  return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <h1 className="font-heading font-bold text-xl text-brand mb-4">🧾 เอกสาร</h1>

      <div className="flex gap-1 mb-4 overflow-x-auto scroll-hidden">
        {TABS.map((t, i) => (
          <button key={i} onClick={() => { setTab(i); setDetail(null) }}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium border transition-colors
              ${tab === i ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200'}`}>{t}</button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาเลขที่ / ชื่อ"
          className="flex-1 min-w-[140px] border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-brand outline-none" />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-brand outline-none" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-brand outline-none" />
        <button onClick={() => { setDateFrom(todayISO()); setDateTo(todayISO()) }}
          className="text-xs text-brand underline px-2">วันนี้</button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {loading && <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>}

          {tab === 0 && !loading && (
            <div className="divide-y divide-gray-50">
              {filteredSales.map(s => (
                <div key={s.id} onClick={() => openSaleDetail(s)}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-sm text-gray-800">{s.receipt_no}</p>
                    <p className="text-xs text-gray-400">{fmtDT(s.created_at)} · {PAY_LABEL[s.payment_method]||s.payment_method}</p>
                    {s.status === 'voided' && <span className="text-[9px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">ยกเลิก</span>}
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold text-sm ${s.status==='voided' ? 'line-through text-gray-400' : 'text-brand'}`}>฿{fmt(s.total)}</p>
                    <p className="text-[10px] text-gray-400">→</p>
                  </div>
                </div>
              ))}
              {filteredSales.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">ไม่มีรายการ</div>}
            </div>
          )}

          {tab === 1 && !loading && (
            <div className="divide-y divide-gray-50">
              {filteredPOs.map(p => (
                <div key={p.id} onClick={() => openPODetail(p)}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-sm text-gray-800">{p.po_no}</p>
                    <p className="text-xs text-gray-400">{p.suppliers?.name || '—'} · {fmtDT(p.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-brand">฿{fmt(p.total)}</p>
                  </div>
                </div>
              ))}
              {filteredPOs.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">ไม่มีรายการ</div>}
            </div>
          )}

          {(tab === 2 || tab === 3) && (
            <div className="text-center py-12 text-gray-400 text-sm">
              <p className="text-3xl mb-2">{tab === 2 ? '📥' : '📤'}</p>
              <p>{tab === 2 ? 'ลูกหนี้ (AR)' : 'เจ้าหนี้ (AP)'}</p>
              <p className="text-xs mt-1">เปิดจากบิลขายที่มีการจ่ายแบบ "เชื่อ"</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {!detail && <div className="flex items-center justify-center h-full min-h-48 text-gray-300 text-sm">← กดเลือกรายการ</div>}
          {detail?.type === 'sale' && (
            <SaleDetail
              d={detail.data}
              onVoid={() => voidSale(detail.data.id)}
              onPrint={printDetail}
              onEdit={() => setShowEdit(true)}
            />
          )}
          {detail?.type === 'po' && <PODetail d={detail.data} onPrint={printDetail} />}
        </div>
      </div>

      {/* Edit Bill Modal */}
      {showEdit && detail?.type === 'sale' && (
        <EditBillModal
          sale={detail.data}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false)
            await openSaleDetail({ id: detail.data.id })
            loadData()
          }}
        />
      )}
    </div>
  )
}

function SaleDetail({ d, onVoid, onPrint, onEdit }) {
  return (
    <div>
      <div className="bg-brand text-white px-4 py-3 flex justify-between items-center flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-sm">{d.receipt_no}</h2>
          <p className="text-[10px] opacity-70">{fmtDT(d.created_at)}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {d.status !== 'voided' && (
            <button onClick={onEdit} className="bg-amber-400 text-white px-3 py-1.5 rounded-lg text-xs font-medium">✏️ แก้ไข</button>
          )}
          <button onClick={onPrint} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-medium">📄 A4</button>
          {d.status !== 'voided' && <button onClick={onVoid} className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs">ยกเลิก</button>}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {d.customers?.name && (
          <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2 mb-1">
            <span>👤</span>
            <span className="text-sm font-medium text-blue-700">{d.customers.name}</span>
            {d.customers.phone && <span className="text-xs text-blue-500">{d.customers.phone}</span>}
          </div>
        )}
        {(d.sale_items || []).map(i => (
          <div key={i.id} className="flex justify-between text-sm">
            <span className="flex-1 text-gray-700">{i.product_name} × {i.qty}</span>
            <span className="text-gray-600">฿{fmt(i.subtotal)}</span>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-2 space-y-1">
          <Row label="รวม" val={`฿${fmt(d.subtotal)}`} />
          {d.discount > 0 && <Row label="ส่วนลด" val={`-฿${fmt(d.discount)}`} cls="text-red-500" />}
          {d.vat > 0 && <Row label="VAT" val={`฿${fmt(d.vat)}`} cls="text-gray-400" />}
          <Row label="สุทธิ" val={`฿${fmt(d.total)}`} bold />
          <Row label="วิธีชำระ" val={PAY_LABEL[d.payment_method]||d.payment_method} />
          {d.change_amount > 0 && <Row label="เงินทอน" val={`฿${fmt(d.change_amount)}`} />}
        </div>
        {d.note && <p className="text-xs text-gray-400 italic">หมายเหตุ: {d.note}</p>}
      </div>
    </div>
  )
}

function PODetail({ d, onPrint }) {
  return (
    <div>
      <div className="bg-blue-700 text-white px-4 py-3 flex justify-between items-center">
        <div>
          <h2 className="font-bold text-sm">{d.po_no}</h2>
          <p className="text-[10px] opacity-70">{d.suppliers?.name || '—'}</p>
        </div>
        <button onClick={onPrint} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs">📄 A4 / AirPrint</button>
      </div>
      <div className="p-4 space-y-2">
        {(d.po_items || []).map(i => (
          <div key={i.id} className="flex justify-between text-sm">
            <span className="flex-1 text-gray-700">{i.product_name} × {i.qty}</span>
            <span className="text-gray-600">฿{fmt(i.subtotal)}</span>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-2">
          <Row label="รวมทั้งหมด" val={`฿${fmt(d.total)}`} bold />
        </div>
      </div>
    </div>
  )
}

function Row({ label, val, bold, cls='' }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold text-brand text-base' : 'text-gray-600'} ${cls}`}>
      <span>{label}</span><span>{val}</span>
    </div>
  )
}

/* ── Edit Bill Modal ── */
function EditBillModal({ sale, onClose, onSaved }) {
  const [items, setItems]       = useState([])
  const [discount, setDiscount] = useState(String(sale.discount || 0))
  const [note, setNote]         = useState(sale.note || '')
  const [prodSearch, setProdSearch] = useState('')
  const [prodResults, setProdResults] = useState([])
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    setItems((sale.sale_items || []).map(i => ({
      id: i.id, pid: i.product_id, name: i.product_name, qty: i.qty,
      price: i.price, disc: i.discount || 0, unit: i.unit,
    })))
  }, [sale])

  useEffect(() => {
    if (!prodSearch.trim()) { setProdResults([]); return }
    supabase.from('products').select('id,name,price,unit,barcode')
      .ilike('name', '%'+prodSearch+'%').eq('active', true).limit(8)
      .then(({ data }) => setProdResults(data || []))
  }, [prodSearch])

  function addProduct(p) {
    setItems(prev => {
      const idx = prev.findIndex(i => i.pid === p.id)
      if (idx >= 0) {
        const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n
      }
      return [...prev, { id: null, pid: p.id, name: p.name, qty: 1, price: p.price, disc: 0, unit: p.unit }]
    })
    setProdSearch(''); setProdResults([])
  }

  function setQty(idx, qty) {
    const q = parseFloat(qty)
    if (isNaN(q) || q <= 0) { setItems(p => p.filter((_,i) => i !== idx)); return }
    setItems(p => { const n=[...p]; n[idx]={...n[idx],qty:q}; return n })
  }

  function setPrice(idx, price) {
    const v = parseFloat(price); if (isNaN(v)) return
    setItems(p => { const n=[...p]; n[idx]={...n[idx],price:v}; return n })
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty - (i.disc||0), 0)
  const discAmt  = parseFloat(discount) || 0
  const total    = Math.max(0, subtotal - discAmt)

  async function save() {
    if (items.length === 0) return alert('ต้องมีสินค้าอย่างน้อย 1 รายการ')
    setSaving(true)
    try {
      // Delete all old sale_items
      await supabase.from('sale_items').delete().eq('sale_id', sale.id)

      // Re-insert items
      await supabase.from('sale_items').insert(
        items.map(i => ({
          sale_id: sale.id, product_id: i.pid, product_name: i.name,
          unit: i.unit, qty: i.qty, price: i.price, discount: i.disc || 0,
          subtotal: i.price * i.qty - (i.disc || 0),
        }))
      )

      // Update sale totals
      await supabase.from('sales').update({
        subtotal, discount: discAmt, total,
        note: note.trim() || null,
      }).eq('id', sale.id)

      onSaved()
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden fade-in flex flex-col max-h-[90vh]">
        <div className="bg-amber-500 text-white px-4 py-3.5 flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-base">✏️ แก้ไขบิล</h2>
            <p className="text-[11px] opacity-80">{sale.receipt_no}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Add product search */}
          <div className="relative">
            <input value={prodSearch} onChange={e => setProdSearch(e.target.value)}
              placeholder="🔍 ค้นหาสินค้าเพื่อเพิ่ม..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-amber-400 outline-none" />
            {prodResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto mt-1">
                {prodResults.map(p => (
                  <button key={p.id} onClick={() => addProduct(p)}
                    className="w-full px-3 py-2.5 text-left hover:bg-amber-50 flex justify-between text-sm border-b border-gray-50 last:border-0">
                    <span className="font-medium text-slate-700">{p.name}</span>
                    <span className="text-brand font-semibold">฿{fmt(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="border border-gray-100 rounded-2xl p-3 bg-gray-50/50">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-semibold text-slate-800 flex-1 pr-2">{item.name}</p>
                  <button onClick={() => setItems(p => p.filter((_,i) => i !== idx))}
                    className="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-400 text-sm">✕</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(idx, item.qty - 1)}
                      className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center font-bold text-base leading-none">−</button>
                    <input type="number" value={item.qty} onChange={e => setQty(idx, e.target.value)}
                      className="w-12 text-center border border-gray-200 rounded-lg py-1 text-sm font-bold focus:border-amber-400 outline-none" />
                    <button onClick={() => setQty(idx, item.qty + 1)}
                      className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-white font-bold text-base leading-none">+</button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">ราคา</span>
                    <input type="number" value={item.price} onChange={e => setPrice(idx, e.target.value)}
                      className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm font-semibold text-brand focus:border-amber-400 outline-none" />
                  </div>
                  <span className="text-sm font-bold text-brand ml-auto">฿{fmt(item.price * item.qty - (item.disc||0))}</span>
                </div>
              </div>
            ))}
            {items.length === 0 && <p className="text-center text-slate-400 text-sm py-4">ยังไม่มีสินค้า</p>}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500 whitespace-nowrap">ส่วนลดบิล</span>
              <input type="number" value={discount} onChange={e => setDiscount(e.target.value)}
                placeholder="0"
                className="flex-1 text-right border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 outline-none" />
              <span className="text-xs text-slate-400">บาท</span>
            </div>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="หมายเหตุ"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 outline-none" />
            <div className="bg-amber-50 rounded-2xl p-3 flex justify-between items-baseline border border-amber-100">
              <span className="font-bold text-slate-700">ยอดสุทธิใหม่</span>
              <span className="font-heading font-bold text-2xl text-amber-600">฿{fmt(total)}</span>
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 pt-2 shrink-0">
          <button onClick={save} disabled={saving || items.length === 0}
            className="w-full bg-amber-500 text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-50 active:scale-[0.98] transition-transform">
            {saving ? '⏳ กำลังบันทึก...' : '✓ บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildFullReceiptHTML(d, s) {
  const rows = (d.sale_items || []).map(i => `
    <tr><td>${i.product_name}</td><td style="text-align:center">${i.qty}</td><td style="text-align:right">฿${fmt(i.price)}</td><td style="text-align:right">฿${fmt(i.subtotal)}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
  @page { size: A4; margin: 15mm; }
  body{font-family:'Sarabun',sans-serif;font-size:13px;max-width:21cm;margin:auto}
  h2{font-size:20px;text-align:center;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin:10px 0}
  th{background:#1a4731;color:white;padding:7px}td{padding:5px 8px;border-bottom:1px solid #eee}
  .total{font-weight:bold;font-size:15px}.right{text-align:right}
  .cust{background:#f0f7ff;border:1px solid #cce0ff;border-radius:8px;padding:8px 12px;margin:8px 0}
  </style></head><body>
  <h2>${s.shop_name || 'ร้านค้า'}</h2>
  <p style="text-align:center;color:#555">${s.shop_address || ''} ${s.shop_phone ? '| โทร: '+s.shop_phone : ''}</p>
  <hr>
  <table><tr><td><b>เลขที่บิล:</b> ${d.receipt_no}</td><td class="right"><b>วันที่:</b> ${fmtDT(d.created_at)}</td></tr></table>
  ${d.customers?.name ? `<div class="cust">👤 <b>ลูกค้า:</b> ${d.customers.name}${d.customers.phone ? ' &nbsp;&nbsp;📞 '+d.customers.phone : ''}</div>` : ''}
  <table><thead><tr><th>สินค้า</th><th>จำนวน</th><th>ราคา</th><th>รวม</th></tr></thead><tbody>${rows}</tbody></table>
  <table style="width:50%;margin-left:auto">
    <tr><td>รวม</td><td class="right">฿${fmt(d.subtotal)}</td></tr>
    ${d.discount>0?`<tr><td>ส่วนลด</td><td class="right">-฿${fmt(d.discount)}</td></tr>`:''}
    ${d.vat>0?`<tr><td>VAT</td><td class="right">฿${fmt(d.vat)}</td></tr>`:''}
    <tr class="total"><td>สุทธิ</td><td class="right">฿${fmt(d.total)}</td></tr>
  </table>
  <script>window.onload=()=>window.print()</script></body></html>`
}

function buildFullPOHTML(d, s) {
  const rows = (d.po_items || []).map(i => `
    <tr><td>${i.product_name}</td><td style="text-align:center">${i.qty} ${i.unit||''}</td><td style="text-align:right">฿${fmt(i.cost)}</td><td style="text-align:right">฿${fmt(i.subtotal)}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
  @page { size: A4; margin: 15mm; }
  body{font-family:'Sarabun',sans-serif;font-size:13px;max-width:21cm;margin:auto}
  h2{font-size:20px}table{width:100%;border-collapse:collapse;margin:10px 0}
  th{background:#1e4a8a;color:white;padding:7px}td{padding:5px 8px;border-bottom:1px solid #eee}
  .total{font-weight:bold;font-size:15px}.right{text-align:right}
  </style></head><body>
  <h2>ใบสั่งซื้อ (Purchase Order)</h2>
  <p>${s.shop_name || ''} ${s.shop_address ? '| '+s.shop_address : ''}</p>
  <hr>
  <table><tr><td><b>เลขที่ PO:</b> ${d.po_no}</td><td class="right"><b>วันที่:</b> ${fmtDT(d.created_at)}</td></tr>
  <tr><td><b>ซัพพลายเออร์:</b> ${d.suppliers?.name||'—'}</td><td class="right"><b>สถานะ:</b> ${d.status}</td></tr></table>
  <table><thead><tr><th>สินค้า</th><th>จำนวน</th><th>ราคาทุน</th><th>รวม</th></tr></thead><tbody>${rows}</tbody></table>
  <table style="width:50%;margin-left:auto">
    <tr class="total"><td>รวมทั้งหมด</td><td class="right">฿${fmt(d.total)}</td></tr>
  </table>
  <div style="margin-top:30mm;display:flex;justify-content:space-between;text-align:center">
    <div><hr style="width:120px"><p>ผู้สั่งซื้อ</p></div>
    <div><hr style="width:120px"><p>ผู้อนุมัติ</p></div>
    <div><hr style="width:120px"><p>ผู้รับสินค้า</p></div>
  </div>
  <script>window.onload=()=>window.print()</script></body></html>`
}
