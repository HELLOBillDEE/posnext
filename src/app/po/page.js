'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDate, genPONo } from '@/lib/utils'

const STATUS = { draft:'ร่าง', ordered:'สั่งซื้อแล้ว', received:'รับสินค้าแล้ว', cancelled:'ยกเลิก' }

function genCKBarcode() {
  const num = Math.floor(Math.random() * 100000000).toString().padStart(8, '0')
  return 'CK' + num
}

async function genUniqueCKBarcode(supabase) {
  let code, exists
  do {
    code = genCKBarcode()
    const { data } = await supabase.from('products').select('id').eq('barcode', code).maybeSingle()
    exists = !!data
  } while (exists)
  return code
}

const LABEL_SIZES = [
  { id:'100x25x3', pw:100, ph:25, cols:3, lw:30, hGap:5, vGap:2, mx:0, my:0 },
  { id:'58x30',    pw:58,  ph:30, cols:1, lw:54, hGap:0, vGap:2, mx:2, my:2 },
  { id:'40x25',    pw:40,  ph:25, cols:1, lw:36, hGap:0, vGap:2, mx:2, my:2 },
]
const STATUS_COLOR = { draft:'bg-gray-100 text-gray-600', ordered:'bg-brand-50 text-brand-mid', received:'bg-green-100 text-green-700', cancelled:'bg-red-100 text-red-500' }

export default function POPage() {
  const [pos, setPOs]             = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts]   = useState([])
  const [labelSize, setLabelSize] = useState('100x25x3')
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
  const [printConfirm, setPrintConfirm] = useState(null)  // items to print
  const [newProdModal, setNewProdModal] = useState(null)  // { idx, forEdit } | null
  const [categories, setCategories]   = useState([])
  const [aiModal, setAiModal]        = useState(false)
  const [aiLoading, setAiLoading]    = useState(false)
  const [aiLoadMsg, setAiLoadMsg]    = useState('')
  const [aiError, setAiError]        = useState('')
  const [aiResult, setAiResult]      = useState(null)
  const [aiReview, setAiReview]      = useState([])
  const [aiDone, setAiDone]          = useState([])     // items ที่ save แล้ว สำหรับปริ้น

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: p }, { data: s }, { data: pr }, { data: cfg }, { data: cats }] = await Promise.all([
      supabase.from('purchase_orders').select('*, suppliers(name), po_items(count)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('id,name,barcode,unit,cost,price').eq('active',true).order('name'),
      supabase.from('settings').select('key,value').in('key', ['min_margin', 'label_size', 'printer_barcode']),
      supabase.from('categories').select('id,name').order('name'),
    ])
    setPOs(p || [])
    setSuppliers(s || [])
    setProducts(pr || [])
    setCategories(cats || [])
    const cfgMap = Object.fromEntries((cfg || []).map(r => [r.key, r.value]))
    if (cfgMap.min_margin)  setMinMargin(parseFloat(cfgMap.min_margin) || 30)
    if (cfgMap.label_size)  setLabelSize(cfgMap.label_size)
    if (cfgMap.printer_barcode) {
      localStorage.setItem('printer_barcode', cfgMap.printer_barcode)
    }
  }

  async function openDetail(po) {
    const { data } = await supabase.from('purchase_orders')
      .select('*, suppliers(name), po_items(*, products(name,price))')
      .eq('id', po.id).single()
    // auto-assign CK barcode ให้สินค้าที่ยังไม่มี
    if (data?.po_items) {
      for (const item of data.po_items) {
        if (!item.barcode) {
          const newBarcode = await genUniqueCKBarcode(supabase)
          await supabase.from('po_items').update({ barcode: newBarcode }).eq('id', item.id)
          if (item.product_id) await supabase.from('products').update({ barcode: newBarcode }).eq('id', item.product_id)
          item.barcode = newBarcode
        }
      }
    }
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
        if (!n[idx].price || parseFloat(n[idx].price) === 0) {
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
    if (!form.supplier_id) return alert('กรุณาเลือกเจ้าหนี้ / ซัพพลายเออร์')
    const validItems = items.filter(i => i.product_id)
    if (validItems.length === 0) return alert('กรุณาเพิ่มรายการสินค้า')
    const belowMin = validItems.filter(i => {
      const c = parseFloat(i.cost) || 0
      const p = parseFloat(i.price) || 0
      return c > 0 && p < c * (1 + minMargin / 100)
    })
    if (belowMin.length > 0 && !confirm(`ราคาขายต่ำกว่า ${minMargin}% จำนวน ${belowMin.length} รายการ\nต้องการบันทึกต่อไหม?`)) return
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

      const reviewed = await Promise.all((data.items || []).map(async ai => {
        // แปลงหน่วย "X ลัง-Y" → จำนวนหน่วยปลีก X*Y
        let qty = ai.qty || 0
        let unit = ai.unit || 'ชิ้น'
        let total = ai.total || 0
        let langConverted = false
        const langMatch = unit.match(/^ลัง[-–](\d+)$/i) || String(ai.qty || '').match(/(\d+)\s*ลัง[-–](\d+)/i)
        if (langMatch) {
          if (langMatch[2]) {
            // "X ลัง-Y" ใน qty field
            qty = parseInt(langMatch[1]) * parseInt(langMatch[2])
          } else {
            // "ลัง-Y" ใน unit field, qty = จำนวนลัง
            qty = (ai.qty || 1) * parseInt(langMatch[1])
          }
          unit = 'ชิ้น'
          langConverted = true
        }
        // ถ้าแปลงจากลัง ให้คำนวณราคาต่อหน่วยปลีกจาก total/qty เสมอ
        const aiCost = langConverted
          ? (total && qty ? total / qty : null)
          : (ai.unit_cost || (total && qty ? total / qty : null))
        const minPrice = aiCost ? Math.ceil(aiCost * (1 + minMargin / 100)) : null
        return {
          ...ai,
          qty,
          unit,
          barcode: ai.barcode || await genUniqueCKBarcode(supabase),
          mode: 'new',
          product_id: null,
          matched: null,
          cost: aiCost,
          price: minPrice,
          searchText: '',
          enabled: true,
        }
      }))
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

      setAiDone(toProcess.map(i => ({
        name: i.mode === 'search' && i.matched?.name ? i.matched.name : i.name,
        barcode: i.mode === 'search' && i.matched?.barcode ? i.matched.barcode : (i.barcode || ''),
        price: i.price || i.matched?.price || 0,
        cost: i.cost || 0,
        qty: i.qty || 1,
        product_id: i.mode === 'search' ? i.product_id : null,
      })))
      setAiReview([])
      setAiResult(null)
      setAiError('')
      loadAll()
    } catch (e) {
      setAiError('บันทึกไม่สำเร็จ: ' + e.message)
    } finally {
      setAiLoading(false)
      setAiLoadMsg('')
    }
  }

  async function openPrintConfirm(items) {
    const filled = await Promise.all(items.map(async i => {
      if (i.barcode) return i
      const newBarcode = await genUniqueCKBarcode(supabase)
      // บันทึกบาร์โค้ดใหม่ลง products และ po_items
      if (i.product_id) await supabase.from('products').update({ barcode: newBarcode }).eq('id', i.product_id)
      if (i.po_item_id) await supabase.from('po_items').update({ barcode: newBarcode }).eq('id', i.po_item_id)
      return { ...i, barcode: newBarcode }
    }))
    setPrintConfirm(filled)
  }

  async function printAiLabels(items) {
    setPrintConfirm(null)
    // บันทึกบาร์โค้ดทั้งหมดก่อนปริ้น — ใช้ product_id ตรงๆ หรือหาจาก po_items เป็น fallback
    await Promise.all(items.map(async i => {
      if (!i.barcode) return
      let pid = i.product_id || null
      // ถ้าไม่มี product_id ให้ดึงจาก po_items
      if (!pid && i.po_item_id) {
        const { data: poi } = await supabase.from('po_items').select('product_id').eq('id', i.po_item_id).maybeSingle()
        pid = poi?.product_id || null
      }
      if (pid) await supabase.from('products').update({ barcode: i.barcode }).eq('id', pid)
      if (i.po_item_id) await supabase.from('po_items').update({ barcode: i.barcode }).eq('id', i.po_item_id)
    }))
    const size = LABEL_SIZES.find(s => s.id === labelSize) || LABEL_SIZES[0]
    const printItems = items.flatMap(i => Array(Math.max(1, parseInt(i.qty) || 3)).fill({ name: i.name, barcode: i.barcode, price: i.price }))
    const saved = JSON.parse(localStorage.getItem('printer_barcode') || '{}')
    const cfg = { ip: '192.168.2.49', port: 9100, paper_width: 100, lang: 'tspl', bridge_url: window.location.origin, ...saved }
    if (!cfg.ip) return alert('ไม่พบการตั้งค่าเครื่องพิมพ์บาร์โค้ด กรุณาตั้งค่าที่หน้าตั้งค่า')
    try {
      const { buildLabelTSPL, buildLabelESCPOS, printViaBridge } = await import('@/lib/printBridge')
      const bytes = cfg.lang === 'tspl'
        ? await buildLabelTSPL(printItems, size)
        : await buildLabelESCPOS(printItems, size, parseInt(cfg.paper_width) || 100)
      await printViaBridge(cfg.bridge_url, cfg.ip, parseInt(cfg.port) || 9100, bytes)
    } catch (e) {
      alert('พิมพ์ไม่สำเร็จ: ' + e.message)
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
    if (!editForm.supplier_id) return alert('กรุณาเลือกเจ้าหนี้ / ซัพพลายเออร์')
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

  async function onNewProdCreated(prod) {
    // โหลด products ใหม่แล้วเลือก product ที่สร้างเข้า item row
    const { data: pr } = await supabase.from('products').select('id,name,barcode,unit,cost,price').eq('active',true).order('name')
    setProducts(pr || [])
    const { idx, forEdit } = newProdModal
    const setter = forEdit ? setEditItems : setItems
    setter(prev => {
      const n = [...prev]
      n[idx] = { ...n[idx], product_id: String(prod.id), product_name: prod.name, barcode: prod.barcode||'', unit: prod.unit||'', cost: String(prod.cost||''), price: String(prod.price||'') }
      return n
    })
    setNewProdModal(null)
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

  // ===== Print Confirm (ต้องอยู่ก่อน aiModal — ใช้เมื่อไม่ได้อยู่ใน detail view) =====
  if (printConfirm && view !== 'detail') return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
        <div className="bg-amber-500 text-white px-4 py-3 flex justify-between items-center rounded-t-2xl">
          <h2 className="font-bold">🏷️ ยืนยันปริ้นสติ๊กเกอร์</h2>
          <button onClick={() => setPrintConfirm(null)} className="text-2xl opacity-70">×</button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {printConfirm.map((item, idx) => (
            <div key={idx} className="px-4 py-2.5">
              <p className="text-sm font-medium text-gray-800 mb-1">{item.name}</p>
              {item.dupError && <p className="text-[10px] text-red-500 mb-1">⚠️ {item.dupError}</p>}
              <div className="flex items-center gap-2">
                <input type="text" value={item.barcode || ''}
                  onChange={e => setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],barcode:e.target.value,dupError:''}; return n })}
                  onBlur={async e => {
                    const val = e.target.value.trim()
                    if (!val) return
                    const dupInModal = printConfirm.some((it, i) => i !== idx && it.barcode === val)
                    if (dupInModal) { setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],dupError:'ซ้ำกับรายการอื่นใน PO นี้'}; return n }); return }
                    const { data: existing } = await supabase.from('products').select('id,name').eq('barcode', val).neq('id', item.product_id || 0).maybeSingle()
                    if (existing) { setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],dupError:`ซ้ำกับ: ${existing.name}`}; return n }); return }
                    setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],dupError:''}; return n })
                    if (item.product_id) await supabase.from('products').update({ barcode: val }).eq('id', item.product_id)
                    if (item.po_item_id) await supabase.from('po_items').update({ barcode: val }).eq('id', item.po_item_id)
                  }}
                  className={`flex-1 border rounded-lg px-2 py-1 text-xs font-mono focus:border-brand outline-none ${item.dupError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`} />
                <button onClick={async () => {
                  const nb = await genUniqueCKBarcode(supabase)
                  setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],barcode:nb,dupError:''}; return n })
                }} className="text-[10px] text-brand border border-brand/30 rounded px-1.5 py-1 shrink-0">สุ่ม</button>
                <input type="number" value={item.qty||1} min="1"
                  onChange={e => setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],qty:parseInt(e.target.value)||1}; return n })}
                  className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-xs text-center focus:border-brand outline-none" />
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
          <span className="text-sm text-gray-500">รวม <span className="font-bold text-gray-800">{printConfirm.reduce((s,i)=>s+(parseInt(i.qty)||1),0)}</span> ดวง</span>
        </div>
        <div className="p-3 border-t border-gray-100 flex gap-2">
          <button onClick={() => setPrintConfirm(null)} className="flex-1 btn-secondary">ยกเลิก</button>
          <button onClick={() => printAiLabels(printConfirm)}
            disabled={printConfirm.some(i => i.dupError)}
            className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl text-sm font-bold active:scale-95 disabled:opacity-40">
            🖨️ ปริ้นเลย {printConfirm.reduce((s,i)=>s+(parseInt(i.qty)||1),0)} ดวง
          </button>
        </div>
      </div>
    </div>
  )

  // ===== AI Modal =====
  if (aiModal) return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col">
        <div className="bg-brand-mid text-white px-4 py-3 flex justify-between items-center rounded-t-2xl">
          <h2 className="font-bold">📸 AI วิเคราะห์ใบส่งของ</h2>
          <button onClick={() => { setAiModal(false); setAiResult(null); setAiReview([]); setAiError('') }} className="text-2xl opacity-70">×</button>
        </div>

        {/* หน้าหลัง approve — ปริ้นสติ๊กเกอร์ */}
        {!aiLoading && aiDone.length > 0 && aiReview.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-10">
            <div className="text-5xl">✅</div>
            <p className="font-bold text-gray-800">บันทึกแล้ว {aiDone.length} รายการ</p>
            <p className="text-xs text-gray-400 text-center">ต้องการปริ้นสติ๊กเกอร์บาร์โค้ด<br/>3 ดวงต่อสินค้า (100×25 mm)?</p>
            <button onClick={() => openPrintConfirm(aiDone)}
              className="bg-brand text-white px-6 py-3 rounded-xl font-bold text-sm shadow active:scale-95">
              🏷️ ปริ้นสติ๊กเกอร์ {aiDone.reduce((s,i)=>s+(parseInt(i.qty)||1),0)} ดวง
            </button>
            <button onClick={() => { setAiModal(false); setAiDone([]) }}
              className="text-gray-400 text-sm">ข้ามไปก่อน</button>
          </div>
        )}

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

                        {/* ชื่อจาก AI — แก้ได้เมื่อ mode=new */}
                        {item.mode === 'new' ? (
                          <input
                            type="text"
                            value={item.name || ''}
                            onChange={e => upd({ name: e.target.value })}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-semibold text-gray-800 focus:border-brand outline-none mb-2"
                            placeholder="ชื่อสินค้า"
                          />
                        ) : (
                          <p className="text-sm font-semibold text-gray-800 mb-2">{item.name}
                            {item.unit ? <span className="text-gray-400 font-normal text-xs ml-1">({item.unit})</span> : ''}
                          </p>
                        )}

                        {/* Barcode — mode new เท่านั้น */}
                        {item.mode === 'new' && (
                          <div className="flex items-center gap-1 mb-2">
                            <input
                              type="text"
                              value={item.barcode || ''}
                              onChange={e => upd({ barcode: e.target.value })}
                              className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-500 focus:border-brand outline-none font-mono"
                              placeholder="บาร์โค้ด"
                            />
                            <button onClick={async () => upd({ barcode: await genUniqueCKBarcode(supabase) })}
                              className="text-[10px] text-brand border border-brand/30 rounded px-1.5 py-1 shrink-0">
                              สุ่มใหม่
                            </button>
                          </div>
                        )}

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
                                className="text-[9px] text-red-500 mt-0.5 block">
                                → ฿{Math.ceil(item.cost*(1+minMargin/100))}
                              </button>
                            )}
                            {item.cost > 0 && (
                              <button onClick={() => upd({ price: Math.ceil(item.cost*1.35) })}
                                className="text-[9px] text-brand mt-0.5 block">
                                +35% = ฿{Math.ceil(item.cost*1.35)}
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
                disabled={aiLoading || aiReview.filter(i=>i.enabled).length===0}
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
                    <div className="flex gap-1">
                      <select value={item.product_id} onChange={e => setItemField(idx,'product_id',e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-brand outline-none min-w-0">
                        <option value="">— เลือกสินค้า —</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <button onClick={() => setNewProdModal({ idx, forEdit: false })}
                        title="เพิ่มสินค้าใหม่"
                        className="shrink-0 px-2 py-1 bg-brand text-white text-[10px] font-bold rounded-lg active:scale-95">✦</button>
                    </div>
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
                        className="text-[9px] text-red-500 block w-full text-right mt-0.5">→ {minP}</button>
                    )}
                    {cost > 0 && (
                      <button onClick={() => setItemField(idx,'price',String(Math.ceil(cost*1.35)))}
                        className="text-[9px] text-brand block w-full text-right mt-0.5">+35% = ฿{Math.ceil(cost*1.35)}</button>
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

      {newProdModal && !newProdModal.forEdit && (
        <NewProductModal categories={categories} onCreated={onNewProdCreated} onClose={() => setNewProdModal(null)} />
      )}
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
                      <div className="flex gap-1">
                        <select value={item.product_id} onChange={e => setEditItemField(idx,'product_id',e.target.value)}
                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-brand outline-none min-w-0">
                          <option value="">— เลือกสินค้า —</option>
                          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <button onClick={() => setNewProdModal({ idx, forEdit: true })}
                          title="เพิ่มสินค้าใหม่"
                          className="shrink-0 px-2 py-1 bg-brand text-white text-[10px] font-bold rounded-lg active:scale-95">✦</button>
                      </div>
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

        {newProdModal && newProdModal.forEdit && (
          <NewProductModal categories={categories} onCreated={onNewProdCreated} onClose={() => setNewProdModal(null)} />
        )}
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

      {/* ปริ้นสติ๊กเกอร์บาร์โค้ดจาก PO */}
      {(po.po_items||[]).some(i => i.barcode) && (
        <button onClick={() => openPrintConfirm(
          (po.po_items||[]).filter(i => i.barcode).map(i => ({
            name: i.product_name, barcode: i.barcode, price: i.products?.price ?? i.cost, qty: i.qty, product_id: i.product_id, po_item_id: i.id,
          }))
        )} className="w-full bg-amber-500 text-white py-3 rounded-xl text-sm font-bold active:scale-95 transition-transform shadow">
          🏷️ ปริ้นสติ๊กเกอร์บาร์โค้ด ({(po.po_items||[]).filter(i=>i.barcode).reduce((s,i)=>s+(parseInt(i.qty)||1),0)} ดวง)
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

      {/* Print Confirm Modal */}
      {printConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
          <div className="bg-white rounded-t-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
            <div className="bg-amber-500 text-white px-4 py-3 flex justify-between items-center rounded-t-2xl">
              <h2 className="font-bold">🏷️ ยืนยันปริ้นสติ๊กเกอร์</h2>
              <button onClick={() => setPrintConfirm(null)} className="text-2xl opacity-70">×</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {printConfirm.map((item, idx) => (
                <div key={idx} className="px-4 py-2.5">
                  <p className="text-sm font-medium text-gray-800 mb-1">{item.name}</p>
                  {item.dupError && <p className="text-[10px] text-red-500 mb-1">⚠️ {item.dupError}</p>}
                  <div className="flex items-center gap-2">
                    <input type="text" value={item.barcode || ''}
                      onChange={e => setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],barcode:e.target.value,dupError:''}; return n })}
                      onBlur={async e => {
                        const val = e.target.value.trim()
                        if (!val) return
                        // ตรวจซ้ำใน modal เดียวกัน
                        const dupInModal = printConfirm.some((it, i) => i !== idx && it.barcode === val)
                        if (dupInModal) {
                          setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],dupError:'ซ้ำกับรายการอื่นใน PO นี้'}; return n })
                          return
                        }
                        // ตรวจซ้ำใน products DB
                        const { data: existing } = await supabase.from('products').select('id,name').eq('barcode', val).neq('id', item.product_id || 0).maybeSingle()
                        if (existing) {
                          setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],dupError:`ซ้ำกับ: ${existing.name}`}; return n })
                          return
                        }
                        setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],dupError:''}; return n })
                        if (item.product_id) await supabase.from('products').update({ barcode: val }).eq('id', item.product_id)
                        if (item.po_item_id) await supabase.from('po_items').update({ barcode: val }).eq('id', item.po_item_id)
                      }}
                      className={`flex-1 border rounded-lg px-2 py-1 text-xs font-mono focus:border-brand outline-none ${item.dupError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`} />
                    <button onClick={async () => {
                      const nb = await genUniqueCKBarcode(supabase)
                      setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],barcode:nb,dupError:''}; return n })
                    }} className="text-[10px] text-brand border border-brand/30 rounded px-1.5 py-1 shrink-0">สุ่ม</button>
                    <input type="number" min="1" value={item.qty || 1}
                      onChange={e => setPrintConfirm(p => { const n=[...p]; n[idx]={...n[idx],qty:parseInt(e.target.value)||1}; return n })}
                      className="w-12 border border-gray-200 rounded-lg px-1 py-1 text-sm text-center focus:border-brand outline-none" />
                    <span className="text-xs text-gray-400 shrink-0">ดวง</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <span className="text-sm text-gray-500">รวม <span className="font-bold text-gray-800">{printConfirm.reduce((s,i)=>s+(parseInt(i.qty)||1),0)}</span> ดวง</span>
            </div>
            <div className="p-3 border-t border-gray-100 flex gap-2">
              <button onClick={() => setPrintConfirm(null)} className="flex-1 btn-secondary">ยกเลิก</button>
              <button onClick={() => printAiLabels(printConfirm)}
                disabled={printConfirm.some(i => i.dupError)}
                className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl text-sm font-bold active:scale-95 disabled:opacity-40">
                🖨️ ปริ้นเลย {printConfirm.reduce((s,i)=>s+(parseInt(i.qty)||1),0)} ดวง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return null
}

function NewProductModal({ categories, onCreated, onClose }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('ชิ้น')
  const [barcode, setBarcode] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [catId, setCatId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    genUniqueCKBarcode(supabase).then(b => setBarcode(b))
  }, [])

  async function save() {
    if (!name.trim()) { alert('กรุณากรอกชื่อสินค้า'); return }
    if (!price) { alert('กรุณากรอกราคาขาย'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.from('products').insert({
        name: name.trim(),
        barcode: barcode || null,
        unit: unit || 'ชิ้น',
        cost: parseFloat(cost) || 0,
        price: parseFloat(price) || 0,
        stock: 0,
        min_stock: 5,
        active: true,
        category_id: catId ? parseInt(catId) : null,
      }).select().single()
      if (error) throw error
      onCreated(data)
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3.5" style={{ background: '#C72C41' }}>
          <h2 className="font-bold text-base text-white">✦ เพิ่มสินค้าใหม่</h2>
          <button onClick={onClose} className="text-2xl opacity-70 leading-none text-white">×</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">บาร์โค้ด CK</label>
            <div className="flex gap-2">
              <input value={barcode} onChange={e => setBarcode(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:border-brand outline-none" />
              <button type="button" onClick={async () => setBarcode(await genUniqueCKBarcode(supabase))}
                className="shrink-0 px-3 py-2 bg-brand/10 text-brand text-xs font-bold rounded-xl border border-brand/20 hover:bg-brand/20 whitespace-nowrap">
                🎲 สุ่ม
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">ชื่อสินค้า *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อสินค้า" autoFocus
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">หมวดหมู่</label>
              <select value={catId} onChange={e => setCatId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none">
                <option value="">— ไม่ระบุ —</option>
                {(categories||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">หน่วย</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ชิ้น"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">ราคาทุน (฿)</label>
              <input type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">ราคาขาย (฿) *</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
          </div>
          {cost && !price && parseFloat(cost) > 0 && (
            <button type="button" onClick={() => setPrice(String(Math.ceil(parseFloat(cost) * 1.35)))}
              className="text-[10px] text-brand -mt-1 hover:underline">
              แนะนำ +35% = ฿{Math.ceil(parseFloat(cost) * 1.35)}
            </button>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-2xl text-sm font-semibold">
              ยกเลิก
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="flex-1 text-white py-3 rounded-2xl text-sm font-bold disabled:opacity-50 shadow active:scale-95"
              style={{ background: '#C72C41' }}>
              {saving ? '⏳ กำลังบันทึก...' : '+ เพิ่มสินค้า'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
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
