'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { convertThaiBarcode, fmt, genReceiptNo } from '@/lib/utils'
import { printViaBridge, buildReceiptESCPOS, kickDrawerViaBridge } from '@/lib/printBridge'
import { syncSaleToBillDee } from '@/lib/billdeeSyncClient'

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
    const [{ data: prods }, { data: cats }, { data: cfg }] = await Promise.all([
      supabase.from('products').select('*, categories(name)').eq('active', true).order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('settings').select('*'),
    ])
    setProducts(prods || [])
    setCategories(cats || [])
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))
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
      return [...prev, { pid: prod.id, name: prod.name, barcode: prod.barcode, unit: prod.unit, price: prod.price, cost: prod.cost || 0, qty, disc: 0 }]
    })
  }

  function setQty(idx, qty) {
    const q = parseFloat(qty)
    if (isNaN(q) || q <= 0) { setCart(p => p.filter((_,i) => i !== idx)); return }
    setCart(p => { const n=[...p]; n[idx]={...n[idx],qty:q}; return n })
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

    // เปิด popup ทันทีใน user-gesture context (ก่อน await ใดๆ)
    // Safari block popup ถ้าเรียกหลัง async — ต้องเปิดก่อน แล้ว write ทีหลัง
    const cfg = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
    const useBridge = !!(cfg.bridge_url && cfg.ip)
    let receiptWin = null
    if (!useBridge) {
      receiptWin = window.open('', '_blank', 'width=320,height=600')
    }

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
          subtotal: i.price * i.qty - i.disc,
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
      }
      setLastDone(receipt)

      // พิมพ์อัตโนมัติ + เปิดลิ้นชัก
      if (useBridge) {
        buildReceiptESCPOS(receipt, parseInt(cfg.paper_width) || 80).then(bytes =>
          printViaBridge(cfg.bridge_url, cfg.ip, cfg.port || 9100, bytes)
            .catch(e => console.warn('Bridge print error:', e.message))
        )
        kickDrawerViaBridge(cfg.bridge_url, cfg.ip, cfg.port || 9100)
          .catch(e => console.warn('Drawer kick error:', e.message))
      } else if (receiptWin) {
        // Popup fallback (ต้องเปิดไว้ก่อนแล้ว)
        receiptWin.document.write(buildReceiptHTML(receipt))
        receiptWin.document.close()
        setTimeout(() => receiptWin.print(), 400)
      }

      // Sync to BillDEE (fire-and-forget, never blocks POS)
      syncSaleToBillDee(
        sale,
        cart.map(i => ({ product_name: i.name, qty: i.qty, price: i.price, subtotal: i.price * i.qty - i.disc })),
        settings.shop_name || ''
      )

      setCart([]); setBillDiscount(''); setPayAmount(''); setNote(''); setShowPay(false)
    } catch (e) {
      if (receiptWin) receiptWin.close()
      alert('เกิดข้อผิดพลาด: ' + (e?.message || JSON.stringify(e)))
    } finally {
      setSaving(false)
    }
  }

  async function openReceipt(r) {
    const cfg = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
    if (cfg.bridge_url && cfg.ip) {
      try {
        const bytes = await buildReceiptESCPOS(r, parseInt(cfg.paper_width) || 80)
        await printViaBridge(cfg.bridge_url, cfg.ip, cfg.port || 9100, bytes)
        return
      } catch (e) { console.warn('Bridge print failed:', e.message) }
    }
    const w = window.open('', '_blank', 'width=320,height=600')
    if (!w) return
    w.document.write(buildReceiptHTML(r))
    w.document.close()
    setTimeout(() => w.print(), 400)
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
                    <div className="flex justify-between items-start mb-2.5">
                      <p className="text-sm font-semibold flex-1 leading-snug text-slate-800 pr-2">{item.name}</p>
                      <button onClick={() => setCart(p => p.filter((_,i)=>i!==idx))}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-400 transition-colors text-sm shrink-0">✕</button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setQty(idx, item.qty - 1)}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-slate-700 font-bold text-lg leading-none transition-colors active:scale-95">−</button>
                        <input type="number" value={item.qty} onChange={e => setQty(idx, e.target.value)}
                          className="w-12 text-center border border-gray-200 rounded-lg py-1 text-sm font-bold focus:border-brand outline-none" />
                        <button onClick={() => setQty(idx, item.qty + 1)}
                          className="w-8 h-8 rounded-full bg-brand hover:bg-brand/90 flex items-center justify-center text-white font-bold text-lg leading-none transition-colors active:scale-95">+</button>
                      </div>
                      <span className="font-bold text-brand text-base">฿{fmt(item.price * item.qty - item.disc)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1.5">฿{fmt(item.price)} × {item.qty} {item.unit}</div>
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
    </div>
  )
}

function buildReceiptHTML(r) {
  const rows = (r.items || []).map(i => `
    <tr>
      <td style="padding:2px 0;font-size:11px">${i.name}</td>
      <td style="text-align:right;white-space:nowrap;font-size:11px;padding-left:4px">${i.qty}×${Number(i.price).toFixed(2)}</td>
      <td style="text-align:right;font-size:11px;padding-left:4px">${(i.price*i.qty-i.disc).toFixed(2)}</td>
    </tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',monospace;font-size:12px;width:72mm;padding:4px 2px}
    h2{font-size:13px;text-align:center;margin-bottom:2px}
    .center{text-align:center;font-size:11px;color:#555}
    hr{border:none;border-top:1px dashed #888;margin:4px 0}
    table{width:100%;border-collapse:collapse}
    .total-row td{font-size:13px;font-weight:bold;padding-top:4px}
    .footer{text-align:center;margin-top:8px;font-size:11px;color:#555}
    @media print{body{margin:0;padding:2px}}
  </style></head><body>
  <h2>${r.shopName || 'ร้านค้า'}</h2>
  ${r.shopAddress ? `<p class="center">${r.shopAddress}</p>` : ''}
  ${r.shopPhone ? `<p class="center">โทร: ${r.shopPhone}</p>` : ''}
  <hr>
  <p class="center">เลขที่: ${r.receipt_no}</p>
  <p class="center">${new Date(r.created_at).toLocaleString('th-TH')}</p>
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
