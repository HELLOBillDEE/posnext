'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import JsBarcode from 'jsbarcode'

const LABEL_SIZES = [
  { id: 'a4-2x4', label: 'A4 — 2×4 (8 ป้าย)', cols: 2, rows: 4 },
  { id: 'a4-3x5', label: 'A4 — 3×5 (15 ป้าย)', cols: 3, rows: 5 },
  { id: 'a4-2x2', label: 'A4 — 2×2 ใหญ่ (4 ป้าย)', cols: 2, rows: 2 },
]

export default function PriceLabelsPage() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [selected, setSelected] = useState({}) // { id: product }
  const [selectOrder, setSelectOrder] = useState([]) // ids in selection order
  const [size, setSize] = useState('a4-2x4')
  const [loading, setLoading] = useState(false)
  const printRef = useRef(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [, { data: cats }] = await Promise.all([
      Promise.resolve(),
      supabase.from('categories').select('id,name').order('name'),
    ])
    // fetch all products by paging (Supabase cap = 1000/page)
    let all = [], from = 0
    while (true) {
      const { data } = await supabase.from('products')
        .select('id,name,barcode,price,category_id,unit')
        .eq('active', true).order('name').range(from, from + 999)
      if (!data || data.length === 0) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setProducts(all)
    setCategories(cats || [])
    setLoading(false)
  }

  const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  const filtered = products.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)
    const matchCat = !filterCat || String(p.category_id) === filterCat
    return matchSearch && matchCat
  })

  const toggle = (p) => {
    setSelected(prev => {
      const next = { ...prev }
      if (next[p.id]) { delete next[p.id] } else { next[p.id] = { ...p, copies: 1 } }
      return next
    })
    setSelectOrder(prev =>
      prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
    )
  }

  const setCopies = (id, val) => {
    const n = Math.max(1, parseInt(val) || 1)
    setSelected(prev => ({ ...prev, [id]: { ...prev[id], copies: n } }))
  }

  const selectedList = selectOrder.map(id => selected[id]).filter(Boolean)
  const labelItems = selectedList.flatMap(p => Array(p.copies).fill(p))

  const cfg = LABEL_SIZES.find(s => s.id === size)

  function print() {
    window.print()
  }

  function selectAll() {
    const next = {}
    const order = []
    filtered.forEach(p => { next[p.id] = { ...p, copies: 1 }; order.push(p.id) })
    setSelected(next)
    setSelectOrder(order)
  }

  function clearAll() { setSelected({}); setSelectOrder([]) }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area { position: fixed; inset: 0; }
          @page { size: A4; margin: 8mm; }
        }
      `}</style>

      {/* Header — hidden on print */}
      <div className="print:hidden max-w-4xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-heading font-bold text-xl text-brand">🏷️ พิมพ์ป้ายราคา</h1>
          <div className="flex gap-2">
            <select value={size} onChange={e => setSize(e.target.value)}
              className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white">
              {LABEL_SIZES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button onClick={print} disabled={labelItems.length === 0}
              className="bg-brand text-white px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40">
              🖨️ พิมพ์ ({labelItems.length} ป้าย)
            </button>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex gap-2 mb-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาสินค้า หรือบาร์โค้ด..."
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white" />
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">ทุกหมวด</option>
            {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={selectAll} className="text-xs text-brand underline">เลือกทั้งหมด ({filtered.length})</button>
          <button onClick={clearAll} className="text-xs text-slate-400 underline">ล้าง</button>
          {selectedList.length > 0 && (
            <span className="text-xs text-slate-500 ml-auto">เลือกแล้ว {selectedList.length} รายการ → {labelItems.length} ป้าย</span>
          )}
        </div>

        {/* Product list */}
        {loading ? (
          <div className="text-center py-12 text-slate-400 text-sm">กำลังโหลด...</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            {filtered.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">ไม่พบสินค้า</div>
            )}
            {filtered.map(p => {
              const sel = selected[p.id]
              return (
                <div key={p.id} onClick={() => toggle(p)}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-slate-50 cursor-pointer transition-colors ${sel ? 'bg-brand/5' : 'hover:bg-slate-50'}`}>
                  <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${sel ? 'bg-brand border-brand' : 'border-slate-300'}`}>
                    {sel && <span className="text-white text-xs font-bold">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.barcode || 'ไม่มีบาร์โค้ด'} · {p.unit}</p>
                  </div>
                  <p className="text-sm font-bold text-brand flex-shrink-0">฿{fmt(p.price)}</p>
                  {sel && (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-slate-400">จำนวน</span>
                      <input type="number" min="1" max="99" value={sel.copies}
                        onChange={e => setCopies(p.id, e.target.value)}
                        className="w-14 text-center text-sm border border-slate-200 rounded-lg py-1" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Print area */}
      <div id="print-area" ref={printRef} style={{
        display: labelItems.length > 0 ? 'block' : 'none',
      }}>
        <PrintGrid items={labelItems} cols={cfg.cols} rows={cfg.rows} />
      </div>
    </div>
  )
}

function BarcodeImg({ value, cols }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        width: cols <= 2 ? 1.2 : 0.85,
        height: cols === 2 ? 50 : cols === 3 ? 38 : 65,
        displayValue: true,
        fontSize: cols === 3 ? 9 : 11,
        margin: 0,
      })
    } catch {}
  }, [value, cols])
  if (!value) return <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>ไม่มีบาร์โค้ด</div>
  return <svg ref={ref} style={{ width: '100%', maxHeight: 70 }} />
}

function PrintGrid({ items, cols, rows }) {
  const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const labelW = cols === 2 ? '50%' : cols === 3 ? '33.33%' : '50%'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', width: '100%' }}>
      {items.map((p, i) => (
        <div key={i} style={{
          width: labelW, boxSizing: 'border-box', padding: '4mm',
          pageBreakInside: 'avoid', breakInside: 'avoid',
        }}>
          <div style={{
            border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden',
            background: '#fff', display: 'flex', flexDirection: 'column',
          }}>
            {/* ช่องรูปสินค้า */}
            <div style={{
              width: '100%', aspectRatio: cols === 3 ? '5/2' : '4/3',
              background: '#fff', borderBottom: '1.5px dashed #94a3b8',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3,
            }}>
              <span style={{ fontSize: 18, opacity: .15 }}>📷</span>
              <span style={{ fontSize: 7, color: '#94a3b8', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>ติดรูปสินค้าที่นี่</span>
            </div>
            <div style={{ padding: '5px 8px 5px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: cols === 3 ? 11 : 13, color: '#1E293B', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.3 }}>
                {p.name}
              </div>
              <BarcodeImg value={p.barcode} cols={cols} />
              <div style={{ fontSize: cols === 2 ? 24 : 18, fontWeight: 800, color: '#C72C41', textAlign: 'center', lineHeight: 1.1 }}>
                ฿{fmt(p.price)}
              </div>
              <div style={{ fontSize: 9, color: '#94a3b8', textAlign: 'center' }}>/{p.unit}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
