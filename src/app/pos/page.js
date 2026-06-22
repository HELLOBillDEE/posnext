'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { convertThaiBarcode, fmt, genReceiptNo } from '@/lib/utils'
import { printViaBridge, buildReceiptESCPOS, kickDrawerViaBridge } from '@/lib/printBridge'
import { syncSaleToBillDee } from '@/lib/billdeeSyncClient'
import { buildFormalDocHTML, getNextDocNo } from '@/lib/docBuilder'

// HID keyboard usage-code → ASCII char
const HID_KEY = {
  0x04:'a',0x05:'b',0x06:'c',0x07:'d',0x08:'e',0x09:'f',0x0A:'g',0x0B:'h',
  0x0C:'i',0x0D:'j',0x0E:'k',0x0F:'l',0x10:'m',0x11:'n',0x12:'o',0x13:'p',
  0x14:'q',0x15:'r',0x16:'s',0x17:'t',0x18:'u',0x19:'v',0x1A:'w',0x1B:'x',
  0x1C:'y',0x1D:'z',
  0x1E:'1',0x1F:'2',0x20:'3',0x21:'4',0x22:'5',0x23:'6',0x24:'7',0x25:'8',0x26:'9',0x27:'0',
  0x28:'\n',0x2C:' ',0x2D:'-',0x2E:'=',0x2F:'[',0x30:']',0x31:'\\',
  0x33:';',0x34:"'",0x35:'`',0x36:',',0x37:'.',0x38:'/',
}
const HID_SHIFT = {
  0x1E:'!',0x1F:'@',0x20:'#',0x21:'$',0x22:'%',0x23:'^',0x24:'&',0x25:'*',0x26:'(',0x27:')',
  0x2D:'_',0x2E:'+',0x2F:'{',0x30:'}',0x31:'|',0x33:':',0x34:'"',0x35:'~',0x36:'<',0x37:'>',0x38:'?',
  0x04:'A',0x05:'B',0x06:'C',0x07:'D',0x08:'E',0x09:'F',0x0A:'G',0x0B:'H',
  0x0C:'I',0x0D:'J',0x0E:'K',0x0F:'L',0x10:'M',0x11:'N',0x12:'O',0x13:'P',
  0x14:'Q',0x15:'R',0x16:'S',0x17:'T',0x18:'U',0x19:'V',0x1A:'W',0x1B:'X',
  0x1C:'Y',0x1D:'Z',
}

const PAY_METHODS = [
  { id:'cash',     label:'เงินสด', icon:'💵' },
  { id:'transfer', label:'โอน',    icon:'📱' },
  { id:'qr',       label:'QR',     icon:'🔲' },
  { id:'credit',   label:'เชื่อ',  icon:'📝' },
]

const QUICK_CASH = [20, 50, 100, 500, 1000]

export default function POSPage() {
  const [products, setProducts]     = useState([])
  const [categories, setCategories] = useState([])
  const [settings, setSettings]     = useState({})
  const [cart, setCart]             = useState([])
  const [search, setSearch]         = useState('')
  const [activeCat, setActiveCat]   = useState(null)
  const [showPay, setShowPay]       = useState(false)
  const [payMethod, setPayMethod]   = useState('cash')
  const [payAmount, setPayAmount]   = useState('')
  const [billDiscount, setBillDiscount] = useState('')
  const [note, setNote]             = useState('')
  const [saving, setSaving]         = useState(false)
  const [lastDone, setLastDone]     = useState(null)
  const [numpad, setNumpad]         = useState(null) // { idx, field, value }
  const [customer, setCustomer]     = useState(null)  // { id, name, phone }
  const [showCustModal, setShowCustModal] = useState(false)
  const [showDocModal, setShowDocModal] = useState(false)
  const [shift, setShift]           = useState(null)   // current open shift
  const [showShiftModal, setShowShiftModal] = useState(false)
  const [shiftModalMode, setShiftModalMode] = useState('open') // 'open' | 'close'
  // Web HID scanner
  const [hidDevice, setHidDevice]   = useState(null)
  const [hidError, setHidError]     = useState('')
  const inputRef   = useRef(null)
  const hidBuffer  = useRef('')
  const hidTimer   = useRef(null)
  const physBuf    = useRef({ chars: '', t0: 0 })
  // Refs สำหรับ global scanner listener (ไม่ต้อง re-register ตอน state เปลี่ยน)
  const productsRef = useRef([])
  const showPayRef  = useRef(false)
  useEffect(() => { productsRef.current = products }, [products])
  useEffect(() => { showPayRef.current  = showPay  }, [showPay])

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (!showPay) setTimeout(() => inputRef.current?.focus(), 100) }, [showPay])

  // Cleanup HID on unmount
  useEffect(() => () => { if (hidDevice?.opened) hidDevice.close() }, [hidDevice])


  async function loadData() {
    const [{ data: prods, error: prodErr }, { data: cats }, { data: cfg }] = await Promise.all([
      supabase.from('products').select('*, categories(name)').eq('active', true).order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('settings').select('*'),
    ])
    if (prodErr) console.error('❌ products error:', prodErr)
    console.log('✅ products loaded:', prods?.length, prods?.[0])
    setProducts(prods || [])
    setCategories(cats || [])
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))
    // Load current open shift
    const { data: openShift } = await supabase.from('shifts').select('*').eq('status','open').order('opened_at',{ascending:false}).limit(1).maybeSingle()
    setShift(openShift || null)
  }

  // ── Web HID Scanner ──
  async function connectHID() {
    if (!navigator.hid) {
      setHidError('Web HID ใช้ได้เฉพาะ Chrome/Edge บนคอมพิวเตอร์เท่านั้น')
      return
    }
    try {
      setHidError('')
      // Request any HID device (user picks the scanner)
      const devices = await navigator.hid.requestDevice({ filters: [] })
      if (!devices.length) return
      const device = devices[0]
      await device.open()
      setHidDevice(device)

      device.addEventListener('inputreport', (event) => {
        const data = new Uint8Array(event.data.buffer)
        const modifiers = data[0] // bit 1 = L-Shift, bit 5 = R-Shift
        const shifted = (modifiers & 0x02) || (modifiers & 0x20)
        // data[2..7] are up to 6 simultaneous keys
        for (let i = 2; i < 8; i++) {
          const code = data[i]
          if (!code) continue
          const char = shifted ? (HID_SHIFT[code] || HID_KEY[code]) : HID_KEY[code]
          if (!char) continue
          if (char === '\n') {
            const barcode = hidBuffer.current.trim()
            if (barcode) scannerHit(barcode)
            hidBuffer.current = ''
            clearTimeout(hidTimer.current)
          } else {
            hidBuffer.current += char
            clearTimeout(hidTimer.current)
            hidTimer.current = setTimeout(() => { hidBuffer.current = '' }, 150)
          }
        }
      })
    } catch (e) {
      if (e.name !== 'NotAllowedError') setHidError('เชื่อมต่อไม่ได้: ' + e.message)
    }
  }

  async function disconnectHID() {
    if (hidDevice?.opened) await hidDevice.close()
    setHidDevice(null)
    setHidError('')
  }


  // Physical key code → ASCII (ภาษา-independent)
  const PHYS = {
    Digit0:'0',Digit1:'1',Digit2:'2',Digit3:'3',Digit4:'4',
    Digit5:'5',Digit6:'6',Digit7:'7',Digit8:'8',Digit9:'9',
    Numpad0:'0',Numpad1:'1',Numpad2:'2',Numpad3:'3',Numpad4:'4',
    Numpad5:'5',Numpad6:'6',Numpad7:'7',Numpad8:'8',Numpad9:'9',
    KeyA:'A',KeyB:'B',KeyC:'C',KeyD:'D',KeyE:'E',KeyF:'F',KeyG:'G',KeyH:'H',
    KeyI:'I',KeyJ:'J',KeyK:'K',KeyL:'L',KeyM:'M',KeyN:'N',KeyO:'O',KeyP:'P',
    KeyQ:'Q',KeyR:'R',KeyS:'S',KeyT:'T',KeyU:'U',KeyV:'V',KeyW:'W',KeyX:'X',
    KeyY:'Y',KeyZ:'Z',
    Minus:'-',Slash:'/',Backslash:'\\',Period:'.',Comma:',',
  }
  const SKIP_CODES = new Set(['ShiftLeft','ShiftRight','CapsLock','AltLeft','AltRight',
    'ControlLeft','ControlRight','MetaLeft','MetaRight','Tab','Escape'])

  // Global scanner listener — ทำงานไม่ว่าโฟกัสจะอยู่ที่ไหน
  useEffect(() => {
    function onGlobalKey(e) {
      // ถ้าอยู่ใน modal payment หรือ input อื่น (ไม่ใช่ search) → ข้าม
      if (showPayRef.current) return
      const tag = e.target?.tagName
      if (tag === 'TEXTAREA' || tag === 'SELECT') return
      if (tag === 'INPUT' && e.target !== inputRef.current) return

      const isEnter = e.key === 'Enter' || e.code === 'NumpadEnter'

      if (isEnter) {
        const { chars, t0 } = physBuf.current
        physBuf.current = { chars: '', t0: 0 }

        // ≥4 ตัว ภายใน 400ms = scanner
        if (chars.length >= 4 && t0 > 0 && (Date.now() - t0) < 400) {
          e.preventDefault()
          scannerHit(chars)
          return
        }

        // manual: ใช้ค่าใน search input (ถ้ามี)
        if (e.target === inputRef.current) {
          const raw = (e.target.value || '').trim()
          if (raw) { scannerHit(raw); setSearch('') }
          e.preventDefault()
        }
        return
      }

      // สะสม physical key chars
      const physChar = PHYS[e.code]
      if (physChar) {
        const now = Date.now()
        physBuf.current = { chars: physBuf.current.chars + physChar, t0: physBuf.current.t0 || now }
      } else if (e.code && e.code !== 'Unidentified' && !SKIP_CODES.has(e.code)) {
        physBuf.current = { chars: '', t0: 0 }
      }
    }

    document.addEventListener('keydown', onGlobalKey, true)   // capture phase
    return () => document.removeEventListener('keydown', onGlobalKey, true)
  }, [])  // ← empty: ลงทะเบียนครั้งเดียว ใช้ refs แทน state

  // เรียกจาก global listener — ใช้ productsRef เพื่อไม่ต้อง re-register
  function scannerHit(code) {
    const barcode = convertThaiBarcode(code).toUpperCase()
    const prod = productsRef.current.find(p => (p.barcode || '').toUpperCase() === barcode)
    if (prod) {
      addToCart(prod)
      setSearch('')
    } else {
      setSearch(`❌ ${convertThaiBarcode(code)}`)
      setTimeout(() => setSearch(''), 1500)
    }
  }

  function addToCart(prod, qty = 1) {
    setCart(prev => {
      const idx = prev.findIndex(i => i.pid === prod.id)
      if (idx >= 0) {
        const n = [...prev]
        n[idx] = { ...n[idx], qty: n[idx].qty + qty }
        return n
      }
      return [...prev, { pid: prod.id, name: prod.name, barcode: prod.barcode, unit: prod.unit, price: prod.price, cost: prod.cost || 0, qty, disc: 0, note: '' }]
    })
  }

  function setQty(idx, qty) {
    const q = parseFloat(qty)
    if (isNaN(q) || q <= 0) { setCart(p => p.filter((_,i) => i !== idx)); return }
    setCart(p => { const n=[...p]; n[idx]={...n[idx],qty:q}; return n })
  }

  function setItemPrice(idx, price) {
    const v = parseFloat(price)
    if (isNaN(v) || v < 0) return
    setCart(p => { const n=[...p]; n[idx]={...n[idx],price:v}; return n })
  }

  function setItemDisc(idx, disc) {
    const v = parseFloat(disc) || 0
    setCart(p => { const n=[...p]; n[idx]={...n[idx],disc:v}; return n })
  }

  function setItemNote(idx, note) {
    setCart(p => { const n=[...p]; n[idx]={...n[idx],note}; return n })
  }

  function openNumpad(idx, field) {
    const val = field === 'qty' ? String(cart[idx].qty) : field === 'price' ? String(cart[idx].price) : String(cart[idx].disc || '')
    setNumpad({ idx, field, value: val })
  }

  function numpadKey(k) {
    setNumpad(p => {
      if (!p) return p
      if (k === '⌫') return { ...p, value: p.value.slice(0,-1) || '0' }
      if (k === '.' && p.value.includes('.')) return p
      if (k === '.' && p.field === 'qty') return p
      const next = p.value === '0' && k !== '.' ? k : p.value + k
      return { ...p, value: next }
    })
  }

  function numpadConfirm() {
    if (!numpad) return
    const { idx, field, value } = numpad
    if (field === 'qty') setQty(idx, value)
    else if (field === 'price') setItemPrice(idx, value)
    else setItemDisc(idx, value)
    setNumpad(null)
  }

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty - i.disc, 0)
  const billDisc = parseFloat(billDiscount) || 0
  const vatRate  = parseFloat(settings.vat_rate || 0) / 100
  const vatAmt   = (subtotal - billDisc) * vatRate
  const total    = Math.max(0, subtotal - billDisc + vatAmt)
  const change   = (parseFloat(payAmount) || 0) - total

  async function completeSale() {
    if (cart.length === 0) return alert('กรุณาเพิ่มสินค้า')
    if (payMethod === 'cash' && parseFloat(payAmount || 0) < total) return alert('จำนวนเงินที่รับไม่เพียงพอ')

    const cfg = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
    const useBridge = !!cfg.ip  // ถ้ามี IP เครื่องพิมพ์ → พิมพ์ผ่าน API โดยตรง

    setSaving(true)
    try {
      const receiptNo = genReceiptNo()
      const { data: sale, error } = await supabase.from('sales').insert({
        receipt_no: receiptNo, subtotal, discount: billDisc, vat: vatAmt, total,
        payment_method: payMethod,
        payment_amount: payMethod === 'cash' ? parseFloat(payAmount) : total,
        change_amount: Math.max(0, change),
        note,
      }).select().single()
      if (error) throw error

      await supabase.from('sale_items').insert(
        cart.map(i => ({
          sale_id: sale.id, product_id: i.pid, product_name: i.name,
          barcode: i.barcode, unit: i.unit, qty: i.qty,
          price: i.price, cost: i.cost, discount: i.disc,
          subtotal: i.price * i.qty - i.disc, note: i.note || null,
        }))
      )

      for (const i of cart) {
        try {
          const { error: rpcErr } = await supabase.rpc('adjust_stock', {
            p_product_id: i.pid, p_qty_change: -i.qty,
            p_type: 'sale', p_ref_id: sale.id,
          })
          if (rpcErr) throw rpcErr
        } catch {
          const { data: pd } = await supabase.from('products').select('stock').eq('id', i.pid).single()
          await supabase.from('products').update({ stock: (pd?.stock || 0) - i.qty }).eq('id', i.pid)
        }
      }

      const receipt = {
        ...sale, items: cart,
        shopName: settings.shop_name, shopAddress: settings.shop_address,
        shopPhone: settings.shop_phone, shopLogo: settings.shop_logo, footer: settings.receipt_footer,
        change: Math.max(0, change), vatRate,
        customerName: customer?.name || '', customerPhone: customer?.phone || '',
      }
      setLastDone(receipt)

      // พิมพ์อัตโนมัติ + เปิดลิ้นชัก
      if (useBridge) {
        buildReceiptESCPOS(receipt, parseInt(cfg.paper_width) || 80).then(bytes =>
          printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
            .catch(e => console.warn('Print error:', e.message))
        )
        kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
          .catch(e => console.warn('Drawer kick error:', e.message))
      } else {
        // Blob URL approach — ไม่โดน Safari block แม้เรียกหลัง async
        const blob = new Blob([buildReceiptHTML(receipt)], { type: 'text/html;charset=utf-8' })
        window.open(URL.createObjectURL(blob))
      }

      // Sync to BillDEE (fire-and-forget, never blocks POS)
      syncSaleToBillDee(
        sale,
        cart.map(i => ({ product_name: i.name, qty: i.qty, price: i.price, subtotal: i.price * i.qty - i.disc })),
        settings.shop_name || ''
      )

      setCart([]); setBillDiscount(''); setPayAmount(''); setNote(''); setCustomer(null); setShowPay(false)
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + (e?.message || JSON.stringify(e)))
    } finally {
      setSaving(false)
    }
  }

  async function openReceipt(r) {
    const cfg = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
    if (cfg.ip) {
      try {
        const bytes = await buildReceiptESCPOS(r, parseInt(cfg.paper_width) || 80)
        await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
        return
      } catch (e) { console.warn('Print failed:', e.message) }
    }
    const blob = new Blob([buildReceiptHTML(r)], { type: 'text/html;charset=utf-8' })
    window.open(URL.createObjectURL(blob))
  }

  const filtered = products.filter(p => {
    if (activeCat != null && p.category_id !== activeCat) return false
    if (!search) return true
    const q = search.toUpperCase()
    return p.name.toLowerCase().includes(search.toLowerCase()) ||
           (p.barcode || '').toUpperCase().includes(q)
  })

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-100 overflow-hidden">

      {/* Top bar */}
      <header className="bg-[#0f1b14] text-white px-4 py-3 flex items-center gap-3 z-10 flex-shrink-0">
        <span className="font-heading font-bold text-base shrink-0 hidden sm:block">🛒 ขาย</span>
        <input
          ref={inputRef}
          value={search}
          onChange={e => {
            const v = e.target.value
            setSearch(/[฀-๿]/.test(v) ? convertThaiBarcode(v) : v)
          }}
          autoFocus
          placeholder="ยิงบาร์โค้ด หรือค้นหาสินค้า…"
          className="flex-1 bg-white/15 placeholder:text-white/40 text-white border border-white/20 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white/20 focus:border-white/40"
        />
        {hidDevice ? (
          <button onClick={disconnectHID}
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-xs font-semibold shrink-0">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
            {hidDevice.productName?.slice(0,12) || 'Scanner'}
            <span className="opacity-60">✕</span>
          </button>
        ) : (
          <button onClick={connectHID}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white/80 px-3 py-2 rounded-xl text-xs font-semibold shrink-0 border border-white/20 transition-colors">
            🔌 Scanner
          </button>
        )}
      </header>

      {hidError && (
        <div className="bg-red-600 text-white text-xs px-4 py-2 text-center">{hidError}</div>
      )}

      {/* Shift banner */}
      {shift ? (
        <div className="bg-emerald-700 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span className="font-semibold">🟢 กะเปิดอยู่ · เงินเริ่มต้น ฿{fmt(shift.opening_cash)} · เปิดเมื่อ {new Date(shift.opened_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</span>
          <button onClick={() => { setShiftModalMode('close'); setShowShiftModal(true) }}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg font-semibold transition-colors">ปิดกะ</button>
        </div>
      ) : (
        <div className="bg-slate-700 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span className="opacity-60">ยังไม่ได้เปิดกะ</span>
          <button onClick={() => { setShiftModalMode('open'); setShowShiftModal(true) }}
            className="bg-brand hover:bg-brand/80 px-3 py-1 rounded-lg font-semibold transition-colors">เปิดกะ</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── Product panel ── */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Category tabs */}
          <div className="flex gap-2 px-4 py-3 overflow-x-auto scroll-hidden bg-white border-b border-gray-200 flex-shrink-0">
            {[{id:null,name:'ทั้งหมด'}, ...categories].map(c => (
              <button key={c.id ?? 'all'} onClick={() => setActiveCat(c.id)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-all
                  ${activeCat === c.id ? 'bg-brand text-white border-brand shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-brand/40'}`}>
                {c.name}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 content-start">
            {filtered.map(p => (
              <button key={p.id} onClick={() => addToCart(p)}
                disabled={p.stock <= 0}
                className="bg-white rounded-2xl border border-gray-100 text-left shadow-sm active:scale-95 transition-all relative overflow-hidden hover:border-brand/40 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed group">
                {/* Stock badge */}
                {p.stock <= 0 && (
                  <div className="absolute top-2 right-2 bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full font-bold z-10">หมด</div>
                )}
                {p.stock > 0 && p.stock <= p.min_stock && (
                  <div className="absolute top-2 right-2 bg-amber-400 text-white text-[9px] px-2 py-0.5 rounded-full font-bold z-10">ใกล้หมด</div>
                )}
                {/* Image area */}
                <div className="w-full aspect-square bg-gray-50 flex items-center justify-center overflow-hidden rounded-t-2xl border-b border-gray-100 group-hover:bg-brand/5 transition-colors">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-4xl opacity-20">📦</span>
                  )}
                </div>
                {/* Info */}
                <div className="p-3">
                  <div className="text-sm font-semibold leading-snug mb-1 line-clamp-2 text-slate-800">{p.name}</div>
                  <div className="flex items-end justify-between gap-1 mt-2">
                    <div className="font-bold text-base text-brand">฿{fmt(p.price)}</div>
                    <div className="text-[10px] text-slate-400 shrink-0">{p.stock} {p.unit}</div>
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full text-center py-20 text-slate-400 text-sm">
                <div className="text-5xl mb-3 opacity-20">🔍</div>
                ไม่พบสินค้า
              </div>
            )}
          </div>
        </div>

        {/* ── Cart panel ── */}
        <div className="w-[300px] md:w-[340px] flex flex-col bg-white border-l border-gray-200 flex-shrink-0 shadow-xl">
          {/* Cart header */}
          <div className="px-4 py-3.5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <span className="font-bold text-base text-slate-700">
              รายการสั่ง
              {cart.length > 0 && <span className="ml-2 bg-brand text-white text-xs font-bold px-2 py-0.5 rounded-full">{cart.length}</span>}
            </span>
            {cart.length > 0 && (
              <button onClick={() => { if (confirm('ล้างรายการทั้งหมด?')) setCart([]) }}
                className="text-xs text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-50 font-medium transition-colors">ล้าง</button>
            )}
          </div>
          {/* Customer row */}
          <button onClick={() => setShowCustModal(true)}
            className="w-full px-4 py-2.5 flex items-center gap-2 bg-blue-50/60 border-b border-blue-100 hover:bg-blue-50 transition-colors text-left">
            <span className="text-base shrink-0">{customer ? '👤' : '➕'}</span>
            <span className="text-sm font-medium text-blue-700 flex-1 truncate">
              {customer ? customer.name : 'เลือก / เพิ่มลูกค้า'}
            </span>
            {customer && (
              <button onClick={e => { e.stopPropagation(); setCustomer(null) }}
                className="text-blue-300 hover:text-red-400 text-lg leading-none shrink-0">×</button>
            )}
          </button>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="py-16 text-center text-slate-300 text-sm px-4">
                <div className="text-5xl mb-3 opacity-20">🛒</div>
                <p className="font-medium">ยังไม่มีสินค้า</p>
                <p className="text-xs mt-1">ยิงบาร์โค้ดหรือกดเลือกสินค้า</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {cart.map((item, idx) => (
                  <div key={idx} className="px-4 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm font-semibold flex-1 leading-snug text-slate-800 pr-2">{item.name}</p>
                      <button onClick={() => setCart(p => p.filter((_,i)=>i!==idx))}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-400 transition-colors text-sm shrink-0">✕</button>
                    </div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setQty(idx, item.qty - 1)}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-slate-700 font-bold text-lg leading-none transition-colors active:scale-95">−</button>
                        <button onClick={() => openNumpad(idx, 'qty')}
                          className="w-12 text-center border border-gray-200 rounded-lg py-1 text-sm font-bold text-slate-800 bg-white active:bg-brand/10">{item.qty}</button>
                        <button onClick={() => setQty(idx, item.qty + 1)}
                          className="w-8 h-8 rounded-full bg-brand hover:bg-brand/90 flex items-center justify-center text-white font-bold text-lg leading-none transition-colors active:scale-95">+</button>
                      </div>
                      <span className="font-bold text-brand text-base">฿{fmt(item.price * item.qty - item.disc)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-400">ราคา</span>
                      <button onClick={() => openNumpad(idx, 'price')}
                        className="min-w-[60px] text-right border border-gray-100 rounded-lg px-1.5 py-0.5 text-xs font-semibold text-brand bg-white active:bg-brand/10">{item.price}</button>
                      <span className="text-[10px] text-slate-400">× {item.qty} {item.unit}</span>
                      <span className="text-[10px] text-slate-300 mx-0.5">|</span>
                      <span className="text-[10px] text-slate-400">ส่วนลด</span>
                      <button onClick={() => openNumpad(idx, 'disc')}
                        className="min-w-[48px] text-right border border-gray-100 rounded-lg px-1.5 py-0.5 text-xs text-red-400 bg-white active:bg-red-50">{item.disc || 0}</button>
                    </div>
                    <input value={item.note || ''} onChange={e => setItemNote(idx, e.target.value)}
                      placeholder="📝 โน๊ต..."
                      className="mt-1.5 w-full text-xs border-0 border-b border-dashed border-slate-200 bg-transparent py-0.5 text-slate-500 placeholder-slate-300 focus:outline-none focus:border-brand" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="border-t border-gray-100 p-4 bg-gray-50/80 space-y-2.5">
            <div className="flex justify-between text-sm text-slate-500"><span>ยอดรวม</span><span className="font-medium text-slate-700">฿{fmt(subtotal)}</span></div>
            {billDisc > 0 && <div className="flex justify-between text-sm text-red-500"><span>ส่วนลดบิล</span><span>−฿{fmt(billDisc)}</span></div>}
            {vatAmt > 0 && <div className="flex justify-between text-xs text-slate-400"><span>VAT {settings.vat_rate}%</span><span>฿{fmt(vatAmt)}</span></div>}
            <div className="flex justify-between items-baseline border-t border-gray-200 pt-2.5">
              <span className="font-bold text-slate-800 text-base">สุทธิ</span>
              <span className="text-brand font-heading font-bold text-3xl">฿{fmt(total)}</span>
            </div>
            <button onClick={() => setShowPay(true)} disabled={cart.length === 0}
              className="w-full bg-brand text-white font-bold py-4 rounded-2xl text-base disabled:opacity-40 active:scale-[0.98] transition-transform shadow-lg shadow-brand/25 mt-1">
              ชำระเงิน →
            </button>
            <button onClick={() => setShowDocModal(true)} disabled={cart.length === 0}
              className="w-full border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-2xl text-sm disabled:opacity-40 active:scale-[0.98] transition-transform bg-white">
              📄 ออกเอกสาร (ใบเสนอราคา / ใบแจ้งหนี้ / ใบส่งของ)
            </button>
            {lastDone && (
              <button onClick={() => openReceipt(lastDone)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 underline py-1 transition-colors">พิมพ์ใบเสร็จล่าสุด</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Payment Modal ── */}
      {showPay && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
          onClick={e => e.target === e.currentTarget && setShowPay(false)}>
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in">
            <div className="bg-[#0f1b14] text-white px-4 py-3.5 flex justify-between items-center">
              <h2 className="font-heading font-bold text-base">ชำระเงิน</h2>
              <button onClick={() => setShowPay(false)} className="text-2xl leading-none opacity-70">×</button>
            </div>
            <div className="p-4 space-y-3">
              {/* Payment method */}
              <div className="grid grid-cols-4 gap-2">
                {PAY_METHODS.map(m => (
                  <button key={m.id} onClick={() => setPayMethod(m.id)}
                    className={`flex flex-col items-center py-3 rounded-2xl border-2 transition-all gap-1
                      ${payMethod === m.id ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-500 active:bg-slate-50'}`}>
                    <span className="text-xl">{m.icon}</span>
                    <span className="text-[10px] font-semibold">{m.label}</span>
                  </button>
                ))}
              </div>

              {/* Total */}
              <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-100">
                <p className="text-xs text-slate-400 mb-0.5">ยอดชำระ</p>
                <p className="font-heading font-bold text-4xl text-brand">฿{fmt(total)}</p>
              </div>

              {/* QR payment */}
              {payMethod === 'qr' && (
                <div className="flex flex-col items-center gap-2 py-2">
                  {settings.payment_qr ? (
                    <>
                      <img src={settings.payment_qr} alt="QR รับเงิน" className="w-56 h-56 rounded-xl border border-slate-200 object-contain bg-white" />
                      <p className="text-xs text-slate-500 text-center">สแกน QR เพื่อชำระ ฿{fmt(total)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-amber-600 text-center py-4">
                      ยังไม่ได้อัปโหลด QR รับเงิน<br/>
                      <span className="text-xs text-slate-400">ไปที่ ตั้งค่า → QR รับเงิน</span>
                    </p>
                  )}
                </div>
              )}

              {/* Cash input */}
              {payMethod === 'cash' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">รับเงิน (บาท)</label>
                    <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                      autoFocus placeholder="0.00"
                      className="w-full border-2 border-slate-200 rounded-2xl px-4 py-3 text-2xl text-right font-bold focus:border-brand outline-none" />
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {QUICK_CASH.map(n => (
                      <button key={n} onClick={() => setPayAmount(String(n))}
                        className="bg-slate-100 text-slate-700 rounded-xl py-2 text-xs font-semibold active:bg-slate-200">{n}</button>
                    ))}
                  </div>
                  {payAmount && (
                    <div className={`flex justify-between items-center rounded-2xl p-3 font-bold text-lg ${change >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-500'}`}>
                      <span>เงินทอน</span>
                      <span>฿{fmt(Math.abs(change))}</span>
                    </div>
                  )}
                </>
              )}

              {/* Bill discount */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">ส่วนลดบิล</label>
                <input type="number" value={billDiscount} onChange={e => setBillDiscount(e.target.value)}
                  placeholder="0" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-right text-sm focus:border-brand outline-none" />
                <span className="text-xs text-slate-400">บาท</span>
              </div>

              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder="หมายเหตุ (ถ้ามี)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />

              <button onClick={completeSale} disabled={saving}
                className="w-full bg-brand text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-50 active:scale-[0.98] transition-transform shadow-lg shadow-brand/30">
                {saving ? '⏳ กำลังบันทึก...' : '✓ ยืนยันชำระเงิน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shift Modal ── */}
      {showShiftModal && (
        <ShiftModal
          mode={shiftModalMode}
          currentShift={shift}
          salesTotal={total}
          onClose={() => setShowShiftModal(false)}
          onOpened={s => { setShift(s); setShowShiftModal(false) }}
          onClosed={() => { setShift(null); setShowShiftModal(false) }}
        />
      )}

      {/* ── Customer Modal ── */}
      {showCustModal && (
        <CustomerModal
          onSelect={c => { setCustomer(c); setShowCustModal(false) }}
          onClose={() => setShowCustModal(false)}
        />
      )}

      {/* ── Doc Modal ── */}
      {showDocModal && (
        <CartDocModal
          cart={cart}
          totals={{ subtotal, discount: billDisc, vat: vatAmt, total }}
          customer={customer}
          settings={settings}
          onClose={() => setShowDocModal(false)}
        />
      )}

      {/* ── Numpad Modal ── */}
      {numpad && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30" onClick={() => setNumpad(null)}>
          <div className="bg-white rounded-t-3xl w-full max-w-sm pb-safe shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs text-slate-400 mb-1">{numpad.field === 'qty' ? 'จำนวน' : numpad.field === 'price' ? 'ราคา' : 'ส่วนลด'}</p>
              <p className="text-3xl font-bold text-slate-800 text-right tracking-wide">{numpad.value || '0'}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k => (
                <button key={k} onClick={() => numpadKey(k)}
                  className={`h-14 rounded-2xl text-xl font-semibold transition-colors active:scale-95 ${k==='⌫' ? 'bg-red-50 text-red-400' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>
                  {k}
                </button>
              ))}
              <button onClick={() => setNumpad(null)} className="col-span-1 h-14 rounded-2xl bg-slate-200 text-slate-500 font-semibold text-sm active:scale-95">ยกเลิก</button>
              <button onClick={numpadConfirm} className="col-span-2 h-14 rounded-2xl bg-brand text-white font-bold text-lg active:scale-95">✓ ตกลง</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CustomerModal({ onSelect, onClose }) {
  const [search, setSearch]   = useState('')
  const [customers, setCustomers] = useState([])
  const [name, setName]       = useState('')
  const [phone, setPhone]     = useState('')
  const [address, setAddress] = useState('')
  const [taxId, setTaxId]     = useState('')
  const [saving, setSaving]   = useState(false)

  useEffect(() => { loadCustomers() }, [search])

  async function loadCustomers() {
    const q = supabase.from('customers').select('id,name,phone,address,tax_id').order('name').limit(20)
    const { data } = search ? await q.ilike('name', '%'+search+'%') : await q
    setCustomers(data || [])
  }

  async function addNew() {
    if (!name.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('customers')
      .insert({ name: name.trim(), phone: phone.trim() || null, address: address.trim() || null, tax_id: taxId.trim() || null })
      .select().single()
    setSaving(false)
    if (!error && data) onSelect(data)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in">
        <div className="bg-blue-700 text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-bold text-base">👤 เลือกลูกค้า</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3">
          <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
            placeholder="ค้นหาชื่อลูกค้า..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-400 outline-none" />

          <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
            {customers.map(c => (
              <button key={c.id} onClick={() => onSelect(c)}
                className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-sm text-slate-700">{c.name}</span>
                  <span className="text-xs text-slate-400">{c.phone}</span>
                </div>
                {(c.address || c.tax_id) && (
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">{c.address || c.tax_id}</p>
                )}
              </button>
            ))}
            {customers.length === 0 && <p className="text-center py-4 text-slate-400 text-sm">ไม่พบลูกค้า</p>}
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500">เพิ่มลูกค้าใหม่</p>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อลูกค้า *"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-blue-400 outline-none" />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="เบอร์โทร"
                className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-blue-400 outline-none" />
            </div>
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="ที่อยู่"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-blue-400 outline-none" />
            <input value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="เลขที่ผู้เสียภาษี (ถ้ามี)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-blue-400 outline-none" />
            <button onClick={addNew} disabled={!name.trim() || saving}
              className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-40">
              {saving ? '⏳...' : '+ บันทึกและเลือก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShiftModal({ mode, currentShift, onClose, onOpened, onClosed }) {
  const [openCash, setOpenCash]   = useState('')
  const [closeCash, setCloseCash] = useState('')
  const [note, setNote]           = useState('')
  const [saving, setSaving]       = useState(false)
  const [shiftSummary, setShiftSummary] = useState(null)

  useEffect(() => {
    if (mode === 'close' && currentShift) loadShiftSummary()
  }, [mode, currentShift])

  async function loadShiftSummary() {
    const from = currentShift.opened_at
    const { data } = await supabase.from('sales')
      .select('total,payment_method,status')
      .gte('created_at', from).eq('status','completed')
    const salesTotal = (data || []).reduce((s,r) => s + Number(r.total), 0)
    const cashSales  = (data || []).filter(r => r.payment_method === 'cash').reduce((s,r) => s + Number(r.total), 0)
    const expected   = Number(currentShift.opening_cash) + cashSales
    setShiftSummary({ salesTotal, cashSales, expected, count: data?.length || 0 })
  }

  async function openShift() {
    if (!openCash) return alert('กรุณาใส่เงินเริ่มต้นในเก๊ะ')
    setSaving(true)
    const { data, error } = await supabase.from('shifts')
      .insert({ opening_cash: parseFloat(openCash), note: note.trim()||null })
      .select().single()
    setSaving(false)
    if (error) return alert('เกิดข้อผิดพลาด: ' + error.message)
    onOpened(data)
  }

  async function closeShift() {
    if (!closeCash) return alert('กรุณาใส่ยอดเงินที่นับได้')
    setSaving(true)
    const closing = parseFloat(closeCash)
    const expected = shiftSummary?.expected || 0
    const diff = closing - expected
    const { error } = await supabase.from('shifts').update({
      closed_at: new Date().toISOString(),
      closing_cash: closing,
      expected_cash: expected,
      difference: diff,
      sales_total: shiftSummary?.salesTotal || 0,
      sales_count: shiftSummary?.count || 0,
      note: note.trim() || null,
      status: 'closed',
    }).eq('id', currentShift.id)
    setSaving(false)
    if (error) return alert('เกิดข้อผิดพลาด: ' + error.message)
    onClosed()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in">
        <div className={`text-white px-4 py-3.5 flex justify-between items-center ${mode==='open' ? 'bg-emerald-700' : 'bg-red-600'}`}>
          <h2 className="font-bold text-base">{mode==='open' ? '🟢 เปิดกะ' : '🔴 ปิดกะ'}</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3">
          {mode === 'open' && (
            <>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1.5">เงินเริ่มต้นในเก๊ะ (บาท) *</label>
                <input type="number" value={openCash} onChange={e => setOpenCash(e.target.value)} autoFocus
                  placeholder="0.00"
                  className="w-full border-2 border-slate-200 rounded-2xl px-4 py-3 text-2xl text-right font-bold focus:border-emerald-500 outline-none" />
              </div>
              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder="หมายเหตุ (ถ้ามี)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
              <button onClick={openShift} disabled={saving}
                className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-50">
                {saving ? '⏳...' : '✓ เปิดกะ'}
              </button>
            </>
          )}

          {mode === 'close' && (
            <>
              {shiftSummary && (
                <div className="bg-slate-50 rounded-2xl p-3 space-y-1.5 border border-slate-100">
                  <div className="flex justify-between text-sm"><span className="text-slate-500">ยอดขายกะนี้</span><span className="font-bold text-brand">฿{fmt(shiftSummary.salesTotal)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-500">เงินสดรับ</span><span className="font-semibold text-slate-700">฿{fmt(shiftSummary.cashSales)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-500">เงินเริ่มต้น</span><span className="font-semibold text-slate-700">฿{fmt(currentShift.opening_cash)}</span></div>
                  <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-1.5 mt-1">
                    <span className="text-slate-700">ควรมีในเก๊ะ</span>
                    <span className="text-emerald-600">฿{fmt(shiftSummary.expected)}</span>
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1.5">เงินที่นับได้ในเก๊ะ (บาท) *</label>
                <input type="number" value={closeCash} onChange={e => setCloseCash(e.target.value)} autoFocus
                  placeholder="0.00"
                  className="w-full border-2 border-slate-200 rounded-2xl px-4 py-3 text-2xl text-right font-bold focus:border-red-400 outline-none" />
              </div>
              {closeCash && shiftSummary && (
                <div className={`rounded-2xl p-3 text-center font-bold text-lg ${(parseFloat(closeCash)-shiftSummary.expected) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {(parseFloat(closeCash)-shiftSummary.expected) >= 0 ? '✅ เงินเกิน' : '⚠️ เงินขาด'}&nbsp;
                  ฿{fmt(Math.abs(parseFloat(closeCash)-shiftSummary.expected))}
                </div>
              )}
              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder="หมายเหตุ"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
              <button onClick={closeShift} disabled={saving}
                className="w-full bg-red-500 text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-50">
                {saving ? '⏳...' : '✓ ปิดกะ'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function buildReceiptHTML(r) {
  const rows = (r.items || []).map(i => `
    <tr>
      <td style="padding:4px 0;font-size:16px">${i.name}${i.note ? `<br><span style="font-size:13px;color:#666">${i.note}</span>` : ''}</td>
      <td style="text-align:right;white-space:nowrap;font-size:16px;padding-left:4px">${i.qty}×${Number(i.price).toFixed(2)}</td>
      <td style="text-align:right;font-size:16px;padding-left:4px">${(i.price*i.qty-i.disc).toFixed(2)}</td>
    </tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',monospace;font-size:16px;width:72mm;padding:4px 2px}
    .shop-logo{display:block;margin:0 auto 8px;max-width:60mm;max-height:32mm;object-fit:contain}
    h2{font-size:20px;font-weight:bold;text-align:center;margin-bottom:4px}
    .center{text-align:center;font-size:15px}
    hr{border:none;border-top:1px dashed #888;margin:6px 0}
    table{width:100%;border-collapse:collapse}
    .total-row td{font-size:17px;font-weight:bold;padding-top:6px}
    .footer{text-align:center;margin-top:10px;font-size:15px}
    @media print{body{margin:0;padding:2px}}
  </style></head><body>
  ${r.shopLogo ? `<img class="shop-logo" src="${r.shopLogo}" />` : ''}
  <h2>${r.shopName || 'ร้านค้า'}</h2>
  ${r.shopAddress ? `<p class="center">${r.shopAddress}</p>` : ''}
  ${r.shopPhone ? `<p class="center">โทร: ${r.shopPhone}</p>` : ''}
  <hr>
  <p class="center">เลขที่: ${r.receipt_no}</p>
  <p class="center">${new Date(r.created_at).toLocaleString('th-TH')}</p>
  ${r.customerName ? `<p class="center">ลูกค้า: ${r.customerName}${r.customerPhone ? ` (${r.customerPhone})` : ''}</p>` : ''}
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    <tr><td>รวม</td><td style="text-align:right">${Number(r.subtotal).toFixed(2)}</td></tr>
    ${r.discount>0?`<tr><td>ส่วนลด</td><td style="text-align:right">-${Number(r.discount).toFixed(2)}</td></tr>`:''}
    ${r.vat>0?`<tr><td>VAT ${(r.vatRate*100).toFixed(0)}%</td><td style="text-align:right">${Number(r.vat).toFixed(2)}</td></tr>`:''}
    <tr class="total-row"><td>สุทธิ</td><td style="text-align:right">฿${Number(r.total).toFixed(2)}</td></tr>
    ${r.change>0?`<tr><td>เงินทอน</td><td style="text-align:right">฿${Number(r.change).toFixed(2)}</td></tr>`:''}
  </table>
  <hr>
  <div class="footer">${r.footer || 'ขอบคุณที่ใช้บริการ'}</div>
  <script>window.onload=()=>{window.focus();window.print()}</script>
  </body></html>`
}

const CART_DOC_TYPES = [
  { value: 'quotation', label: '📝 ใบเสนอราคา' },
  { value: 'invoice',   label: '📋 ใบแจ้งหนี้' },
  { value: 'delivery',  label: '📦 ใบส่งของ' },
  { value: 'receipt',   label: '🧾 ใบเสร็จรับเงิน' },
]

function CartDocModal({ cart, totals, customer, settings, onClose }) {
  const [docType, setDocType] = useState('quotation')
  const [custName, setCustName]   = useState(customer?.name || '')
  const [custAddr, setCustAddr]   = useState(customer?.address || '')
  const [custPhone, setCustPhone] = useState(customer?.phone || '')
  const [custTaxId, setCustTaxId] = useState(customer?.tax_id || '')
  const [docNo, setDocNo]         = useState('')
  const [validUntil, setValidUntil] = useState('')

  useEffect(() => {
    getNextDocNo(docType).then(no => setDocNo(no))
  }, [docType])

  function generate() {
    const items = cart.map(i => ({
      name: i.name, qty: i.qty, unit: i.unit || '',
      price: i.price, disc: i.disc || 0,
      subtotal: i.price * i.qty - (i.disc || 0), note: i.note,
    }))
    const html = buildFormalDocHTML(
      docType, items, totals,
      { name: custName, address: custAddr, phone: custPhone, tax_id: custTaxId },
      settings,
      { doc_no: docNo || undefined, valid_until: validUntil || undefined }
    )
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in">
        <div className="bg-slate-800 text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-bold text-base">📄 ออกเอกสาร</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">ประเภทเอกสาร</label>
            <div className="grid grid-cols-2 gap-1.5">
              {CART_DOC_TYPES.map(t => (
                <button key={t.value} onClick={() => setDocType(t.value)}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-colors ${docType === t.value ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 rounded-2xl p-3 text-xs text-slate-500">
            {cart.length} รายการ · ยอดรวม <span className="font-bold text-slate-700">฿{totals.total.toLocaleString('th-TH', {minimumFractionDigits:2})}</span>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">เลขที่เอกสาร (ถ้ามี)</label>
            <input value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="เช่น QT2506-001"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
          </div>

          {docType === 'quotation' && (
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">ใช้ได้ถึง</label>
              <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500 block">ข้อมูลลูกค้า</label>
            <input value={custName} onChange={e => setCustName(e.target.value)} placeholder="ชื่อ / บริษัท *"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            <input value={custAddr} onChange={e => setCustAddr(e.target.value)} placeholder="ที่อยู่"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            <div className="flex gap-2">
              <input value={custPhone} onChange={e => setCustPhone(e.target.value)} placeholder="เบอร์โทร"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
              <input value={custTaxId} onChange={e => setCustTaxId(e.target.value)} placeholder="เลขที่ผู้เสียภาษี"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
          </div>

          <button onClick={generate}
            className="w-full bg-slate-800 text-white font-bold py-3.5 rounded-2xl text-base active:scale-[0.98] transition-transform shadow-lg">
            🖨️ สร้างเอกสาร
          </button>
        </div>
      </div>
    </div>
  )
}

