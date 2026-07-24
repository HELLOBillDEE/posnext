'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { fmt } from '@/lib/utils'

// pw=page width, ph=row height, cols=columns per row, m=outer margin (mm)
// pw = total paper width, lw = each label width, hGap = gap between columns, vGap = gap between rows
const LABEL_SIZES = [
  { id:'100x25x3', label:'100×25 mm · 3 ดวง/แถว', pw:100, ph:25, cols:3, lw:30, hGap:5, vGap:2, mx:0, my:0 },
  { id:'58x30',    label:'58×30 mm · 1 ดวง/แถว',  pw:58,  ph:30, cols:1, lw:54, hGap:0, vGap:2, mx:2, my:2 },
  { id:'40x25',    label:'40×25 mm · 1 ดวง/แถว',  pw:40,  ph:25, cols:1, lw:36, hGap:0, vGap:2, mx:2, my:2 },
]

const EMPTY_PROD = { barcode:'', name:'', category_id:'', unit:'ชิ้น', cost:'', price:'', stock:'', min_stock:'5', search_tags:'', active:true }

function genCKBarcode() {
  return 'CK' + Math.floor(Math.random() * 100000000).toString().padStart(8, '0')
}
async function genUniqueCKBarcode(client) {
  let code, exists
  do {
    code = genCKBarcode()
    const { data } = await client.from('products').select('id').eq('barcode', code).maybeSingle()
    exists = !!data
  } while (exists)
  return code
}

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
  const [inputValue, setInputValue]   = useState('')
  const searchTimer                   = useRef(null)
  const [filterCat, setFilterCat]     = useState('')
  const [filterStock, setFilterStock] = useState('all')
  const [filterMargin, setFilterMargin] = useState('all')
  const [modal, setModal]             = useState(null)
  const [form, setForm]               = useState(EMPTY_PROD)
  const [saving, setSaving]           = useState(false)
  const [selected, setSelected]       = useState(new Set())
  const [printModal, setPrintModal]   = useState(false)
  const [isPrinting, setIsPrinting]   = useState(false)
  const [printerCfg, setPrinterCfg]   = useState(null)
  const [printQtys, setPrintQtys]     = useState({})
  const [labelSize, setLabelSize]     = useState('100x25x3')
  const [labelPreview, setLabelPreview] = useState(false)
  const [catModal, setCatModal]       = useState(false)
  const [newCat, setNewCat]           = useState('')
  // Google Sheets import
  const [sheetModal, setSheetModal]   = useState(false) // false | 'product' | 'stock'
  const [sheetUrl, setSheetUrl]       = useState('')
  const [sheetLoading, setSheetLoading] = useState(false)
  const [sheetError, setSheetError]   = useState('')
  // Bulk edit mode
  const [bulkMode, setBulkMode]       = useState(false)
  const [bulkEdits, setBulkEdits]     = useState({}) // { id: { stock, price, cost } }
  const [bulkSaving, setBulkSaving]   = useState(false)
  // Import CSV
  const [importModal, setImportModal] = useState(null) // null | 'product' | 'stock'
  const [importRows, setImportRows]   = useState([])
  const [importDone, setImportDone]   = useState(null)
  const [visibleCount, setVisibleCount] = useState(20)
  const loadMoreRef = useRef(null)
  const importRef = useRef(null)
  const stockRef  = useRef(null)

  useEffect(() => { load() }, [])

  useEffect(() => { setVisibleCount(20) }, [search, filterCat, filterStock, filterMargin])

  async function load() {
    const [{ data: c }, { data: cfgRows }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('settings').select('key,value').in('key', ['label_size', 'printer_barcode']),
    ])
    // ดึงสินค้าทีละ 1000 จนครบ (Supabase max_rows = 1000)
    let allProducts = []
    let from = 0
    while (true) {
      const { data: batch } = await supabase
        .from('products').select('*, categories(name)').order('name')
        .range(from, from + 999)
      if (!batch || batch.length === 0) break
      allProducts = allProducts.concat(batch)
      if (batch.length < 1000) break
      from += 1000
    }
    setProducts(allProducts)
    setCategories(c || [])
    const cfgMap = Object.fromEntries((cfgRows || []).map(r => [r.key, r.value]))
    if (cfgMap.label_size) setLabelSize(cfgMap.label_size)
    // sync printer config จาก DB ลง localStorage (ถ้าไม่มีค่า local)
    if (cfgMap.printer_barcode) {
      localStorage.setItem('printer_barcode', cfgMap.printer_barcode)
    }
  }

  const marginPct = p => p.cost > 0 && p.price > 0 ? (p.price - p.cost) / p.cost * 100 : null

  const filtered = products.filter(p => {
    const q = search.toLowerCase()
    const matchSearch  = !search || p.name.toLowerCase().includes(q) || (p.barcode||'').toLowerCase().includes(q) || (p.alt_barcode||'').toLowerCase().includes(q) || (p.search_tags||'').toLowerCase().includes(q)
    const matchCat     = !filterCat || String(p.category_id) === filterCat
    const matchStock   = filterStock === 'all' || (filterStock === 'low' && p.stock <= p.min_stock) || (filterStock === 'out' && p.stock <= 0)
    const m            = marginPct(p)
    const matchMargin  = filterMargin === 'all' || (filterMargin === 'low' && m !== null && m < 35) || (filterMargin === 'none' && (m === null || p.cost === 0))
    return matchSearch && matchCat && matchStock && matchMargin
  })

  // สถิติกำไรทั้งร้าน — ใช้ค่าจาก bulkEdits ถ้าอยู่ใน bulk mode
  const marginStats = (() => {
    const eff = p => {
      const e = bulkMode && bulkEdits[p.id]
      return {
        cost:  e ? (parseFloat(e.cost)  ?? p.cost)  : p.cost,
        price: e ? (parseFloat(e.price) ?? p.price) : p.price,
        stock: e ? (parseFloat(e.stock) ?? p.stock) : p.stock,
      }
    }
    const withCost = products.filter(p => { const v = eff(p); return v.cost > 0 && v.price > 0 })
    if (!withCost.length) return null
    // ถ่วงน้ำหนักด้วย cost (ไม่ใช่ stock) เพื่อให้ทุกสินค้ามีน้ำหนัก แม้ stock ติดลบหรือ 0
    const totalRevenue   = withCost.reduce((s, p) => { const v = eff(p); return s + v.price }, 0)
    const totalCost      = withCost.reduce((s, p) => { const v = eff(p); return s + v.cost  }, 0)
    const avgMargin      = withCost.reduce((s, p) => { const v = eff(p); return s + (v.price - v.cost) / v.cost * 100 }, 0) / withCost.length
    const belowThreshold = products.filter(p => { const v = eff(p); const m = v.cost > 0 ? (v.price - v.cost) / v.cost * 100 : null; return m !== null && m < 35 }).length
    const weightedMargin = totalCost > 0 ? (totalRevenue - totalCost) / totalCost * 100 : 0
    return { avgMargin, weightedMargin, belowThreshold, total: withCost.length }
  })()

  const paginated    = bulkMode ? filtered : filtered.slice(0, visibleCount)

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount(n => n + 50)
    }, { rootMargin: '0px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [visibleCount, filtered.length])

  async function openAdd() {
    const barcode = await genUniqueCKBarcode(supabase)
    setForm({ ...EMPTY_PROD, barcode })
    setModal('add')
  }
  function openEdit(p) {
    setForm({ barcode: p.barcode||'', name: p.name, category_id: String(p.category_id||''), unit: p.unit||'ชิ้น', cost: String(p.cost||''), price: String(p.price||''), stock: String(p.stock||''), min_stock: String(p.min_stock||5), search_tags: p.search_tags||'', active: p.active })
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
      search_tags: form.search_tags?.trim() || null,
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
    const cfg = JSON.parse(localStorage.getItem('printer_barcode') || '{}')
    setPrinterCfg(cfg)
    setPrintModal(true)
  }

  async function printLabels() {
    const size  = LABEL_SIZES.find(s => s.id === labelSize)
    const items = products.filter(p => selected.has(p.id)).flatMap(p => Array(parseInt(printQtys[p.id] || 1)).fill(p))
    if (!items.length) return

    // ลองพิมพ์ผ่าน bridge ก่อน
    const cfg = JSON.parse(localStorage.getItem('printer_barcode') || '{}')
    if (!cfg.ip) return alert('ยังไม่ได้ตั้งค่า IP เครื่องพิมพ์บาร์โค้ด\nไปตั้งค่าที่ Admin → เครื่องพิมพ์')

    setIsPrinting(true)
    try {
      const { buildLabelTSPL, buildLabelESCPOS, printViaBridge } = await import('@/lib/printBridge')
      const lang  = cfg.lang || 'tspl'
      // TSPL expects items with .qty (total labels per product), not an expanded array
      const tsplItems = products.filter(p => selected.has(p.id)).map(p => ({ ...p, qty: parseInt(printQtys[p.id] || 1) }))
      const bytes = lang === 'tspl'
        ? await buildLabelTSPL(tsplItems, size)
        : await buildLabelESCPOS(items, size, parseInt(cfg.paper_width) || 100)

      // ลองพิมที่ IP ที่บันทึกไว้ก่อน
      try {
        await printViaBridge('', cfg.ip, cfg.port || 9100, bytes, [0, 4000])
        setPrintModal(false)
        return
      } catch (connErr) {
        // ถ้า connect ไม่ได้ และมี MAC → ค้นหา IP ใหม่อัตโนมัติ
        if (!cfg.mac) throw connErr
        console.warn('Primary IP failed, auto-discovering printer by MAC...')
        const res = await fetch('/api/find-printer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mac: cfg.mac, port: cfg.port || 9100 }),
        })
        const found = await res.json()
        if (!found.ip) throw connErr
        // พบ IP ใหม่ — อัปเดตและพิมพ์
        const newCfg = { ...cfg, ip: found.ip }
        localStorage.setItem('printer_barcode', JSON.stringify(newCfg))
        supabase.from('settings').upsert({ key: 'printer_barcode', value: JSON.stringify(newCfg) }, { onConflict: 'key' })
        setPrinterCfg(newCfg)
        await printViaBridge('', found.ip, cfg.port || 9100, bytes, [0])
        setPrintModal(false)
      }
    } catch (e) {
      console.warn('Label print failed:', e.message)
      const msg = e.message || ''
      if (msg.includes('EHOSTDOWN') || msg.includes('EHOSTUNREACH') || msg.includes('ENETUNREACH') || msg.includes('timeout') || msg.includes('เชื่อมต่อ'))
        alert(`❌ หาเครื่องพิมไม่เจอ\nIP: ${cfg.ip}:${cfg.port||9100}\n\nตรวจสอบ:\n• เครื่องพิมเปิดอยู่ไหม?\n• สาย LAN เสียบอยู่ไหม?`)
      else
        alert(`❌ พิมพ์ไม่ได้: ${msg}`)
    } finally {
      setIsPrinting(false)
    }
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

  // ── Google Sheets Import ──
  async function fetchSheet() {
    if (!sheetUrl.trim()) return
    setSheetLoading(true)
    setSheetError('')
    try {
      const res = await fetch('/api/fetch-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sheetUrl.trim() }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'ดึงข้อมูลไม่สำเร็จ')
      }
      const text = await res.text()
      const rows = parseCSV(text)
      if (!rows.length) throw new Error('ไม่พบข้อมูลในชีท')
      setImportRows(rows)
      setImportModal(sheetModal)
      setImportDone(null)
      setSheetModal(false)
      setSheetUrl('')
    } catch (e) {
      setSheetError(e.message)
    } finally {
      setSheetLoading(false)
    }
  }

  // ── Bulk Mode ──
  function enterBulkMode() {
    const edits = {}
    products.forEach(p => { edits[p.id] = { stock: String(p.stock ?? ''), price: String(p.price ?? ''), cost: String(p.cost ?? ''), category_id: p.category_id ?? '' } })
    setBulkEdits(edits)
    setSelected(new Set())
    setBulkMode(true)
  }

  function exitBulkMode() { setBulkMode(false); setBulkEdits({}); setSelected(new Set()) }

  function setBulkField(id, field, val) {
    setBulkEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  async function saveBulkEdits() {
    const changed = products.filter(p => {
      const e = bulkEdits[p.id]
      if (!e) return false
      return parseFloat(e.stock) !== p.stock || parseFloat(e.price) !== p.price || parseFloat(e.cost) !== p.cost || String(p.category_id ?? '') !== String(e.category_id ?? '')
    })
    if (changed.length === 0) { exitBulkMode(); return }
    setBulkSaving(true)
    try {
      await Promise.all(changed.map(p => {
        const e = bulkEdits[p.id]
        return supabase.from('products').update({
          stock: parseFloat(e.stock) || 0,
          price: parseFloat(e.price) || 0,
          cost:  parseFloat(e.cost)  || 0,
          category_id: e.category_id ? parseInt(e.category_id) : null,
          updated_at: new Date().toISOString(),
        }).eq('id', p.id)
      }))
      await load()
      exitBulkMode()
    } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message) }
    finally { setBulkSaving(false) }
  }

  async function bulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`ลบสินค้า ${selected.size} ชิ้นที่เลือก?`)) return
    setBulkSaving(true)
    try {
      await supabase.from('products').delete().in('id', [...selected])
      await load()
      exitBulkMode()
    } catch (e) { alert('ลบไม่สำเร็จ: ' + e.message) }
    finally { setBulkSaving(false) }
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
          {!bulkMode && selected.size > 0 && (
            <button onClick={openPrint} className="bg-amber-500 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow active:scale-95 transition-transform">
              🖨️ ปริ้นบาร์โค้ด ({selected.size})
            </button>
          )}
          {!bulkMode && <>
            <button onClick={() => importRef.current?.click()}
              className="btn-secondary text-sm px-3 py-2">📥 นำเข้า CSV</button>
            <input ref={importRef} type="file" accept=".csv,.txt" className="hidden" onChange={onProductCSV} />
            <button onClick={() => stockRef.current?.click()}
              className="btn-secondary text-sm px-3 py-2">📊 ปรับสต็อก CSV</button>
            <input ref={stockRef} type="file" accept=".csv,.txt" className="hidden" onChange={onStockCSV} />
            <button onClick={() => { setSheetModal('product'); setSheetUrl(''); setSheetError('') }}
              className="btn-secondary text-sm px-3 py-2">🟢 นำเข้า Sheet</button>
            <button onClick={() => setCatModal(true)} className="btn-secondary text-sm px-3 py-2">🗂️ หมวดหมู่</button>
            <button onClick={enterBulkMode} className="btn-secondary text-sm px-3 py-2">✏️ จัดการ</button>
            <button onClick={openAdd} className="btn-primary text-sm px-4 py-2">+ เพิ่มสินค้า</button>
          </>}
          {bulkMode && <>
            <span className="text-sm text-slate-500 self-center">โหมดแก้ไขกลุ่ม</span>
            <button onClick={exitBulkMode} className="btn-secondary text-sm px-3 py-2">✕ ยกเลิก</button>
          </>}
        </div>
      </div>

      {/* Margin summary */}
      {role === 'admin' && marginStats && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="card p-3 text-center">
            <p className="text-xs text-slate-400 mb-0.5">%กำไรเฉลี่ย</p>
            <p className={`text-xl font-bold ${marginStats.avgMargin >= 35 ? 'text-green-600' : 'text-amber-500'}`}>
              {marginStats.avgMargin.toFixed(1)}%
            </p>
            <p className="text-[10px] text-slate-400">เฉลี่ยต่อรายการ</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-xs text-slate-400 mb-0.5">%กำไรถ่วงน้ำหนัก</p>
            <p className={`text-xl font-bold ${marginStats.weightedMargin >= 35 ? 'text-green-600' : 'text-amber-500'}`}>
              {marginStats.weightedMargin.toFixed(1)}%
            </p>
            <p className="text-[10px] text-slate-400">ถ่วงตามราคาทุน</p>
          </div>
          <button
            onClick={() => setFilterMargin(f => f === 'low' ? 'all' : 'low')}
            className={`card p-3 text-center transition-colors ${filterMargin === 'low' ? 'ring-2 ring-red-400 bg-red-50' : 'hover:bg-red-50/50'}`}>
            <p className="text-xs text-slate-400 mb-0.5">ต่ำกว่าเกณฑ์ 35%</p>
            <p className="text-xl font-bold text-red-500">{marginStats.belowThreshold}</p>
            <p className="text-[10px] text-slate-400">รายการ {filterMargin === 'low' ? '· กดเพื่อยกเลิก' : '· กดเพื่อดู'}</p>
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={inputValue} onChange={e => {
          const v = e.target.value
          setInputValue(v)
          clearTimeout(searchTimer.current)
          searchTimer.current = setTimeout(() => setSearch(v), 300)
        }}
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
        {role === 'admin' && (
          <select value={filterMargin} onChange={e => setFilterMargin(e.target.value)} className="field">
            <option value="all">ทุก%กำไร</option>
            <option value="low">กำไร &lt; 35%</option>
            <option value="none">ไม่มีต้นทุน</option>
          </select>
        )}
      </div>

      {/* Select all */}
      <div className="flex items-center gap-2 mb-2 text-xs text-slate-500 px-1">
        <input type="checkbox"
          checked={selected.size === filtered.length && filtered.length > 0}
          onChange={e => setSelected(e.target.checked ? new Set(filtered.map(p=>p.id)) : new Set())}
          className="w-4 h-4 accent-brand" />
        {bulkMode ? <span className="text-red-500 font-medium">☑ เลือกเพื่อลบ</span> : 'เลือกทั้งหมด'}
        ({filtered.length} รายการ)
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="text-slate-400 underline ml-2">ยกเลิก</button>
        )}
        {bulkMode && <span className="ml-auto text-amber-600 text-[10px]">✏️ แก้ไขราคา/สต็อกได้ในตาราง</span>}
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
                {role === 'admin' && <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">ทุน</th>}
                {role === 'admin' && <th className="text-right px-3 py-3 font-semibold hidden sm:table-cell">%กำไร</th>}
                <th className="text-right px-3 py-3 font-semibold">สต็อก</th>
                <th className="text-center px-3 py-3 font-semibold">สถานะ</th>
                <th className="w-20 py-3 pr-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paginated.map(p => {
                const e = bulkEdits[p.id] || {}
                const changed = bulkMode && (String(p.stock) !== e.stock || String(p.price) !== e.price || String(p.cost) !== e.cost || String(p.category_id ?? '') !== String(e.category_id ?? ''))
                return (
                <tr key={p.id} className={`transition-colors ${bulkMode && selected.has(p.id) ? 'bg-red-50' : changed ? 'bg-amber-50' : 'hover:bg-slate-50/70'}`}>
                  <td className="pl-3 py-2.5">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="w-4 h-4 accent-brand" />
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-slate-800 leading-tight">{p.name}</p>
                    <p className="text-[10px] text-slate-400 md:hidden">{p.barcode || '—'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs hidden md:table-cell font-mono">{p.barcode || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 hidden sm:table-cell">
                    {bulkMode
                      ? <select value={e.category_id ?? ''} onChange={ev => setBulkField(p.id, 'category_id', ev.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:border-brand outline-none bg-white max-w-[120px]">
                          <option value="">— ไม่มี —</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      : p.categories?.name || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {bulkMode
                      ? <input type="number" value={e.price ?? ''} onChange={ev => setBulkField(p.id,'price',ev.target.value)}
                          className="w-20 border border-gray-200 rounded px-1.5 py-1 text-xs text-right focus:border-brand outline-none" />
                      : <span className="font-bold text-brand">฿{fmt(p.price)}</span>}
                  </td>
                  {role === 'admin' && <td className="px-2 py-1.5 text-right hidden sm:table-cell">
                    {bulkMode
                      ? <input type="number" value={e.cost ?? ''} onChange={ev => setBulkField(p.id,'cost',ev.target.value)}
                          className="w-20 border border-gray-200 rounded px-1.5 py-1 text-xs text-right focus:border-brand outline-none" />
                      : <span className="text-slate-400 text-xs">฿{fmt(p.cost)}</span>}
                  </td>}
                  {role === 'admin' && (() => {
                    const m = marginPct(bulkMode ? { cost: parseFloat(e.cost ?? p.cost), price: parseFloat(e.price ?? p.price) } : p)
                    return (
                      <td className="px-2 py-1.5 text-right hidden sm:table-cell">
                        {m === null
                          ? <span className="text-slate-300 text-xs">—</span>
                          : <span className={`text-xs font-semibold ${m < 35 ? 'text-red-500' : m < 50 ? 'text-amber-500' : 'text-green-600'}`}>
                              {m.toFixed(0)}%
                            </span>}
                      </td>
                    )
                  })()}
                  <td className="px-2 py-1.5 text-right">
                    {bulkMode
                      ? <input type="number" value={e.stock ?? ''} onChange={ev => setBulkField(p.id,'stock',ev.target.value)}
                          className="w-20 border border-gray-200 rounded px-1.5 py-1 text-xs text-right focus:border-brand outline-none" />
                      : <span className="text-slate-700 font-medium">{p.stock} <span className="text-xs text-slate-400">{p.unit}</span></span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">{stockBadge(p)}</td>
                  <td className="px-3 py-2.5 pr-3">
                    {!bulkMode && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(p)} className="text-brand text-xs px-2.5 py-1.5 rounded-lg bg-brand-50 active:bg-brand-50/70">แก้ไข</button>
                        <button onClick={() => deleteProduct(p.id)} className="text-red-400 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 active:bg-red-100">ลบ</button>
                      </div>
                    )}
                    {bulkMode && changed && <span className="text-[9px] text-amber-500 font-medium">แก้ไข</span>}
                  </td>
                </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-14 text-slate-400">ไม่พบสินค้า</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Load more sentinel ── */}
      {!bulkMode && visibleCount < filtered.length && (
        <div ref={loadMoreRef} className="text-center py-4 text-xs text-slate-400">
          กำลังโหลด... ({paginated.length}/{filtered.length})
        </div>
      )}

      {/* ── Bulk Mode Action Bar ── */}
      {bulkMode && (
        <div className="fixed bottom-0 left-0 right-0 md:left-[220px] z-40 bg-white border-t border-slate-200 shadow-xl px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="flex-1 text-sm text-slate-600">
              {selected.size > 0
                ? <span className="font-semibold text-slate-800">{selected.size} รายการที่เลือก</span>
                : <span className="text-slate-400">เลือกสินค้าเพื่อลบ หรือแก้ค่าในตาราง</span>}
              {(() => {
                const nChanged = products.filter(p => {
                  const e = bulkEdits[p.id]; if (!e) return false
                  return String(p.stock) !== e.stock || String(p.price) !== e.price || String(p.cost) !== e.cost
                }).length
                return nChanged > 0 ? <span className="ml-2 text-amber-600 font-medium">· {nChanged} รายการแก้ไข</span> : null
              })()}
            </div>
            {selected.size > 0 && (
              <button onClick={bulkDelete} disabled={bulkSaving}
                className="bg-red-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform shadow">
                🗑️ ลบ {selected.size} รายการ
              </button>
            )}
            <button onClick={saveBulkEdits} disabled={bulkSaving}
              className="bg-brand text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform shadow">
              {bulkSaving ? 'กำลังบันทึก...' : '💾 บันทึกการเปลี่ยนแปลง'}
            </button>
          </div>
        </div>
      )}

      {/* ── Google Sheets Modal ── */}
      {sheetModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3"
          onClick={e => e.target === e.currentTarget && setSheetModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden fade-in">
            <div className="bg-emerald-600 text-white px-4 py-3.5 flex justify-between items-center">
              <h2 className="font-heading font-bold">🟢 นำเข้าจาก Google Sheets</h2>
              <button onClick={() => setSheetModal(false)} className="text-2xl opacity-70 leading-none">×</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-800 space-y-1.5">
                <p className="font-semibold">วิธีใช้:</p>
                <p>1. เปิด Google Sheet → กด <strong>แชร์</strong> → <strong>"Anyone with the link"</strong></p>
                <p>2. คัดลอก URL แล้ววางด้านล่าง</p>
                <p>3. หัวคอลัมน์ชีทต้องมี: <span className="font-mono bg-white/70 px-1 rounded">name / ชื่อสินค้า</span></p>
                <p className="text-emerald-600">คอลัมน์อื่น: barcode, unit, cost, price, stock, หมวดหมู่</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 block">ประเภทการนำเข้า</label>
                <div className="flex gap-2">
                  <button onClick={() => setSheetModal('product')}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${sheetModal==='product' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600'}`}>
                    สินค้า
                  </button>
                  <button onClick={() => setSheetModal('stock')}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${sheetModal==='stock' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600'}`}>
                    ปรับสต็อก
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1.5">Google Sheets URL</label>
                <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="field w-full text-xs" />
              </div>

              {sheetError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{sheetError}</div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setSheetModal(false)} className="flex-1 btn-secondary">ยกเลิก</button>
                <button onClick={fetchSheet} disabled={sheetLoading || !sheetUrl.trim()}
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform shadow">
                  {sheetLoading ? '⏳ กำลังดึงข้อมูล...' : '📥 ดึงข้อมูล'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1.5">บาร์โค้ด (Code128)</label>
                <div className="flex gap-2">
                  <input value={form.barcode} onChange={e => setForm(p=>({...p,barcode:e.target.value}))}
                    placeholder="เว้นว่างถ้าไม่มีบาร์โค้ด"
                    className="field flex-1 font-mono text-sm" />
                  <button type="button"
                    onClick={async () => { const b = await genUniqueCKBarcode(supabase); setForm(p=>({...p,barcode:b})) }}
                    className="shrink-0 px-3 py-2 bg-brand/10 text-brand text-xs font-bold rounded-xl border border-brand/20 hover:bg-brand/20 transition-colors whitespace-nowrap">
                    🎲 สุ่ม CK
                  </button>
                </div>
              </div>
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
              {parseFloat(form.cost) > 0 && (
                <button type="button"
                  onClick={() => setForm(p => ({ ...p, price: String(Math.ceil(parseFloat(p.cost||0) * 1.35)) }))}
                  className="text-[10px] text-brand -mt-1">
                  แนะนำราคาขาย +35% = ฿{Math.ceil(parseFloat(form.cost||0) * 1.35)}
                </button>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="สต็อกปัจจุบัน" value={form.stock} onChange={v => setForm(p=>({...p,stock:v}))} type="number" placeholder="0" />
                <Field label="สต็อกขั้นต่ำ" value={form.min_stock} onChange={v => setForm(p=>({...p,min_stock:v}))} type="number" placeholder="5" />
              </div>
              <Field label="คำค้นหาเพิ่มเติม" value={form.search_tags} onChange={v => setForm(p=>({...p,search_tags:v}))} placeholder="เช่น สายน้ำ, ท่อยาง (คั่นด้วยจุลภาค)" />
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
            <div className={`text-white px-4 py-3.5 flex justify-between items-center ${importModal === 'stock' ? 'bg-emerald-600' : 'bg-brand'}`}>
              <h2 className="font-heading font-bold">
                {importModal === 'product' ? '📥 นำเข้าสินค้าจาก CSV' : '📊 ปรับสต็อกจาก CSV (นับสต็อก)'}
              </h2>
              <button onClick={() => setImportModal(null)} className="text-2xl opacity-70 leading-none">×</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {importModal === 'product' && (
                <div className="bg-brand-50 border border-brand/10 rounded-xl p-3 mb-3 text-xs text-brand-mid space-y-1">
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
                      className={`flex-1 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50 active:scale-95 transition-all shadow ${importModal === 'stock' ? 'bg-emerald-600' : 'bg-brand'}`}>
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
                    <button key={s.id} onClick={() => {
                        setLabelSize(s.id)
                        supabase.from('settings').upsert({ key: 'label_size', value: s.id }, { onConflict: 'key' })
                      }}
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
                      <input type="text" inputMode="numeric" pattern="[0-9]*"
                        value={printQtys[p.id] ?? 1}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9]/g, '')
                          setPrintQtys(prev => ({...prev,[p.id]: v}))
                        }}
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

              {printerCfg?.ip ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <span className="text-emerald-500 text-base">🖨️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-emerald-700">เครื่องพิมพ์บาร์โค้ด</p>
                    <p className="text-[11px] text-emerald-600 font-mono">{printerCfg.ip}:{printerCfg.port || 9100}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <span className="text-red-500 text-base">⚠️</span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-red-700">ยังไม่ได้ตั้งค่า IP เครื่องพิมพ์</p>
                    <p className="text-[11px] text-red-500">ไปตั้งค่าที่ Admin → เครื่องพิมพ์</p>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setPrintModal(false)} className="flex-1 btn-secondary">ยกเลิก</button>
                <button onClick={printLabels} disabled={isPrinting}
                  className="flex-1 bg-amber-500 text-white py-3 rounded-xl text-sm font-bold active:scale-95 transition-transform shadow disabled:opacity-60">
                  {isPrinting ? '⏳ กำลังพิมพ์...' : '🖨️ สั่งพิมพ์'}
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
    body{font-family:'Kanit',sans-serif;background:white}
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
