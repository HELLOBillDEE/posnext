'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { fmt } from '@/lib/utils'

// pw=page width, ph=row height, cols=columns per row, m=outer margin (mm)
// pw = total paper width, lw = each label width, hGap = gap between columns, vGap = gap between rows
const LABEL_SIZES = [
  { id:'100x25x3', label:'100×25 mm · 3 ดวง/แถว', pw:102, ph:25, cols:3, lw:32, hGap:2, vGap:2, mx:1, my:0 },
  { id:'58x30',    label:'58×30 mm · 1 ดวง/แถว',  pw:58,  ph:30, cols:1, lw:54, hGap:0, vGap:2, mx:2, my:2 },
  { id:'40x25',    label:'40×25 mm · 1 ดวง/แถว',  pw:40,  ph:25, cols:1, lw:36, hGap:0, vGap:2, mx:2, my:2 },
]

const EMPTY_PROD = { barcode:'', name:'', category_id:'', unit:'ชิ้น', cost:'', price:'', stock:'', min_stock:'5', active:true }

// Parse CSV text → array of objects using first row as headers
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const vals = line.split(',')
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] || '').trim()]))
  }).filter(r => Object.values(r).some(v => v))
}

export default function ProductsPage() {
  const auth = useAuth()
  const role = auth?.role ?? 'admin'
  const [products, setProducts]       = useState([])
  const [categories, setCategories]   = useState([])
  const [search, setSearch]           = useState('')
  const [filterCat, setFilterCat]     = useState('')
  const [filterStock, setFilterStock] = useState('all')
  const [modal, setModal]             = useState(null)
  const [form, setForm]               = useState(EMPTY_PROD)
  const [saving, setSaving]           = useState(false)
  const [selected, setSelected]       = useState(new Set())
  const [printModal, setPrintModal]   = useState(false)
  const [printQtys, setPrintQtys]     = useState({})
  const [labelSize, setLabelSize]     = useState('100x25x3')
  const [labelPreview, setLabelPreview] = useState(false)
  const [catModal, setCatModal]       = useState(false)
  const [newCat, setNewCat]           = useState('')
  // Import CSV
  const [importModal, setImportModal] = useState(null) // null | 'product' | 'stock'
  const [importRows, setImportRows]   = useState([])
  const [importDone, setImportDone]   = useState(null)
  const importRef = useRef(null)
  const stockRef  = useRef(null)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from('products').select('*, categories(name)').order('name'),
      supabase.from('categories').select('*').order('name'),
    ])
    setProducts(p || [])
    setCategories(c || [])
  }

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode||'').includes(search)
    const matchCat    = !filterCat || String(p.category_id) === filterCat
    const matchStock  = filterStock === 'all' || (filterStock === 'low' && p.stock <= p.min_stock) || (filterStock === 'out' && p.stock <= 0)
    return matchSearch && matchCat && matchStock
  })

  function openAdd() { setForm(EMPTY_PROD); setModal('add') }
  function openEdit(p) {
    setForm({ barcode: p.barcode||'', name: p.name, category_id: String(p.category_id||''), unit: p.unit||'ชิ้น', cost: String(p.cost||''), price: String(p.price||''), stock: String(p.stock||''), min_stock: String(p.min_stock||5), active: p.active })
    setModal({ type:'edit', id: p.id })
  }

  async function saveProduct() {
    if (!form.name || !form.price) return alert('กรุณากรอกชื่อสินค้าและราคา')
    setSaving(true)
    const payload = {
      barcode: form.barcode || null,
      name: form.name,
      category_id: form.category_id ? parseInt(form.category_id) : null,
      unit: form.unit,
      cost: parseFloat(form.cost) || 0,
      price: parseFloat(form.price),
      stock: parseFloat(form.stock) || 0,
      min_stock: parseFloat(form.min_stock) || 5,
      active: form.active,
    }
    try {
      if (modal === 'add') {
        const { error } = await supabase.from('products').insert(payload)
        if (error) throw error
      } else {
        const { error } = await supabase.from('products').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', modal.id)
        if (error) throw error
      }
      setModal(null)
      load()
    } catch (e) { alert('ข้อผิดพลาด: ' + e.message) } finally { setSaving(false) }
  }

  async function deleteProduct(id) {
    if (!confirm('ลบสินค้านี้?')) return
    await supabase.from('products').delete().eq('id', id)
    load()
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function openPrint() {
    if (selected.size === 0) { alert('กรุณาเลือกสินค้าที่ต้องการปริ้น'); return }
    const qtys = {}
    selected.forEach(id => { qtys[id] = 1 })
    setPrintQtys(qtys)
    setPrintModal(true)
  }

  async function printLabels() {
    const size  = LABEL_SIZES.find(s => s.id === labelSize)
    const items = products.filter(p => selected.has(p.id)).flatMap(p => Array(parseInt(printQtys[p.id] || 1)).fill(p))
    if (!items.length) return

    // ลองพิมพ์ผ่าน bridge ก่อน
    const cfg = JSON.parse(localStorage.getItem('printer_barcode') || '{}')
    if (cfg.bridge_url && cfg.ip) {
      try {
        const { buildLabelTSPL, buildLabelESCPOS, printViaBridge } = await import('@/lib/printBridge')
        const lang  = cfg.lang || 'tspl'
        const bytes = lang === 'tspl'
          ? await buildLabelTSPL(items, size)
          : await buildLabelESCPOS(items, size, parseInt(cfg.paper_width) || 100)
        await printViaBridge(cfg.bridge_url, cfg.ip, cfg.port || 9100, bytes)
        setPrintModal(false)
        return
      } catch (e) {
        console.warn('Bridge label print failed, fallback to popup:', e.message)
      }
    }

    // Fallback: browser popup
    const win = window.open('', '_blank', 'width=600,height=800')
    if (!win) return alert('อนุญาต popup ก่อน')
    win.document.write(buildLabelHTML(items, size))
    win.document.close()
    setTimeout(() => win.print(), 600)
  }

  async function addCategory() {
    if (!newCat.trim()) return
    await supabase.from('categories').insert({ name: newCat.trim() })
    setNewCat('')
    load()
  }

  async function deleteCategory(id) {
    if (!confirm('ลบหมวดหมู่นี้?')) return
    await supabase.from('categories').delete().eq('id', id)
    load()
  }

  // ── CSV Product Import ──
  function onProductCSV(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const rows = parseCSV(ev.target.result)
      setImportRows(rows)
      setImportModal('product')
      setImportDone(null)
    }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  async function doProductImport() {
    setSaving(true)
    let ok = 0, fail = 0
    for (const row of importRows) {
      try {
        const catName = row['หมวดหมู่'] || row['category'] || ''
        let catId = null
        if (catName) {
          const existing = categories.find(c => c.name === catName)
          if (existing) {
            catId = existing.id
          } else {
            const { data: newCat } = await supabase.from('categories').insert({ name: catName }).select('id').single()
            catId = newCat?.id || null
          }
        }
        const payload = {
          barcode: row['barcode'] || row['บาร์โค้ด'] || null,
          name: row['name'] || row['ชื่อสินค้า'] || row['ชื่อ'] || '',
          category_id: catId,
          unit: row['unit'] || row['หน่วย'] || 'ชิ้น',
          cost: parseFloat(row['cost'] || row['ทุน'] || 0),
          price: parseFloat(row['price'] || row['ราคา'] || row['ราคาขาย'] || 0),
          stock: parseFloat(row['stock'] || row['สต็อก'] || 0),
          min_stock: parseFloat(row['min_stock'] || row['สต็อกขั้นต่ำ'] || 5),
          active: true,
        }
        if (!payload.name) { fail++; continue }
        if (payload.barcode) {
          // Upsert by barcode
          await supabase.from('products').upsert(payload, { onConflict: 'barcode' })
        } else {
          await supabase.from('products').insert(payload)
        }
        ok++
      } catch { fail++ }
    }
    setSaving(false)
    setImportDone({ ok, fail })
    load()
  }

  // ── CSV Stock Count Import ──
  function onStockCSV(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const rows = parseCSV(ev.target.result)
      setImportRows(rows)
      setImportModal('stock')
      setImportDone(null)
    }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  async function doStockImport() {
    setSaving(true)
    let ok = 0, fail = 0
    for (const row of importRows) {
      const barcode = row['barcode'] || row['บาร์โค้ด'] || ''
      const qty = parseFloat(row['qty'] || row['จำนวน'] || row['stock'] || row['สต็อก'] || 0)
      if (!barcode) { fail++; continue }
      const prod = products.find(p => p.barcode === barcode)
      if (!prod) { fail++; continue }
      const diff = qty - prod.stock
      try {
        await supabase.from('products').update({ stock: qty }).eq('id', prod.id)
        if (diff !== 0) {
          await supabase.from('stock_history').insert({
            product_id: prod.id, type: diff > 0 ? 'adjust_in' : 'adjust_out',
            qty_before: prod.stock, qty_change: diff, qty_after: qty,
            note: 'นับสต็อก CSV',
          })
        }
        ok++
      } catch { fail++ }
    }
    setSaving(false)
    setImportDone({ ok, fail })
    load()
  }

  const stockBadge = (p) => {
    if (p.stock <= 0) return <span className="badge-red">หมด</span>
    if (p.stock <= p.min_stock) return <span className="badge-amber">ใกล้หมด</span>
    return <span className="badge-green">พร้อมขาย</span>
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <h1 className="font-heading font-bold text-xl text-slate-800">📦 จัดการสินค้า</h1>
        <div className="flex gap-2 flex-wrap">
          {selected.size > 0 && (
            <button onClick={openPrint} className="bg-amber-500 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform">
              🖨️ ปริ้นบาร์โค้ด ({selected.size})
            </button>
          )}
          <button onClick={() => importRef.current?.click()}
            className="btn-secondary text-sm px-3 py-2">📥 นำเข้า CSV</button>
          <input ref={importRef} type="file" accept=".csv,.txt" className="hidden" onChange={onProductCSV} />
          <button onClick={() => stockRef.current?.click()}
            className="btn-secondary text-sm px-3 py-2">📊 ปรับสต็อก CSV</button>
          <input ref={stockRef} type="file" accept=".csv,.txt" className="hidden" onChange={onStockCSV} />
          <button onClick={() => setCatModal(true)} className="btn-secondary text-sm px-3 py-2">🗂️ หมวดหมู่</button>
          <button onClick={openAdd} className="btn-primary text-sm px-4 py-2">+ เพิ่มสินค้า</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาสินค้า / บาร์โค้ด"
          className="field flex-1 min-w-[160px]" />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="field">
          <option value="">ทุกหมวด</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStock} onChange={e => setFilterStock(e.target.value)} className="field">
          <option value="all">ทุกสถานะ</option>
          <option value="low">ใกล้หมด</option>
          <option value="out">หมดแล้ว</option>
        </select>
      </div>

      {/* Select all */}
      <div className="flex items-center gap-2 mb-2 text-xs text-slate-500 px-1">
        <input type="checkbox"
          checked={selected.size === filtered.length && filtered.length > 0}
          onChange={e => setSelected(e.target.checked ? new Set(filtered.map(p=>p.id)) : new Set())}
          className="w-4 h-4 accent-brand" />
        เลือกทั้งหมด ({filtered.length} รายการ)
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="text-slate-400 underline ml-2">ยกเลิก</button>
        )}
      </div>

      {/* Product table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand text-white text-xs">
                <th className="w-8 py-3 pl-3">
                  <input type="checkbox" className="accent-white"
                    onChange={e => setSelected(e.target.checked ? new Set(filtered.map(p=>p.id)) : new Set())} />
                </th>
                <th className="text-left px-3 py-3 font-semibold">สินค้า</th>
                <th className="text-left px-3 py-3 font-semibold hidden md:table-cell">บาร์โค้ด</th>
                <th className="text-left px-3 py-3 font-semibold hidden sm:table-cell">หมวด</th>
                <th className="text-right px-3 py-3 font-semibold">ราคาขาย</th>
                <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">ทุน</th>
                <th className="text-right px-3 py-3 font-semibold">สต็อก</th>
                <th className="text-center px-3 py-3 font-semibold">สถานะ</th>
                <th className="w-20 py-3 pr-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="pl-3 py-2.5">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="w-4 h-4 accent-brand" />
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-slate-800 leading-tight">{p.name}</p>
                    <p className="text-[10px] text-slate-400 md:hidden">{p.barcode || '—'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs hidden md:table-cell font-mono">{p.barcode || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 hidden sm:table-cell">{p.categories?.name || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-brand">฿{fmt(p.price)}</td>
                  {role === 'admin' && <td className="px-3 py-2.5 text-right text-slate-400 text-xs hidden sm:table-cell">฿{fmt(p.cost)}</td>}
                  <td className="px-3 py-2.5 text-right text-slate-700 font-medium">{p.stock} <span className="text-xs text-slate-400">{p.unit}</span></td>
                  <td className="px-3 py-2.5 text-center">{stockBadge(p)}</td>
                  <td className="px-3 py-2.5 pr-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(p)} className="text-blue-600 text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 active:bg-blue-100">แก้ไข</button>
                      <button onClick={() => deleteProduct(p.id)} className="text-red-400 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 active:bg-red-100">ลบ</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-14 text-slate-400">ไม่พบสินค้า</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add/Edit Modal ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3"
          onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto fade-in">
            <div className="bg-brand text-white px-4 py-3.5 flex justify-between items-center">
              <h2 className="font-heading font-bold">{modal === 'add' ? 'เพิ่มสินค้าใหม่' : 'แก้ไขสินค้า'}</h2>
              <button onClick={() => setModal(null)} className="text-2xl opacity-70 leading-none">×</button>
            </div>
            <div className="p-4 space-y-3">
              <Field label="บาร์โค้ด (Code128)" value={form.barcode} onChange={v => setForm(p=>({...p,barcode:v}))} placeholder="เว้นว่างถ้าไม่มีบาร์โค้ด" />
              <Field label="ชื่อสินค้า *" value={form.name} onChange={v => setForm(p=>({...p,name:v}))} placeholder="ชื่อสินค้า" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1.5">หมวดหมู่</label>
                  <select value={form.category_id} onChange={e => setForm(p=>({...p,category_id:e.target.value}))} className="field w-full">
                    <option value="">— ไม่ระบุ —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <Field label="หน่วย" value={form.unit} onChange={v => setForm(p=>({...p,unit:v}))} placeholder="ชิ้น" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {role === 'admin' && <Field label="ราคาทุน (฿)" value={form.cost} onChange={v => setForm(p=>({...p,cost:v}))} type="number" placeholder="0" />}
                <Field label="ราคาขาย (฿) *" value={form.price} onChange={v => setForm(p=>({...p,price:v}))} type="number" placeholder="0" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="สต็อกปัจจุบัน" value={form.stock} onChange={v => setForm(p=>({...p,stock:v}))} type="number" placeholder="0" />
                <Field label="สต็อกขั้นต่ำ" value={form.min_stock} onChange={v => setForm(p=>({...p,min_stock:v}))} type="number" placeholder="5" />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(p=>({...p,active:e.target.checked}))} className="w-4 h-4 accent-brand" />
                แสดงในหน้าขาย
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setModal(null)} className="flex-1 btn-secondary">ยกเลิก</button>
                <button onClick={saveProduct} disabled={saving} className="flex-1 btn-primary">
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV Import Modal ── */}
      {importModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col fade-in">
            <div className={`text-white px-4 py-3.5 flex justify-between items-center ${importModal === 'stock' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              <h2 className="font-heading font-bold">
                {importModal === 'product' ? '📥 นำเข้าสินค้าจาก CSV' : '📊 ปรับสต็อกจาก CSV (นับสต็อก)'}
              </h2>
              <button onClick={() => setImportModal(null)} className="text-2xl opacity-70 leading-none">×</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {importModal === 'product' && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 text-xs text-blue-700 space-y-1">
                  <p className="font-semibold">รูปแบบ CSV (หัวคอลัมน์ภาษาอังกฤษหรือไทย):</p>
                  <p className="font-mono text-[10px] bg-white/70 rounded p-2">barcode,name,category,unit,cost,price,stock,min_stock</p>
                  <p>หรือ: บาร์โค้ด, ชื่อสินค้า, หมวดหมู่, หน่วย, ทุน, ราคา, สต็อก, สต็อกขั้นต่ำ</p>
                </div>
              )}
              {importModal === 'stock' && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-3 text-xs text-emerald-700 space-y-1">
                  <p className="font-semibold">รูปแบบ CSV นับสต็อก:</p>
                  <p className="font-mono text-[10px] bg-white/70 rounded p-2">barcode,qty</p>
                  <p>หรือ: บาร์โค้ด, จำนวน — ระบบจะอัพเดทสต็อกเป็นจำนวนที่นับได้</p>
                </div>
              )}

              {importDone ? (
                <div className="text-center py-6">
                  <div className="text-5xl mb-3">✅</div>
                  <p className="font-bold text-lg text-slate-800">นำเข้าเสร็จแล้ว</p>
                  <p className="text-sm text-slate-500 mt-1">สำเร็จ {importDone.ok} รายการ · ผิดพลาด {importDone.fail} รายการ</p>
                  <button onClick={() => setImportModal(null)} className="btn-primary mt-4 px-8">ปิด</button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600 mb-2 font-medium">พบ {importRows.length} แถว — ตัวอย่าง:</p>
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {importRows[0] && Object.keys(importRows[0]).map(k => (
                            <th key={k} className="px-3 py-2 text-left text-slate-500 font-semibold whitespace-nowrap">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importRows.slice(0, 8).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            {Object.values(row).map((v, j) => (
                              <td key={j} className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{v || '—'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importRows.length > 8 && <p className="text-xs text-slate-400 mt-1 text-right">+ {importRows.length - 8} แถวเพิ่มเติม</p>}
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => setImportModal(null)} className="flex-1 btn-secondary">ยกเลิก</button>
                    <button onClick={importModal === 'product' ? doProductImport : doStockImport}
                      disabled={saving || importRows.length === 0}
                      className={`flex-1 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50 active:scale-95 transition-all shadow ${importModal === 'stock' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
                      {saving ? 'กำลังนำเข้า...' : `✓ ยืนยันนำเข้า ${importRows.length} รายการ`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Barcode Print Modal ── */}
      {printModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto fade-in">
            <div className="bg-amber-500 text-white px-4 py-3.5 flex justify-between items-center">
              <h2 className="font-heading font-bold">🖨️ ปริ้นบาร์โค้ด</h2>
              <button onClick={() => setPrintModal(false)} className="text-2xl opacity-70 leading-none">×</button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1.5">ขนาดสติ๊กเกอร์</label>
                <div className="grid grid-cols-3 gap-2">
                  {LABEL_SIZES.map(s => (
                    <button key={s.id} onClick={() => setLabelSize(s.id)}
                      className={`p-2.5 rounded-xl border-2 text-xs text-center transition-all font-semibold
                        ${labelSize === s.id ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border border-slate-100 rounded-xl divide-y divide-slate-50 overflow-hidden">
                {products.filter(p => selected.has(p.id)).map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{p.barcode || 'ไม่มีบาร์โค้ด'}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-slate-400">จำนวน</label>
                      <input type="number" min="1" max="100"
                        value={printQtys[p.id] || 1}
                        onChange={e => setPrintQtys(prev => ({...prev,[p.id]:e.target.value}))}
                        className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-center text-sm" />
                    </div>
                  </div>
                ))}
              </div>
              {/* ── Label Preview ── */}
              <div>
                <button onClick={() => setLabelPreview(v => !v)}
                  className="w-full border border-amber-300 text-amber-700 bg-amber-50 py-2 rounded-xl text-sm font-semibold">
                  {labelPreview ? '▲ ซ่อนตัวอย่าง' : '👁️ ดูตัวอย่างก่อนพิมพ์'}
                </button>
                {labelPreview && (() => {
                  const size  = LABEL_SIZES.find(s => s.id === labelSize)
                  const items = products.filter(p => selected.has(p.id)).flatMap(p => Array(parseInt(printQtys[p.id] || 1)).fill(p))
                  const html  = buildLabelPreviewHTML(items, size)
                  const pw    = size.pw || 100
                  // scale iframe to fit modal width (~360px)
                  const scale = Math.min(1, 340 / (pw * 3.78))
                  const iframeH = Math.ceil((size.ph || 25) * 3.78 * Math.ceil(items.length / (size.cols||3)) * scale) + 24
                  return (
                    <div className="mt-2 border border-amber-200 rounded-xl overflow-hidden bg-white">
                      <p className="text-[10px] text-slate-400 text-center py-1">ตัวอย่าง (scale {Math.round(scale*100)}%)</p>
                      <div style={{ transform:`scale(${scale})`, transformOrigin:'top left', width:`${100/scale}%`, height: iframeH/scale }}>
                        <iframe srcDoc={html} style={{ width: pw*3.78, border:'none', height: iframeH/scale }} scrolling="no" />
                      </div>
                      <div style={{ height: iframeH }} />
                    </div>
                  )
                })()}
              </div>

              <div className="flex gap-2">
                <button onClick={() => setPrintModal(false)} className="flex-1 btn-secondary">ยกเลิก</button>
                <button onClick={printLabels}
                  className="flex-1 bg-amber-500 text-white py-3 rounded-xl text-sm font-bold active:scale-95 transition-transform shadow">
                  🖨️ สั่งพิมพ์
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Category Modal ── */}
      {catModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl fade-in">
            <div className="bg-brand text-white px-4 py-3.5 flex justify-between items-center">
              <h2 className="font-heading font-bold">🗂️ หมวดหมู่</h2>
              <button onClick={() => setCatModal(false)} className="text-2xl opacity-70 leading-none">×</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input value={newCat} onChange={e => setNewCat(e.target.value)}
                  placeholder="ชื่อหมวดหมู่ใหม่"
                  onKeyDown={e => e.key === 'Enter' && addCategory()}
                  className="field flex-1" />
                <button onClick={addCategory} className="btn-primary shrink-0">+ เพิ่ม</button>
              </div>
              <div className="divide-y divide-slate-50 border border-slate-100 rounded-xl overflow-hidden">
                {categories.map(c => (
                  <div key={c.id} className="flex justify-between items-center px-3 py-2.5">
                    <span className="text-sm font-medium">{c.name}</span>
                    <button onClick={() => deleteCategory(c.id)} className="text-red-400 text-xs px-2 py-1">ลบ</button>
                  </div>
                ))}
                {categories.length === 0 && <p className="text-center text-slate-400 py-4 text-sm">ยังไม่มีหมวดหมู่</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type='text', placeholder='' }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 block mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className="field w-full" />
    </div>
  )
}

function buildLabelPreviewHTML(items, size) {
  return buildLabelHTML(items, size, true)
}

function buildLabelHTML(items, size, previewOnly = false) {
  const cols  = size.cols  || 1
  const pw    = size.pw    || 58
  const ph    = size.ph    || 30
  const mx    = size.mx  ?? size.m ?? 2
  const my    = size.my  ?? size.m ?? 0
  const hGap  = size.hGap ?? 0
  const lw    = size.lw  ?? (pw - mx * 2 - hGap * (cols - 1)) / cols
  const lh    = ph - my * 2
  const nameSz  = 7
  const priceSz = 7
  const bcH     = Math.round(lh * 3.78 * 0.52)   // ~52% ของความสูง label

  const labels = items.map((p, idx) => `
    <div class="label">
      <div class="pname">${p.name}</div>
      ${p.barcode ? `<svg class="bc" id="bc${idx}"></svg>` : ''}
      <div class="price">฿${Number(p.price).toFixed(2)}</div>
    </div>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Sarabun',sans-serif;background:white}
    @page{size:${pw}mm auto;margin:0}
    .labels{display:flex;flex-wrap:wrap;width:${pw}mm;padding:${my}mm ${mx}mm;gap:0 ${hGap}mm}
    .label{width:${lw.toFixed(4)}mm;height:${ph.toFixed(4)}mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:0.5mm 0.3mm;overflow:hidden}
    .pname{font-size:${nameSz}px;text-align:center;line-height:1.2;overflow:hidden;white-space:nowrap;max-width:100%}
    .bc{width:100%;height:auto;display:block}
    .price{font-size:${priceSz}px;font-weight:bold;margin-top:0.2mm;white-space:nowrap}
    @media print{body{margin:0}}
  </style></head><body>
  <div class="labels">${labels}</div>
  <script>
    const barcodes = ${JSON.stringify(items.map((p, i) => ({ idx: i, code: p.barcode })))}
    barcodes.forEach(b => {
      if (!b.code) return
      const el = document.getElementById('bc' + b.idx)
      if (!el) return
      try {
        JsBarcode(el, b.code, { format:'CODE128', width:${cols > 1 ? 0.85 : 1.2}, height:${bcH}, displayValue:true, fontSize:${nameSz - 1}, margin:0 })
      } catch(e) { console.warn(e) }
    })
    window.onload = () => { window.focus(); window.print() }
  </script></body></html>`
}
