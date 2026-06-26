'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDate, genPONo } from '@/lib/utils'

const STATUS = { draft:'ร่าง', ordered:'สั่งซื้อแล้ว', received:'รับสินค้าแล้ว', cancelled:'ยกเลิก' }
const STATUS_COLOR = { draft:'bg-gray-100 text-gray-600', ordered:'bg-brand-50 text-brand-mid', received:'bg-green-100 text-green-700', cancelled:'bg-red-100 text-red-500' }

export default function POPage() {
  const [pos, setPOs]             = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts]   = useState([])
  const [view, setView]           = useState('list')  // list | create | detail
  const [selected, setSelected]   = useState(null)
  const [form, setForm]           = useState({ supplier_id:'', note:'' })
  const [items, setItems]         = useState([])
  const [filterStatus, setFilterStatus] = useState('')
  const [saving, setSaving]       = useState(false)
  const [printPO, setPrintPO]     = useState(null)
  const [editItems, setEditItems] = useState([])
  const [editForm, setEditForm]   = useState({ supplier_id:'', note:'' })
  const [scanReceive, setScanReceive] = useState(false)
  const [scanInput, setScanInput]    = useState('')
  const [scanItems, setScanItems]    = useState([])
  const [scanSaving, setScanSaving]  = useState(false)
  const [minMargin, setMinMargin]     = useState(30)
  // AI อ่านใบส่งของ
  const [aiModal, setAiModal]        = useState(false)
  const [aiLoading, setAiLoading]    = useState(false)
  const [aiLoadMsg, setAiLoadMsg]    = useState('')
  const [aiError, setAiError]        = useState('')
  const [aiResult, setAiResult]      = useState(null)   // { supplier, items:[...] }
  const [aiReview, setAiReview]      = useState([])     // items พร้อม matched/new flag

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: p }, { data: s }, { data: pr }, { data: cfg }] = await Promise.all([
      supabase.from('purchase_orders').select('*, suppliers(name), po_items(count)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('id,name,barcode,unit,cost,price').eq('active',true).order('name'),
      supabase.from('settings').select('key,value').eq('key', 'min_margin'),
    ])
    setPOs(p || [])
    setSuppliers(s || [])
    setProducts(pr || [])
    if (cfg?.[0]?.value) setMinMargin(parseFloat(cfg[0].value) || 30)
  }

  async function openDetail(po) {
    const { data } = await supabase.from('purchase_orders')
      .select('*, suppliers(name), po_items(*, products(name))')
      .eq('id', po.id).single()
    setSelected(data)
    setView('detail')
  }

  function addItem() {
    setItems(p => [...p, { product_id:'', product_name:'', barcode:'', unit:'', qty:1, cost:'', subtotal:0 }])
  }

  function setItemField(idx, field, val) {
    setItems(prev => {
      const n = [...prev]
      n[idx] = { ...n[idx], [field]: val }
      if (field === 'product_id') {
        const prod = products.find(p => String(p.id) === val)
        if (prod) {
          const cost = parseFloat(prod.cost) || 0
          const minP = cost ? Math.ceil(cost * (1 + minMargin / 100)) : ''
          n[idx] = { ...n[idx], product_name: prod.name, barcode: prod.barcode||'', unit: prod.unit||'', cost: String(prod.cost||''), price: String(prod.price || minP || '') }
        }
      }
      if (field === 'cost') {
        const cost = parseFloat(val) || 0
        const minP = cost ? Math.ceil(cost * (1 + minMargin / 100)) : ''
        if (!n[idx].price || parseFloat(n[idx].price) < cost * (1 + minMargin / 100)) {
          n[idx].price = String(minP)
        }
      }
      if (field === 'qty' || field === 'cost') {
        n[idx].subtotal = parseFloat(n[idx].qty || 0) * parseFloat(n[idx].cost || 0)
      }
      return n
    })
  }

  const poTotal = items.reduce((s, i) => s + parseFloat(i.qty||0) * parseFloat(i.cost||0), 0)

  async function savePO() {
    const validItems = items.filter(i => i.product_id)
    if (validItems.length === 0) return alert('กรุณาเพิ่มรายการสินค้า')
    const belowMin = validItems.filter(i => {
      const c = parseFloat(i.cost) || 0
      const p = parseFloat(i.price) || 0
      return c > 0 && p < c * (1 + minMargin / 100)
    })
    if (belowMin.length > 0) return alert(`ราคาขายต่ำกว่า ${minMargin}% จำนวน ${belowMin.length} รายการ`)
    setSaving(true)
    try {
      const poNo = genPONo()
      const { data: po, error } = await supabase.from('purchase_orders').insert({
        po_no: poNo,
        supplier_id: form.supplier_id ? parseInt(form.supplier_id) : null,
        total: poTotal, subtotal: poTotal,
        note: form.note,
        status: 'draft',
      }).select().single()
      if (error) throw error
      await supabase.from('po_items').insert(
        validItems.map(i => ({
          po_id: po.id,
          product_id: parseInt(i.product_id),
          product_name: i.product_name,
          barcode: i.barcode,
          unit: i.unit,
          qty: parseFloat(i.qty) || 1,
          cost: parseFloat(i.cost) || 0,
          subtotal: parseFloat(i.qty||0) * parseFloat(i.cost||0),
        }))
      )
      // อัปเดตราคาขายในสินค้า
      await Promise.all(validItems.filter(i => i.price).map(i =>
        supabase.from('products').update({ cost: parseFloat(i.cost)||0, price: parseFloat(i.price) }).eq('id', parseInt(i.product_id))
      ))
      setView('list'); setForm({ supplier_id:'', note:'' }); setItems([])
      loadAll()
    } catch (e) {
      alert('ข้อผิดพลาด: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(poId, status) {
    await supabase.from('purchase_orders').update({ status, ...(status==='ordered'?{ordered_at:new Date().toISOString()}:{}) }).eq('id', poId)
    loadAll()
    if (selected?.id === poId) openDetail({ id: poId })
  }

  async function receivePO(po) {
    if (!confirm('ยืนยันรับสินค้าและอัปเดตสต็อก?')) return
    const { data: poItems } = await supabase.from('po_items').select('*').eq('po_id', po.id)
    for (const item of (poItems || [])) {
      if (!item.product_id) continue
      await supabase.rpc('adjust_stock', {
        p_product_id: item.product_id, p_qty_change: item.qty,
        p_type: 'po_receive', p_ref_id: po.id,
      }).catch(async () => {
        const { data } = await supabase.from('products').select('stock').eq('id', item.product_id).single()
        await supabase.from('products').update({ stock: (data?.stock||0) + item.qty }).eq('id', item.product_id)
      })
      await supabase.from('po_items').update({ received_qty: item.qty }).eq('id', item.id)
    }
    await updateStatus(po.id, 'received')
    await supabase.from('purchase_orders').update({ received_at: new Date().toISOString() }).eq('id', po.id)
  }

  async function analyzeDelivery(file) {
    setAiLoading(true)
    setAiError('')
    setAiResult(null)
    setAiReview([])
    setAiLoadMsg('⏳ กำลังโหลดภาพ...')
    try {
      // บีบรูปก่อนส่ง ลดให้ไม่เกิน 1400px เพื่อหลีกเลี่ยง 413 error
      const base64 = await new Promise((res, rej) => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
          const MAX = 1400
          let w = img.width, h = img.height
          if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
          if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
          const cvs = document.createElement('canvas')
          cvs.width = w; cvs.height = h
          cvs.getContext('2d').drawImage(img, 0, 0, w, h)
          URL.revokeObjectURL(url)
          res(cvs.toDataURL('image/jpeg', 0.80).split(',')[1])
        }
        img.onerror = rej
        img.src = url
      })
      const mediaType = 'image/jpeg'

      setAiLoadMsg('🤖 AI กำลังอ่านใบส่งของ...')
      const resp = await fetch('/api/analyze-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)

      setAiResult(data)

      const reviewed = (data.items || []).map(ai => {
        const aiCost = ai.unit_cost || (ai.total && ai.qty ? (ai.total / ai.qty) : null)
        const minPrice = aiCost ? Math.ceil(aiCost * (1 + minMargin / 100)) : null
        return {
          ...ai,
          mode: 'new',          // 'new' | 'search'
          product_id: null,     // set when user picks existing product
          matched: null,
          cost: aiCost,
          price: minPrice,
          searchText: '',
          enabled: true,
        }
      })
      setAiReview(reviewed)
    } catch (e) {
      setAiError(e.message)
    } finally {
      setAiLoading(false)
      setAiLoadMsg('')
    }
  }

  async function confirmAiReceive() {
    const toProcess = aiReview.filter(i => i.enabled)
    setAiLoading(true)
    setAiLoadMsg('💾 กำลังบันทึก...')
    try {
      // 1. สร้าง/อัปเดตสินค้า และเก็บ product_id จริงสำหรับ PO items
      const poItemsData = []
      for (const item of toProcess) {
        let productId = item.mode === 'search' && item.product_id ? item.product_id : null
        if (item.mode === 'new') {
          const { data: newProd } = await supabase.from('products').insert({
            name: item.name, barcode: item.barcode || null,
            unit: item.unit || 'ชิ้น', cost: item.cost || 0,
            price: item.price || 0, stock: item.qty || 0, active: true,
          }).select('id').single()
          productId = newProd?.id
          if (productId && item.qty > 0) {
            await supabase.from('stock_history').insert({
              product_id: productId, type: 'receive',
              qty_before: 0, qty_change: item.qty || 0, qty_after: item.qty || 0,
              note: 'รับสินค้า AI สแกน (สินค้าใหม่)',
            })
          }
        } else if (productId) {
          const qtyBefore = item.matched?.stock ?? 0
          const newStock = qtyBefore + (item.qty || 0)
          await supabase.from('products').update({
            stock: newStock,
            ...(item.cost  ? { cost:  item.cost  } : {}),
            ...(item.price ? { price: item.price } : {}),
          }).eq('id', productId)
          if ((item.qty || 0) > 0) {
            await supabase.from('stock_history').insert({
              product_id: productId, type: 'receive',
              qty_before: qtyBefore, qty_change: item.qty || 0, qty_after: newStock,
              note: 'รับสินค้า AI สแกน',
            })
          }
        }
        if (productId) {
          poItemsData.push({
            product_id: productId,
            product_name: item.name,
            barcode: item.barcode || null,
            unit: item.unit || 'ชิ้น',
            qty: item.qty || 0,
            cost: item.cost || 0,
            subtotal: (item.qty || 0) * (item.cost || 0),
          })
        }
      }

      // 2. สร้าง PO record สถานะ received
      const poTotal = poItemsData.reduce((s, i) => s + i.subtotal, 0)
      const { data: po } = await supabase.from('purchase_orders').insert({
        po_no: genPONo(),
        supplier_id: aiResult?.supplier
          ? (suppliers.find(s => s.name?.includes(aiResult.supplier))?.id || null)
          : null,
        subtotal: poTotal,
        total: poTotal,
        status: 'received',
        received_at: new Date().toISOString(),
        note: aiResult?.invoice_no ? `ใบส่งของ: ${aiResult.invoice_no}` : 'รับจาก AI สแกน',
      }).select('id').single()

      if (po?.id) {
        await supabase.from('po_items').insert(
          poItemsData.map(i => ({ ...i, po_id: po.id }))
        )
      }

      setAiModal(false)
      setAiResult(null)
      setAiReview([])
      setAiError('')
      loadAll()
    } catch (e) {
      setAiError('บันทึกไม่สำเร็จ: ' + e.message)
    } finally {
      setAiLoading(false)
      setAiLoadMsg('')
    }
  }

  function startEditPO(po) {
    setEditForm({ supplier_id: po.supplier_id ? String(po.supplier_id) : '', note: po.note || '' })
    setEditItems((po.po_items || []).map(i => ({
      id: i.id, product_id: String(i.product_id), product_name: i.product_name,
      barcode: i.barcode||'', unit: i.unit||'', qty: i.qty, cost: String(i.cost),
      subtotal: i.subtotal,
    })))
    setView('edit')
  }

  async function saveEditPO() {
    if (editItems.filter(i => i.product_id).length === 0) return alert('ต้องมีสินค้าอย่างน้อย 1 รายการ')
    setSaving(true)
    try {
      const total = editItems.reduce((s,i) => s + parseFloat(i.qty||0)*parseFloat(i.cost||0), 0)
      // Delete old items
      await supabase.from('po_items').delete().eq('po_id', selected.id)
      // Insert new items
      await supabase.from('po_items').insert(
        editItems.filter(i => i.product_id).map(i => ({
          po_id: selected.id,
          product_id: parseInt(i.product_id),
          product_name: i.product_name, barcode: i.barcode, unit: i.unit,
          qty: parseFloat(i.qty)||1, cost: parseFloat(i.cost)||0,
          subtotal: parseFloat(i.qty||0)*parseFloat(i.cost||0),
        }))
      )
      await supabase.from('purchase_orders').update({
        supplier_id: editForm.supplier_id ? parseInt(editForm.supplier_id) : null,
        note: editForm.note||null, total, subtotal: total,
      }).eq('id', selected.id)
      await openDetail({ id: selected.id })
      setView('detail')
    } catch (e) { alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally { setSaving(false) }
  }

  function setEditItemField(idx, field, val) {
    setEditItems(prev => {
      const n = [...prev]
      n[idx] = { ...n[idx], [field]: val }
      if (field === 'product_id') {
        const prod = products.find(p => String(p.id) === val)
        if (prod) n[idx] = { ...n[idx], product_name: prod.name, barcode: prod.barcode||'', unit: prod.unit||'', cost: String(prod.cost||'') }
      }
      return n
    })
  }

  async function deletePO(po) {
    const hasStock = po.status === 'received'
    const msg = hasStock
      ? `ลบ PO ${po.po_no}? เนื่องจากรับสินค้าแล้ว สต็อกจะถูกหักคืนอัตโนมัติ`
      : `ลบ PO ${po.po_no}? การกระทำนี้ไม่สามารถย้อนกลับได้`
    if (!confirm(msg)) return
    setSaving(true)
    try {
      if (hasStock) {
        const { data: items } = await supabase.from('po_items').select('*').eq('po_id', po.id)
        for (const item of (items || [])) {
          if (!item.product_id || !item.qty) continue
          try {
            const { error: rpcErr } = await supabase.rpc('adjust_stock', {
              p_product_id: item.product_id, p_qty_change: -item.qty,
              p_type: 'po_delete', p_ref_id: po.id,
            })
            if (rpcErr) throw rpcErr
          } catch {
            const { data: pd } = await supabase.from('products').select('stock').eq('id', item.product_id).single()
            await supabase.from('products').update({ stock: (pd?.stock || 0) - item.qty }).eq('id', item.product_id)
          }
        }
      }
      await supabase.from('po_items').delete().eq('po_id', po.id)
      await supabase.from('purchase_orders').delete().eq('id', po.id)
      setView('list'); setSelected(null)
      loadAll()
      alert('ลบ PO เรียบร้อย' + (hasStock ? ' และหักคืนสต็อกแล้ว' : ''))
    } catch (e) { alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally { setSaving(false) }
  }

  function openScanReceive() {
    // เตรียมรายการจาก PO items
    setScanItems((selected?.po_items || []).map(i => ({ ...i, received: 0 })))
    setScanInput('')
    setScanReceive(true)
  }

  function handleScan(barcode) {
    const code = barcode.trim()
    if (!code) return
    setScanItems(prev => {
      // หาใน PO items ก่อน
      const idx = prev.findIndex(i => i.barcode === code)
      if (idx >= 0) {
        const n = [...prev]
        n[idx] = { ...n[idx], received: (n[idx].received || 0) + 1 }
        return n
      }
      // ไม่เจอใน PO — หาจาก products แล้วเพิ่มแถวใหม่
      const prod = products.find(p => p.barcode === code)
      if (prod) {
        return [...prev, { product_id: prod.id, product_name: prod.name, barcode: prod.barcode, unit: prod.unit||'', cost: prod.cost||0, qty: 0, received: 1, extra: true }]
      }
      alert(`ไม่พบสินค้า: ${code}`)
      return prev
    })
    setScanInput('')
  }

  async function confirmScanReceive() {
    if (!confirm('ยืนยันรับสินค้าและอัปเดตสต็อก?')) return
    setScanSaving(true)
    try {
      for (const item of scanItems) {
        if (!item.product_id || item.received <= 0) continue
        await supabase.from('products').select('stock').eq('id', item.product_id).single().then(async ({ data }) => {
          await supabase.from('products').update({ stock: (data?.stock || 0) + item.received }).eq('id', item.product_id)
        })
        if (item.id) await supabase.from('po_items').update({ received_qty: item.received }).eq('id', item.id)
      }
      await supabase.from('purchase_orders').update({ status: 'received', received_at: new Date().toISOString() }).eq('id', selected.id)
      setScanReceive(false)
      loadAll()
      openDetail({ id: selected.id })
      alert('รับสินค้าเรียบร้อย สต็อกอัปเดตแล้ว')
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setScanSaving(false)
    }
  }

  function openPrint(po) { setPrintPO(po); setTimeout(() => window.print(), 300) }

  const filtered = pos.filter(p => !filterStatus || p.status === filterStatus)

  // ===== AI Modal (ต้องอยู่ก่อน view checks ทั้งหมด) =====
  if (aiModal) return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col">
        <div className="bg-brand-mid text-white px-4 py-3 flex justify-between items-center rounded-t-2xl">
          <h2 className="font-bold">📸 AI วิเคราะห์ใบส่งของ</h2>
          <button onClick={() => { setAiModal(false); setAiResult(null); setAiReview([]); setAiError('') }} className="text-2xl opacity-70">×</button>
        </div>

        {aiLoading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
            <div className="w-14 h-14 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
            <p className="text-gray-600 text-base font-medium">{aiLoadMsg || 'กำลังประมวลผล...'}</p>
            <p className="text-gray-400 text-xs">อาจใช้เวลา 10-20 วินาที</p>
          </div>
        )}

        {!aiLoading && aiError && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12">
            <div className="text-5xl">⚠️</div>
            <p className="text-red-600 font-semibold text-center">อ่านไม่สำเร็จ</p>
            <p className="text-gray-500 text-xs text-center">{aiError}</p>
            <label className="bg-brand-mid text-white px-5 py-2.5 rounded-xl text-sm font-bold cursor-pointer">
              📷 ลองถ่ายใหม่
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { if(e.target.files[0]) analyzeDelivery(e.target.files[0]) }} />
            </label>
          </div>
        )}

        {!aiLoading && !aiError && aiReview.length > 0 && (
          <>
            {aiResult?.supplier && (
              <div className="px-4 py-2 bg-brand-50 border-b border-brand/10">
                <p className="text-xs text-brand font-medium">ซัพพลายเออร์: {aiResult.supplier}</p>
                {aiResult.invoice_no && <p className="text-xs text-gray-400">เลขที่: {aiResult.invoice_no} · {aiResult.invoice_date||''}</p>}
              </div>
            )}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {aiReview.map((item, idx) => {
                const upd = (patch) => setAiReview(p => { const n=[...p]; n[idx]={...n[idx],...patch}; return n })
                const priceLow = item.cost && item.price && item.price < item.cost*(1+minMargin/100)
                const searchResults = item.searchText
                  ? products.filter(p =>
                      p.name.toLowerCase().includes(item.searchText.toLowerCase()) ||
                      (p.barcode||'').includes(item.searchText)
                    ).slice(0, 6)
                  : []
                return (
                  <div key={idx} className={`px-4 py-3 ${!item.enabled ? 'opacity-40' : ''}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={item.enabled}
                        onChange={e => upd({ enabled: e.target.checked })}
                        className="mt-1 w-4 h-4 accent-brand shrink-0" />
                      <div className="flex-1 min-w-0">

                        {/* ชื่อจาก AI */}
                        <p className="text-sm font-semibold text-gray-800 mb-2">{item.name}
                          {item.unit ? <span className="text-gray-400 font-normal text-xs ml-1">({item.unit})</span> : ''}
                        </p>

                        {/* Mode toggle */}
                        <div className="flex gap-1 mb-2">
                          {['new','search'].map(m => (
                            <button key={m}
                              onClick={() => upd({ mode: m, product_id: m==='new' ? null : item.product_id, matched: m==='new' ? null : item.matched, searchText: '' })}
                              className={`flex-1 py-1 rounded-lg text-xs font-semibold border transition-colors
                                ${item.mode===m ? 'bg-brand text-white border-brand' : 'bg-white text-gray-500 border-gray-200'}`}>
                              {m==='new' ? '✦ เพิ่มสินค้าใหม่' : '🔍 หาสินค้าในระบบ'}
                            </button>
                          ))}
                        </div>

                        {/* Mode: search — ค้นหาสินค้าด้วยตนเอง */}
                        {item.mode === 'search' && (
                          <div className="mb-2">
                            {item.matched ? (
                              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5">
                                <span className="text-green-700 text-xs font-semibold flex-1 truncate">✓ {item.matched.name}</span>
                                <button onClick={() => upd({ matched: null, product_id: null, price: item.price, searchText: '' })}
                                  className="text-gray-400 text-sm shrink-0">×</button>
                              </div>
                            ) : (
                              <div className="relative">
                                <input
                                  type="text"
                                  value={item.searchText}
                                  onChange={e => upd({ searchText: e.target.value })}
                                  placeholder="พิมพ์ชื่อหรือบาร์โค้ดสินค้า..."
                                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-brand outline-none" />
                                {searchResults.length > 0 && (
                                  <div className="absolute z-10 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-36 overflow-y-auto">
                                    {searchResults.map(p => (
                                      <button key={p.id}
                                        onClick={() => upd({
                                          matched: p,
                                          product_id: p.id,
                                          price: p.price || item.price,
                                          searchText: '',
                                        })}
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-brand-50 border-b border-gray-50 last:border-0">
                                        <span className="font-medium text-gray-800">{p.name}</span>
                                        {p.barcode && <span className="text-gray-400 ml-1">({p.barcode})</span>}
                                        <span className="text-brand ml-1">ขาย ฿{fmt(p.price)}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {item.matched && (
                              <p className="text-[10px] text-gray-400 mt-1">
                                สต็อกปัจจุบัน {item.matched.stock ?? 0} → <span className="text-green-600 font-bold">{(item.matched.stock ?? 0) + (item.qty || 0)}</span>
                                {item.matched.cost && item.matched.cost !== item.cost ? ` · ทุนเดิม ฿${fmt(item.matched.cost)}` : ''}
                              </p>
                            )}
                          </div>
                        )}

                        {/* ฟิลด์ตัวเลข */}
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <label className="text-gray-400 block mb-0.5">จำนวน</label>
                            <input type="number" value={item.qty||''} min="0"
                              onChange={e => upd({ qty: parseFloat(e.target.value)||0 })}
                              className="w-full border border-gray-200 rounded px-1 py-1 text-center" />
                          </div>
                          <div>
                            <label className="text-gray-400 block mb-0.5">ทุน ฿</label>
                            <input type="number" value={item.cost||''} min="0" step="0.01"
                              onChange={e => upd({ cost: parseFloat(e.target.value)||0 })}
                              className="w-full border border-gray-200 rounded px-1 py-1 text-center" />
                          </div>
                          <div>
                            <label className="text-gray-400 block mb-0.5">
                              ขาย ฿{priceLow && <span className="text-red-500 ml-1">⚠️</span>}
                            </label>
                            <input type="number" value={item.price||''} min="0" step="0.01"
                              onChange={e => upd({ price: parseFloat(e.target.value)||0 })}
                              className={`w-full border rounded px-1 py-1 text-center ${priceLow ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                            {priceLow && (
                              <button onClick={() => upd({ price: Math.ceil(item.cost*(1+minMargin/100)) })}
                                className="text-[9px] text-brand mt-0.5 block">
                                → ฿{Math.ceil(item.cost*(1+minMargin/100))}
                              </button>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Summary bar */}
            {(() => {
              const belowMargin = aiReview.filter(i => i.enabled && i.cost && i.price && i.price < i.cost*(1+minMargin/100))
              return belowMargin.length > 0 ? (
                <div className="px-4 py-2 bg-red-50 border-t border-red-100 flex justify-between items-center text-xs">
                  <span className="text-red-600 font-medium">⚠️ {belowMargin.length} รายการราคาต่ำกว่า {minMargin}%</span>
                  <button onClick={() => setAiReview(p => p.map(i => {
                    if (!i.enabled || !i.cost) return i
                    const min = Math.ceil(i.cost*(1+minMargin/100))
                    return (!i.price || i.price < min) ? {...i, price: min} : i
                  }))} className="text-brand font-bold">แก้ทั้งหมด</button>
                </div>
              ) : (
                <div className="px-4 py-2 bg-brand-50 border-t border-brand/10 flex justify-between text-xs">
                  <span className="text-brand-mid font-medium">
                    {aiReview.filter(i=>i.enabled && i.mode==='new').length} ใหม่ ·{' '}
                    {aiReview.filter(i=>i.enabled && i.mode==='search' && i.product_id).length} อัปเดต
                  </span>
                  <span className="text-brand-light">✓ ราคาผ่านขั้นต้ำ {minMargin}%</span>
                </div>
              )
            })()}

            <div className="p-3 border-t border-gray-100 flex gap-2">
              <label className="flex-1 border border-brand/30 text-brand py-2.5 rounded-xl text-sm font-medium text-center cursor-pointer">
                📷 ถ่ายใหม่
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => { if(e.target.files[0]) analyzeDelivery(e.target.files[0]) }} />
              </label>
              <button onClick={confirmAiReceive}
                disabled={aiLoading || aiReview.filter(i=>i.enabled).length===0 || aiReview.some(i=>i.enabled&&i.cost&&i.price&&i.price<i.cost*(1+minMargin/100))}
                className="flex-1 bg-brand-mid text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-40">
                ✅ Approve {aiReview.filter(i=>i.enabled).length} รายการ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  // ===== List View =====
  if (view === 'list') return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-heading font-bold text-xl text-brand">📋 ใบสั่งซื้อ (PO)</h1>
        <div className="flex gap-2">
          <label className="bg-brand-mid text-white px-3 py-2 rounded-xl text-sm font-medium shadow active:scale-95 cursor-pointer">
            📸 AI อ่านใบส่งของ
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { if(e.target.files[0]) { setAiModal(true); setAiError(''); analyzeDelivery(e.target.files[0]) } }} />
          </label>
          <button onClick={() => { setItems([addItemRow()]); setView('create') }}
            className="bg-brand text-white px-4 py-2 rounded-xl text-sm font-medium shadow active:scale-95 transition-transform">
            + สร้าง PO ใหม่
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-3 overflow-x-auto scroll-hidden">
        {[['','ทั้งหมด'],['draft','ร่าง'],['ordered','สั่งซื้อ'],['received','รับแล้ว'],['cancelled','ยกเลิก']].map(([v,l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
              ${filterStatus===v ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200'}`}>{l}</button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-gray-50">
          {filtered.map(po => (
            <div key={po.id} className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 cursor-pointer" onClick={() => openDetail(po)}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm text-gray-800">{po.po_no}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOR[po.status]}`}>{STATUS[po.status]}</span>
                </div>
                <p className="text-xs text-gray-400">{po.suppliers?.name || 'ไม่ระบุซัพพลายเออร์'} · {fmtDate(po.created_at)}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-brand text-sm">฿{fmt(po.total)}</p>
                <p className="text-[10px] text-gray-400">→</p>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">ยังไม่มี PO</div>}
        </div>
      </div>
    </div>
  )

  // ===== Create PO View =====
  if (view === 'create') return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setView('list')} className="text-gray-400 text-xl">←</button>
        <h1 className="font-heading font-bold text-xl text-brand">สร้าง PO ใหม่</h1>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm mb-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">ซัพพลายเออร์</label>
            <select value={form.supplier_id} onChange={e => setForm(p=>({...p,supplier_id:e.target.value}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none">
              <option value="">— เลือก —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">หมายเหตุ</label>
            <input value={form.note} onChange={e => setForm(p=>({...p,note:e.target.value}))} placeholder="หมายเหตุ"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-3">
        <div className="px-4 py-3 border-b border-gray-100 flex justify-between">
          <span className="font-semibold text-sm text-gray-700">รายการสินค้า</span>
          <button onClick={() => setItems(p => [...p, addItemRow()])} className="text-brand text-sm">+ เพิ่มแถว</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-500">
              <th className="text-left px-3 py-2 font-medium">สินค้า</th>
              <th className="text-center px-2 py-2 font-medium w-16">จำนวน</th>
              <th className="text-right px-2 py-2 font-medium w-24">ราคาทุน</th>
              <th className="text-right px-2 py-2 font-medium w-24">ราคาขาย</th>
              <th className="text-right px-3 py-2 font-medium w-24">รวม</th>
              <th className="w-8 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item, idx) => {
                const cost = parseFloat(item.cost) || 0
                const price = parseFloat(item.price) || 0
                const minP = cost ? Math.ceil(cost * (1 + minMargin / 100)) : 0
                const priceLow = cost > 0 && price > 0 && price < minP
                return (
                <tr key={idx}>
                  <td className="px-3 py-1.5">
                    <select value={item.product_id} onChange={e => setItemField(idx,'product_id',e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-brand outline-none">
                      <option value="">— เลือกสินค้า —</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={item.qty} min="0"
                      onChange={e => setItemField(idx,'qty',e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={item.cost}
                      onChange={e => setItemField(idx,'cost',e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={item.price||''}
                      onChange={e => setItemField(idx,'price',e.target.value)}
                      placeholder={minP || '0.00'}
                      className={`w-full border rounded-lg px-2 py-1.5 text-xs text-right ${priceLow ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                    {priceLow && (
                      <button onClick={() => setItemField(idx,'price',String(minP))}
                        className="text-[9px] text-brand block w-full text-right mt-0.5">→ {minP}</button>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-medium text-gray-700">
                    ฿{fmt(parseFloat(item.qty||0) * parseFloat(item.cost||0))}
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => setItems(p => p.filter((_,i)=>i!==idx))} className="text-red-300 text-sm">✕</button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-between font-bold">
          <span>รวมทั้งหมด</span>
          <span className="text-brand">฿{fmt(poTotal)}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setView('list')} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl text-sm">ยกเลิก</button>
        <button onClick={savePO} disabled={saving}
          className="flex-1 bg-brand text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 shadow active:scale-95 transition-transform">
          {saving ? 'กำลังบันทึก...' : '💾 บันทึก PO'}
        </button>
      </div>
    </div>
  )

  // ===== Edit PO View =====
  if (view === 'edit' && selected) {
    const editTotal = editItems.reduce((s,i) => s + parseFloat(i.qty||0)*parseFloat(i.cost||0), 0)
    return (
      <div className="max-w-4xl mx-auto px-3 py-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setView('detail')} className="text-gray-400 text-xl">←</button>
          <h1 className="font-heading font-bold text-xl text-amber-600">✏️ แก้ไข {selected.po_no}</h1>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm mb-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">ซัพพลายเออร์</label>
              <select value={editForm.supplier_id} onChange={e => setEditForm(p=>({...p,supplier_id:e.target.value}))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none">
                <option value="">— เลือก —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">หมายเหตุ</label>
              <input value={editForm.note} onChange={e => setEditForm(p=>({...p,note:e.target.value}))} placeholder="หมายเหตุ"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-gray-100 flex justify-between">
            <span className="font-semibold text-sm text-gray-700">รายการสินค้า</span>
            <button onClick={() => setEditItems(p => [...p, addItemRow()])} className="text-brand text-sm">+ เพิ่มแถว</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-3 py-2 font-medium">สินค้า</th>
                <th className="text-center px-2 py-2 font-medium w-20">จำนวน</th>
                <th className="text-right px-3 py-2 font-medium w-28">ราคาทุน</th>
                <th className="text-right px-3 py-2 font-medium w-24">รวม</th>
                <th className="w-8 py-2"></th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {editItems.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-1.5">
                      <select value={item.product_id} onChange={e => setEditItemField(idx,'product_id',e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-brand outline-none">
                        <option value="">— เลือกสินค้า —</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" value={item.qty} min="0"
                        onChange={e => setEditItemField(idx,'qty',e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" value={item.cost}
                        onChange={e => setEditItemField(idx,'cost',e.target.value)}
                        placeholder="0.00"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right" />
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs font-medium text-gray-700">
                      ฿{fmt(parseFloat(item.qty||0) * parseFloat(item.cost||0))}
                    </td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => setEditItems(p => p.filter((_,i)=>i!==idx))} className="text-red-300 text-sm">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 flex justify-between font-bold">
            <span>รวมทั้งหมด</span>
            <span className="text-brand">฿{fmt(editTotal)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setView('detail')} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl text-sm">ยกเลิก</button>
          <button onClick={saveEditPO} disabled={saving}
            className="flex-1 bg-amber-500 text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 shadow active:scale-95">
            {saving ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    )
  }

  // ===== Detail View =====
  const po = selected
  if (view === 'detail' && po) return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => { setView('list'); setSelected(null) }} className="text-gray-400 text-xl">←</button>
        <div className="flex-1">
          <h1 className="font-heading font-bold text-xl text-brand">{po.po_no}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[po.status]}`}>{STATUS[po.status]}</span>
        </div>
        <div className="flex gap-2">
          {po.status === 'draft' && (
            <button onClick={() => updateStatus(po.id,'ordered')}
              className="bg-brand text-white px-3 py-2 rounded-xl text-xs font-medium active:scale-95 transition-transform shadow">
              ยืนยันสั่งซื้อ
            </button>
          )}
          {po.status === 'ordered' && (
            <button onClick={openScanReceive}
              className="bg-green-600 text-white px-3 py-2 rounded-xl text-xs font-medium active:scale-95 transition-transform shadow">
              📦 สแกนรับสินค้า
            </button>
          )}
          {['draft','ordered'].includes(po.status) && (
            <button onClick={() => startEditPO(po)}
              className="bg-amber-500 text-white px-3 py-2 rounded-xl text-xs font-medium active:scale-95">✏️ แก้ไข</button>
          )}
          {['draft','ordered'].includes(po.status) && (
            <button onClick={() => updateStatus(po.id,'cancelled')}
              className="bg-red-500 text-white px-3 py-2 rounded-xl text-xs font-medium">ยกเลิก</button>
          )}
          <button onClick={() => deletePO(po)} disabled={saving}
            className="bg-slate-500 text-white px-3 py-2 rounded-xl text-xs font-medium active:scale-95 disabled:opacity-50">
            🗑️ ลบ
          </button>
          <button onClick={() => openPrint(po)}
            className="bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-xs font-medium active:scale-95">🖨️</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm mb-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-gray-400">ซัพพลายเออร์</p><p className="font-medium">{po.suppliers?.name || '—'}</p></div>
          <div><p className="text-xs text-gray-400">วันที่สร้าง</p><p className="font-medium">{fmtDate(po.created_at)}</p></div>
          {po.ordered_at && <div><p className="text-xs text-gray-400">วันที่สั่งซื้อ</p><p className="font-medium">{fmtDate(po.ordered_at)}</p></div>}
          {po.received_at && <div><p className="text-xs text-gray-400">วันที่รับ</p><p className="font-medium">{fmtDate(po.received_at)}</p></div>}
          {po.note && <div className="col-span-2"><p className="text-xs text-gray-400">หมายเหตุ</p><p>{po.note}</p></div>}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-3">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-xs text-gray-500">
            <th className="text-left px-4 py-2 font-medium">สินค้า</th>
            <th className="text-center px-3 py-2 font-medium">จำนวน</th>
            <th className="text-right px-3 py-2 font-medium">ราคาทุน</th>
            <th className="text-right px-4 py-2 font-medium">รวม</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {(po.po_items || []).map(i => (
              <tr key={i.id}>
                <td className="px-4 py-2">
                  <p className="font-medium text-gray-800">{i.product_name}</p>
                  <p className="text-[10px] text-gray-400">{i.barcode}</p>
                </td>
                <td className="px-3 py-2 text-center">{i.qty} {i.unit}</td>
                <td className="px-3 py-2 text-right">฿{fmt(i.cost)}</td>
                <td className="px-4 py-2 text-right font-semibold text-brand">฿{fmt(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-between font-bold">
          <span>รวมทั้งหมด</span>
          <span className="text-brand text-lg">฿{fmt(po.total)}</span>
        </div>
      </div>

      {/* Print PO button for barcode labels from PO */}
      {po.status === 'received' && (
        <button onClick={() => {
          const items = (po.po_items || []).filter(i => i.barcode)
          if (items.length === 0) return alert('ไม่มีสินค้าที่มีบาร์โค้ด')
          const size = { w:58, h:30 }
          const win = window.open('', '_blank', 'width=600,height=800')
          if (!win) return
          win.document.write(buildPOLabelHTML(items, size))
          win.document.close()
          setTimeout(() => win.print(), 600)
        }} className="w-full bg-amber-500 text-white py-3 rounded-xl text-sm font-bold active:scale-95 transition-transform shadow">
          🏷️ ปริ้นสติ๊กเกอร์บาร์โค้ดจาก PO นี้
        </button>
      )}

      {/* ── Scan Receive Modal ── */}
      {scanReceive && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-0">
          <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="bg-green-600 text-white px-4 py-3 flex justify-between items-center rounded-t-2xl">
              <h2 className="font-bold">📦 สแกนรับสินค้า</h2>
              <button onClick={() => setScanReceive(false)} className="text-2xl opacity-70">×</button>
            </div>

            {/* Scan input */}
            <div className="p-3 border-b border-gray-100">
              <input
                autoFocus
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { handleScan(scanInput); e.preventDefault() } }}
                placeholder="สแกนบาร์โค้ด หรือพิมพ์แล้วกด Enter"
                className="w-full border-2 border-green-400 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-green-600"
              />
              <p className="text-xs text-gray-400 mt-1 text-center">สแกนบาร์โค้ดจากใบส่งของ — ระบบจะนับจำนวนให้อัตโนมัติ</p>
            </div>

            {/* Item list */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {scanItems.map((item, idx) => (
                <div key={idx} className={`flex items-center gap-3 px-4 py-2.5 ${item.extra ? 'bg-yellow-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
                    <p className="text-[10px] text-gray-400">{item.barcode} {item.extra && '⚠️ ไม่อยู่ใน PO'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">สั่ง {item.qty || '—'}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setScanItems(p => { const n=[...p]; n[idx]={...n[idx],received:Math.max(0,(n[idx].received||0)-1)}; return n })}
                        className="w-7 h-7 bg-gray-100 rounded-lg text-lg font-bold text-gray-600">−</button>
                      <span className={`w-10 text-center font-bold text-sm ${item.received > 0 ? 'text-green-600' : 'text-gray-300'}`}>{item.received || 0}</span>
                      <button onClick={() => setScanItems(p => { const n=[...p]; n[idx]={...n[idx],received:(n[idx].received||0)+1}; return n })}
                        className="w-7 h-7 bg-green-100 rounded-lg text-lg font-bold text-green-600">+</button>
                    </div>
                  </div>
                </div>
              ))}
              {scanItems.length === 0 && <p className="text-center text-gray-400 text-sm py-8">เริ่มสแกนบาร์โค้ดจากใบส่งของ</p>}
            </div>

            <div className="p-3 border-t border-gray-100 flex gap-2">
              <button onClick={() => setScanReceive(false)} className="flex-1 btn-secondary">ยกเลิก</button>
              <button onClick={confirmScanReceive} disabled={scanSaving || scanItems.every(i => !i.received)}
                className="flex-1 bg-green-600 text-white py-3 rounded-xl text-sm font-bold disabled:opacity-40">
                {scanSaving ? 'กำลังบันทึก...' : `✓ ยืนยันรับ (${scanItems.reduce((s,i)=>s+(i.received||0),0)} ชิ้น)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ── AI Modal ──
  return null
}

function addItemRow() {
  return { product_id:'', product_name:'', barcode:'', unit:'', qty:1, cost:'', price:'', subtotal:0 }
}

function buildPOLabelHTML(items, size) {
  const labels = items.flatMap(i =>
    Array(Math.ceil(i.qty)).fill(i).map(i => `
      <div class="label">
        <div class="pname">${i.product_name}</div>
        <svg class="bc" data-barcode="${i.barcode}"></svg>
        <div class="price">ทุน ฿${Number(i.cost).toFixed(2)}</div>
      </div>`)
  ).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Kanit',sans-serif}
    .labels{display:flex;flex-wrap:wrap;gap:2mm;padding:2mm}
    .label{width:${size.w}mm;height:${size.h}mm;border:0.5px dashed #ccc;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1mm;overflow:hidden}
    .pname{font-size:7px;text-align:center;line-height:1.2;max-height:14px;overflow:hidden;margin-bottom:1mm}
    .bc{max-width:100%;max-height:14mm}
    .price{font-size:8px;font-weight:bold;margin-top:0.5mm}
    @media print{.label{border-color:transparent}}
  </style></head><body>
  <div class="labels">${labels}</div>
  <script>
    document.querySelectorAll('[data-barcode]').forEach(el => {
      try { JsBarcode(el, el.dataset.barcode, { format:'CODE128', width:1.2, height:28, displayValue:true, fontSize:7, margin:0 }) } catch(e){}
    })
    window.onload = () => window.print()
  </script></body></html>`
}
