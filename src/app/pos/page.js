'use client'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { convertThaiBarcode, fmt, genReceiptNo } from '@/lib/utils'
import { printViaBridge, buildReceiptESCPOS, kickDrawerViaBridge, buildDrawerKickESCPOS } from '@/lib/printBridge'
import { syncSaleToBillDee } from '@/lib/billdeeSyncClient'
import { buildFormalDocHTML, previewNextDocNo, commitNextDocNo } from '@/lib/docBuilder'
import { cacheSet, cacheGet, addToQueue } from '@/lib/offlineQueue'
import { getTerminalId, getTerminalName, setDeviceConfig } from '@/lib/deviceConfig'

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

function getReceiptCfg() {
  const saved = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
  return {
    ip: '192.168.2.88',
    port: 9100,
    paper_width: 80,
    bridge_url: typeof window !== 'undefined' ? window.location.origin : '',
    ...saved,
  }
}

const PAY_METHODS = [
  { id:'cash',     label:'เงินสด', icon:'💵' },
  { id:'transfer', label:'โอน/QR', icon:'📱' },
  { id:'credit',   label:'เชื่อ',  icon:'📝' },
]

const QUICK_CASH = [20, 50, 100, 500, 1000]

const PRICE_TIERS = [
  { id: 'wholesale', label: 'ราคาส่ง',  pct: 5 },
  { id: 'mechanic',  label: 'ราคาช่าง', pct: 5 },
]

export default function POSPage() {
  const { empMode } = useAuth() || {}
  const [products, setProducts]     = useState([])
  const [categories, setCategories] = useState([])
  const [settings, setSettings]     = useState({})
  const [employees, setEmployees]     = useState([])
  const [currentEmp, setCurrentEmp]   = useState(null)   // { id, name, nickname }
  const [showEmpPick, setShowEmpPick] = useState(false)
  const [cart, setCart]             = useState([])
  const [search, setSearch]         = useState('')
  const [activeCat, setActiveCat]   = useState(null)
  const [visibleCount, setVisibleCount] = useState(40)
  const [showPay, setShowPay]       = useState(false)
  const [payMethod, setPayMethod]   = useState('cash')
  const [payAmount, setPayAmount]   = useState('')
  const [payMode, setPayMode]       = useState('single') // 'single' | 'mixed'
  const [mixAmounts, setMixAmounts] = useState({ cash: '', transfer: '', credit: '' })
  const [billDiscount, setBillDiscount] = useState('')
  const [note, setNote]             = useState('')
  const [saving, setSaving]         = useState(false)
  const [lastDone, setLastDone]     = useState(null)
  const [printStatus, setPrintStatus] = useState(null) // null | 'printing' | 'ok' | 'fail'
  const [numpad, setNumpad]         = useState(null) // { idx, field, value }
  const [customer, setCustomer]     = useState(null)  // { id, name, phone }
  const [showCustModal, setShowCustModal] = useState(false)
  const [showDocModal, setShowDocModal] = useState(false)
  const [pendingQuotes, setPendingQuotes]   = useState([])
  const [showPendingQuotes, setShowPendingQuotes] = useState(false)
  const [currentQuoteId, setCurrentQuoteId]     = useState(null)
  const [heldSales, setHeldSales]       = useState(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('held_sales') || '[]') } catch { return [] }
  })
  const [showHeldModal, setShowHeldModal] = useState(false)
  const [shift, setShift]           = useState(null)   // current open shift
  const [showShiftModal, setShowShiftModal] = useState(false)
  const [shiftModalMode, setShiftModalMode] = useState('open') // 'open' | 'close'
  const [showDrawerModal, setShowDrawerModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showHistPanel, setShowHistPanel]     = useState(false)
  const [terminalId,   setTerminalId]   = useState('')
  const [terminalName, setTerminalName] = useState('')
  const [showDeviceSetup, setShowDeviceSetup] = useState(false)
  const [deviceNameInput, setDeviceNameInput] = useState('')
  const [changeDisplay, setChangeDisplay]     = useState(null) // { change, total, payAmount }
  const [priceTier, setPriceTier]             = useState(null) // null | 'wholesale' | 'mechanic'
  // Web HID scanner
  const [hidDevice, setHidDevice]   = useState(null)
  const [hidError, setHidError]     = useState('')
  const inputRef      = useRef(null)
  const scannerRef    = useRef(null)
  const textSearchRef = useRef(null)
  const hidBuffer  = useRef('')
  const hidTimer   = useRef(null)
  const physBuf    = useRef({ chars: '', t0: 0 })
  // Refs สำหรับ global scanner listener (ไม่ต้อง re-register ตอน state เปลี่ยน)
  const productsRef = useRef([])
  const showPayRef  = useRef(false)
  const wasPaying   = useRef(false)
  const dispChRef   = useRef(null)
  useEffect(() => { productsRef.current = products }, [products])
  useEffect(() => { showPayRef.current  = showPay  }, [showPay])

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const tid  = getTerminalId()
    const tnam = getTerminalName()
    if (!tid) { setShowDeviceSetup(true); return }
    setTerminalId(tid); setTerminalName(tnam)
  }, [])


  // Realtime: ถ้า drawer_request ถูกอนุมัติ → ให้ POS local trigger กล้อง (Vercel ทำไม่ได้)
  useEffect(() => {
    const channel = supabase
      .channel('pos-drawer-approved')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'pos', table: 'drawer_requests',
        filter: 'status=eq.approved',
      }, payload => {
        const dr = payload.new
        const now = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
        fetch('/api/camera-snapshot', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption: `🔓 อนุมัติเปิดลิ้นชัก — ${dr.employee_name || '?'}  🕐 ${now}` }),
        }).catch(() => {})
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Customer display broadcast channel — แยกตาม terminal
  useEffect(() => {
    const chName = terminalId ? 'customer-display-' + terminalId.toLowerCase() : 'customer-display'
    const ch = supabase.channel(chName)
    ch.subscribe()
    dispChRef.current = ch
    return () => { supabase.removeChannel(ch) }
  }, [terminalId])

  // Focus กลับไปที่ช่อง scan เฉพาะตอนปิด payment modal (true→false) ไม่ใช่ตอน mount
  useEffect(() => {
    if (!showPay && wasPaying.current) setTimeout(() => inputRef.current?.focus(), 100)
    wasPaying.current = showPay
  }, [showPay])

  // Printer keepalive — ping ทุก 5 นาทีเพื่อไม่ให้เครื่องพิมหลับ
  useEffect(() => {
    function pingPrinters() {
      const receipt = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
      const barcode = JSON.parse(localStorage.getItem('printer_barcode') || '{}')
      if (!receipt.ip && !barcode.ip) return
      fetch('/api/printer-keepalive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt, barcode }),
      }).catch(() => {})
    }
    pingPrinters()
    const id = setInterval(pingPrinters, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const payMethodRef = useRef('cash')
  useEffect(() => { payMethodRef.current = payMethod }, [payMethod])

  // คีย์บอร์ดทำงานใน numpad modal
  useEffect(() => {
    if (!numpad) return
    function onNumKey(e) {
      const k = e.key
      if (k >= '0' && k <= '9') { e.preventDefault(); numpadKey(k) }
      else if (k === '.') { e.preventDefault(); numpadKey('.') }
      else if (k === 'Backspace') { e.preventDefault(); numpadKey('⌫') }
      else if (k === 'Enter' || k === 'NumpadEnter') { e.preventDefault(); numpadConfirm() }
      else if (k === 'Escape') { e.preventDefault(); setNumpad(null) }
    }
    window.addEventListener('keydown', onNumKey)
    return () => window.removeEventListener('keydown', onNumKey)
  }, [numpad])
  useEffect(() => { setVisibleCount(40) }, [search, activeCat])

  // โหลด employees ตั้งแต่ต้นสำหรับ tech-tag ใน cart
  useEffect(() => {
    supabase.from('employees').select('id,name,nickname').eq('active', true).order('name')
      .then(({ data }) => { if (data?.length) setEmployees(data) })
  }, [])

  // ถ้า login เป็นพนักงาน (empMode) แต่ยังไม่ได้เลือก currentEmp → auto-select จาก employees list
  useEffect(() => {
    if (!empMode || currentEmp) return
    const match = employees.find(e => e.id === empMode.id)
    if (match) setCurrentEmp(match)
  }, [employees, empMode])

  // Cleanup HID on unmount
  useEffect(() => () => { if (hidDevice?.opened) hidDevice.close() }, [hidDevice])



  async function loadData() {
    if (!navigator.onLine) {
      // ออฟไลน์ — โหลดจาก cache
      const prods = cacheGet('products'); if (prods) setProducts(prods)
      const cats  = cacheGet('categories'); if (cats) setCategories(cats)
      const cfg   = cacheGet('settings'); if (cfg) setSettings(cfg)
      const emps  = cacheGet('employees'); if (emps) setEmployees(emps)
      return
    }
    const [{ data: prods, error: prodErr }, { data: cats }, { data: cfg }, { data: emps }] = await Promise.all([
      supabase.from('products').select('*, categories(name)').eq('active', true).order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('settings').select('*'),
      supabase.from('employees').select('id,name,nickname').eq('active', true).order('name'),
    ])
    setEmployees(emps || []); cacheSet('employees', emps || [])
    if (prodErr) console.error('products load error:', prodErr)
    setProducts(prods || []); cacheSet('products', prods || [])
    setCategories(cats || []); cacheSet('categories', cats || [])
    if (cfg) {
      const s = Object.fromEntries(cfg.map(r => [r.key, r.value]))
      setSettings(s); cacheSet('settings', s)
    }
    const tid = getTerminalId()
    const shiftQ = supabase.from('shifts').select('*').eq('status','open').order('opened_at',{ascending:false}).limit(1)
    if (tid) shiftQ.eq('terminal_id', tid)
    const { data: openShift } = await shiftQ.maybeSingle()
    setShift(openShift || null)
    const { data: quotes } = await supabase.from('quotations').select('*').eq('status','pending').order('created_at',{ascending:false})
    setPendingQuotes(quotes || [])
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


  // Physical key → ASCII (ไม่สนภาษาที่ใช้อยู่)
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

  // Global scanner listener — ใช้ e.code (physical key) ทำงานได้ทุกภาษา
  useEffect(() => {
    function onGlobalKey(e) {
      if (showPayRef.current) return
      const tag = e.target?.tagName
      if (tag === 'TEXTAREA' || tag === 'SELECT') return
      // ช่องค้นหาข้อความ: ให้พิมปกติ แต่ยัง collect physBuf เผื่อ scanner ยิงขณะโฟกัสที่นี่
      if (tag === 'INPUT' && e.target !== inputRef.current && e.target !== scannerRef.current
          && e.target !== textSearchRef.current) return
      // ถ้า focus อยู่ที่ textSearchRef: ให้ text ทำงานปกติ แต่ scanner ยังจับได้ผ่าน physBuf
      const onTextSearch = tag === 'INPUT' && e.target === textSearchRef.current

      const isEnter = e.key === 'Enter' || e.code === 'NumpadEnter'

      if (isEnter) {
        const { chars, t0 } = physBuf.current
        physBuf.current = { chars: '', t0: 0 }

        // ≥4 ตัว ภายใน 200ms = scanner (คนพิมเร็วที่สุดก็ยัง 300ms+)
        if (chars.length >= 4 && t0 > 0 && (Date.now() - t0) < 200) {
          e.preventDefault()
          if (onTextSearch) setSearch('')   // ล้าง search ที่พิมลงไป
          scannerHit(chars)
          return
        }

        // Enter ในช่อง header input (manual barcode)
        if (e.target === inputRef.current) {
          const raw = (e.target.value || '').trim()
          if (raw) { scannerHit(raw); setSearch('') }
          e.preventDefault()
        }
        return
      }

      const physChar = PHYS[e.code]
      if (physChar) {
        const now = Date.now()
        physBuf.current = { chars: physBuf.current.chars + physChar, t0: physBuf.current.t0 || now }
      } else if (e.code && e.code !== 'Unidentified' && !SKIP_CODES.has(e.code)) {
        physBuf.current = { chars: '', t0: 0 }
      }
    }

    document.addEventListener('keydown', onGlobalKey, true)
    return () => document.removeEventListener('keydown', onGlobalKey, true)
  }, [])

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
        // ย้ายขึ้นบนสุด + เพิ่ม qty
        const updated = { ...prev[idx], qty: prev[idx].qty + qty }
        return [updated, ...prev.filter((_, i) => i !== idx)]
      }
      return [{ pid: prod.id, name: prod.name, barcode: prod.barcode, unit: prod.unit, price: prod.price, origPrice: prod.price, cost: prod.cost || 0, qty, disc: 0, note: '', category_name: prod.categories?.name || '' }, ...prev]
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

  function setItemTech(idx, techName) {
    setCart(p => { const n=[...p]; n[idx]={...n[idx],tech_name:techName||''}; return n })
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
    else if (field === 'pay') { setPayAmount(value); setNumpad(null); return }
    else if (field === 'billdisc') { setBillDiscount(value === '0' ? '' : value); setNumpad(null); return }
    else setItemDisc(idx, value)
    setNumpad(null)
  }

  const subtotal  = cart.reduce((s, i) => s + i.price * i.qty - i.disc, 0)
  const billDisc  = parseFloat(billDiscount) || 0
  const tierPct   = PRICE_TIERS.find(t => t.id === priceTier)?.pct || 0
  const tierDisc  = Math.ceil(subtotal * tierPct / 100)
  const totalDisc = billDisc + tierDisc
  const vatRate   = parseFloat(settings.vat_rate || 0) / 100
  const vatAmt    = (subtotal - totalDisc) * vatRate
  const total     = Math.max(0, subtotal - totalDisc + vatAmt)
  const change    = (parseFloat(payAmount) || 0) - total

  // mixed payment totals
  const mixCash     = parseFloat(mixAmounts.cash)     || 0
  const mixTransfer = parseFloat(mixAmounts.transfer) || 0
  const mixCredit   = parseFloat(mixAmounts.credit)   || 0
  const mixTotal    = mixCash + mixTransfer + mixCredit
  const mixRemain   = total - mixTotal

  // Broadcast cart state to customer display tablet
  useEffect(() => {
    const ch = dispChRef.current
    if (!ch) return
    const isQR = showPay && payMethod === 'transfer' && payMode === 'single'
    const status = showPay ? (isQR ? 'paying_qr' : 'paying') : cart.length > 0 ? 'active' : 'idle'
    ch.send({
      type: 'broadcast', event: 'pos',
      payload: {
        status,
        items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price, subtotal: i.price * i.qty - i.disc })),
        subtotal, discount: totalDisc, total,
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, showPay, payMethod, payMode, subtotal, totalDisc, total])

  async function printQRSlip(amount) {
    const cfg = getReceiptCfg()
    if (!cfg.ip) {
      // fallback — เปิดหน้าต่างพิมพ์
      const html = `<html><body style="text-align:center;font-family:sans-serif;padding:20px">
        <p style="font-size:18px;font-weight:bold">${settings.shop_name || 'ร้านค้า'}</p>
        <p>สแกน QR เพื่อชำระ</p>
        <img src="${settings.payment_qr}" style="width:200px;height:200px"/>
        <p style="font-size:24px;font-weight:bold">฿${fmt(amount)}</p>
        <script>window.print();window.close()<\/script></body></html>`
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      window.open(URL.createObjectURL(blob))
      return
    }
    // ESC/POS: render QR image + amount as bitmap
    const pw  = (parseInt(cfg.paper_width) || 80) >= 80 ? 576 : 384
    const pad = 10
    const canvas = document.createElement('canvas')
    canvas.width = pw
    // load QR image first to measure height
    let qrImg = null
    if (settings.payment_qr) {
      qrImg = await new Promise(res => {
        const img = new Image(); img.crossOrigin = 'anonymous'
        img.onload = () => res(img); img.onerror = () => res(null)
        img.src = settings.payment_qr
      })
    }
    const maxQR = 460  // จำกัด QR ไม่เกิน 460 dots (~57mm)
    const qrScale = qrImg ? Math.min(maxQR / qrImg.width, maxQR / qrImg.height) : 0
    const qrW = qrImg ? Math.round(qrImg.width  * qrScale) : 0
    const qrH = qrImg ? Math.round(qrImg.height * qrScale) : 0
    const feedH = 160  // 160 dots (~20mm) สำหรับ feed ก่อนตัด
    const totalH = 60 + qrH + 100 + feedH
    canvas.height = totalH
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, totalH)
    ctx.fillStyle = '#000'
    function drawCenter(ctx, text, fontSize, bold, y) {
      ctx.font = `${bold ? 'bold ' : ''}${fontSize}px Kanit, Arial, sans-serif`
      ctx.textAlign = 'left'
      const tw = ctx.measureText(text).width
      ctx.fillText(text, Math.max(pad, Math.floor((pw - tw) / 2)), y)
    }
    let y = 10
    drawCenter(ctx, settings.shop_name || 'ร้านค้า', 28, true, y+28); y += 44
    drawCenter(ctx, 'สแกน QR เพื่อชำระ', 20, false, y+20); y += 30
    if (qrImg) { ctx.drawImage(qrImg, (pw-qrW)/2, y, qrW, qrH); y += qrH + 10 }
    drawCenter(ctx, '฿' + fmt(amount), 40, true, y+40)
    const imgData = ctx.getImageData(0, 0, pw, canvas.height)
    const wBytes = Math.ceil(pw/8)
    const bitmap = new Uint8Array(wBytes * canvas.height)
    for (let row = 0; row < canvas.height; row++)
      for (let col = 0; col < pw; col++) {
        const i = (row*pw+col)*4
        const lum = (imgData.data[i]*299+imgData.data[i+1]*587+imgData.data[i+2]*114)/1000
        if (lum < 128) bitmap[row*wBytes+(col>>3)] |= (0x80>>(col&7))
      }
    const GS = 0x1D
    const bytes = new Uint8Array([0x1B,0x40, GS,0x76,0x30,0x00,
      wBytes&0xFF,(wBytes>>8)&0xFF, canvas.height&0xFF,(canvas.height>>8)&0xFF,
      ...bitmap, GS,0x56,0x00])
    printViaBridge(cfg.bridge_url||'', cfg.ip, cfg.port||9100, bytes)
      .catch(e => console.warn('QR print error:', e.message))
  }

  async function completeSale() {
    if (!shift) return alert('กรุณาเปิดกะก่อนทำการขาย')
    if (cart.length === 0) return alert('กรุณาเพิ่มสินค้า')
    if (payMode === 'single') {
      if (payMethod === 'cash' && parseFloat(payAmount || 0) < total) return alert('จำนวนเงินที่รับไม่เพียงพอ')
      if (payMethod === 'credit' && !customer) return alert('กรุณาเลือกลูกค้าสำหรับการขายเชื่อ')
    } else {
      if (Math.abs(mixRemain) > 0.01) return alert(`ยอดรวมไม่ครบ — ยังขาด ฿${fmt(Math.abs(mixRemain))}`)
      if (mixCredit > 0 && !customer) return alert('กรุณาเลือกลูกค้าสำหรับยอดเชื่อ')
    }

    const cfg = getReceiptCfg()
    const useBridge = !!cfg.ip  // ถ้ามี IP เครื่องพิมพ์ → พิมพ์ผ่าน API โดยตรง

    setSaving(true)
    try {
      const receiptNo = genReceiptNo()
      let saveMethod, saveAmount, saveChange, saveNote
      if (payMode === 'mixed') {
        const parts = []
        if (mixCash > 0)     parts.push(`สด ฿${fmt(mixCash)}`)
        if (mixTransfer > 0) parts.push(`โอน ฿${fmt(mixTransfer)}`)
        if (mixCredit > 0)   parts.push(`เชื่อ ฿${fmt(mixCredit)}`)
        saveMethod = 'mixed'
        saveAmount = total
        saveChange = 0
        saveNote = `[ผสม: ${parts.join(' + ')}]${note ? ' ' + note : ''}`
      } else {
        saveMethod = payMethod
        saveAmount = payMethod === 'cash' ? parseFloat(payAmount) : total
        saveChange = Math.max(0, change)
        saveNote   = note
      }
      const tierLabel = PRICE_TIERS.find(t => t.id === priceTier)?.label
      if (tierLabel) saveNote = [tierLabel, saveNote].filter(Boolean).join(' ')

      const saleData = {
        receipt_no: receiptNo, subtotal, discount: totalDisc, vat: vatAmt, total,
        payment_method: saveMethod, payment_amount: saveAmount,
        change_amount: saveChange, note: saveNote,
        customer_id: customer?.id || null,
        employee_id: currentEmp?.id || null,
        terminal_id: getTerminalId() || null,
      }
      const saleItems = cart.map(i => ({
        product_id: i.pid, product_name: i.name,
        barcode: i.barcode, unit: i.unit, qty: i.qty,
        price: i.price, cost: i.cost, discount: i.disc,
        subtotal: i.price * i.qty - i.disc, note: i.note || null,
        technician_name: i.tech_name || null,
      }))

      // ── ออฟไลน์: เพิ่มเข้า queue ──
      if (!navigator.onLine) {
        addToQueue('sale', { saleData, items: saleItems })
        window.dispatchEvent(new Event('offline-queue-changed'))
        const receipt = {
          receipt_no: receiptNo, subtotal, discount: billDisc, vat: vatAmt, total,
          payment_method: saveMethod, payment_amount: saveAmount, change_amount: saveChange,
          items: cart, note: saveNote,
          shopName: settings.shop_name, shopAddress: settings.shop_address,
          shopPhone: settings.shop_phone, footer: settings.receipt_footer,
          lineQr: settings.line_qr || '', hasLineQr: !!settings.line_qr,
          cashier: currentEmp ? (currentEmp.nickname || currentEmp.name) : '',
          change: Math.max(0, change), vatRate,
          customerName: customer?.name || '', customerPhone: customer?.phone || '',
        }
        setLastDone(receipt)
        const cfg = getReceiptCfg()
        if (cfg.ip) {
          buildReceiptESCPOS(receipt, parseInt(cfg.paper_width) || 80).then(bytes =>
            printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
          ).catch(() => {})
        }
        dispChRef.current?.send({ type: 'broadcast', event: 'pos', payload: { status: 'paid', total } }).catch(() => {})
        setCart([]); setBillDiscount(''); setPayAmount(''); setNote(''); setCustomer(null)
        setShowPay(false)
        setSaving(false)
        return
      }

      // ── ออนไลน์: บันทึกปกติ ──
      const { data: sale, error } = await supabase.from('sales').insert(saleData).select().single()
      if (error) throw error

      await supabase.from('sale_items').insert(saleItems.map(i => ({ ...i, sale_id: sale.id })))

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
        lineQr: settings.line_qr || '',
        hasLineQr: !!settings.line_qr,
        cashier: currentEmp ? (currentEmp.nickname || currentEmp.name) : '',
        change: Math.max(0, change), vatRate,
        customerName: customer?.name || '', customerPhone: customer?.phone || '',
      }
      setLastDone(receipt)

      // พิมพ์ + เปิดลิ้นชักเฉพาะจ่ายเงินสด
      const needDrawer = payMode === 'single' ? saveMethod === 'cash'
        : mixCash > 0  // mixed — เปิดถ้ามีส่วนเงินสด
      if (useBridge) {
        setPrintStatus('printing')
        buildReceiptESCPOS(receipt, parseInt(cfg.paper_width) || 80).then(async bytes => {
          if (needDrawer) {
            const empCam = currentEmp ? (currentEmp.nickname || currentEmp.name) : 'POS'
            const timeCam = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
            // บันทึก drawer_log + กล้องก่อน print (แยกออกจาก print error)
            supabase.from('drawer_logs').insert({ employee_name: empCam, note: `ขาย ${receiptNo}` }).then(null, () => {})
            fetch('/api/camera-snapshot', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ caption: `💳 บิลขาย — ${empCam}  🕐 ${timeCam}` }),
            }).catch(() => {})
            const kick = buildDrawerKickESCPOS()
            const combined = new Uint8Array(kick.length + bytes.length)
            combined.set(kick, 0)
            combined.set(bytes, kick.length)
            await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, combined)
          } else {
            await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
          }
          setPrintStatus('ok')
        }).catch(e => {
          console.error('Print error:', e)
          setPrintStatus('fail')
          alert('❌ พิมใบเสร็จไม่ได้: ' + (e?.message || String(e)) + '\nตรวจสอบ IP เครื่องพิมพ์ในหน้า Admin')
        })
      } else {
        const html = buildReceiptHTML(receipt)
        const blob = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
        const iframe = document.createElement('iframe')
        iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0'
        document.body.appendChild(iframe)
        iframe.onload = () => {
          try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch {}
          setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(blob) }, 2000)
        }
        iframe.src = blob
      }

      // Sync to BillDEE (fire-and-forget)
      syncSaleToBillDee(
        sale,
        cart.map(i => ({ product_name: i.name, qty: i.qty, price: i.price, subtotal: i.price * i.qty - i.disc })),
        settings.shop_name || ''
      )

      // แจ้งเตือน Telegram (fire-and-forget)
      fetch('/api/notify-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale: { ...receipt, shopName: settings.shop_name || 'ร้านค้า' } }),
      }).catch(() => {})

      // แจ้งเตือนส่วนลด (เฉพาะพนักงาน + มีส่วนลดจริง)
      if (empMode && (totalDisc > 0 || cart.some(i => i.origPrice !== undefined && i.price !== i.origPrice))) {
        const discItems = cart.filter(i => (i.origPrice !== undefined && i.price !== i.origPrice) || i.disc > 0)
        fetch('/api/notify-discount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            empName: currentEmp ? (currentEmp.nickname || currentEmp.name) : (empMode.name || ''),
            receiptNo,
            discItems: discItems.map(i => ({ name: i.name, qty: i.qty, origPrice: i.origPrice, price: i.price, disc: i.disc })),
            billDisc,
            tierName: PRICE_TIERS.find(t => t.id === priceTier)?.label || null,
            tierDisc,
            totalDisc,
            total,
            shopName: settings.shop_name || 'ร้านค้า',
          }),
        }).catch(() => {})
      }

      // แจ้งเตือน LINE กลุ่ม (fire-and-forget)
      fetch('/api/notify-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale: receipt,
          line_channel_token: settings.line_channel_token || '',
          line_group_id: settings.line_group_id || '',
        }),
      }).catch(() => {})

      if (currentQuoteId) {
        const paidQuote = pendingQuotes.find(q => q.id === currentQuoteId)
        supabase.from('quotations').update({ status: 'paid' }).eq('id', currentQuoteId).then(() => {})
        if (paidQuote?.repair_order_id) {
          supabase.from('repair_orders').update({ status: 'picked_up', sale_id: sale.id, updated_at: new Date().toISOString() }).eq('id', paidQuote.repair_order_id).then(() => {})
        }
        setPendingQuotes(p => p.filter(q => q.id !== currentQuoteId))
        setCurrentQuoteId(null)
      }
      dispChRef.current?.send({ type: 'broadcast', event: 'pos', payload: { status: 'paid', total } }).catch(() => {})
      setCart([]); setBillDiscount(''); setPayAmount(''); setNote(''); setCustomer(null); setPriceTier(null)
      setPayMode('single'); setPayMethod('cash'); setMixAmounts({ cash:'', transfer:'', credit:'' })
      setShowPay(false)
      // แสดงหน้าเงินทอน (เฉพาะจ่ายเงินสด)
      if (saveMethod === 'cash' && saveChange > 0) {
        setChangeDisplay({ change: saveChange, total, payAmount: saveAmount })
      }
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + (e?.message || JSON.stringify(e)))
    } finally {
      setSaving(false)
    }
  }

  function holdSale() {
    if (cart.length === 0) return
    const entry = {
      id: Date.now(),
      savedAt: new Date().toISOString(),
      cart, customer, billDiscount, note, priceTier,
    }
    const updated = [...heldSales, entry]
    setHeldSales(updated)
    localStorage.setItem('held_sales', JSON.stringify(updated))
    setCart([]); setCustomer(null); setBillDiscount(''); setNote(''); setPriceTier(null)
    setPayAmount(''); setPayMode('single'); setPayMethod('cash'); setMixAmounts({ cash:'', transfer:'', credit:'' })
  }

  function restoreHeld(id) {
    const entry = heldSales.find(h => h.id === id)
    if (!entry) return
    if (cart.length > 0 && !confirm('รายการปัจจุบันจะถูกล้าง — ต้องการดึงบิลพักนี้ขึ้นมาใช่ไหม?')) return
    setCart(entry.cart)
    setCustomer(entry.customer || null)
    setBillDiscount(entry.billDiscount || '')
    setNote(entry.note || '')
    setPriceTier(entry.priceTier || null)
    const updated = heldSales.filter(h => h.id !== id)
    setHeldSales(updated)
    localStorage.setItem('held_sales', JSON.stringify(updated))
    setShowHeldModal(false)
  }

  function deleteHeld(id) {
    const updated = heldSales.filter(h => h.id !== id)
    setHeldSales(updated)
    localStorage.setItem('held_sales', JSON.stringify(updated))
  }

  function loadQuote(q) {
    if (cart.length > 0 && !confirm('รายการปัจจุบันจะถูกล้าง — ต้องการโหลดบิลนี้ใช่ไหม?')) return
    const cartItems = (q.items || []).map(i => ({
      pid: i.pid || null, name: i.name, barcode: i.barcode || '',
      unit: i.unit || '', price: i.price, origPrice: i.price,
      cost: i.cost || 0, qty: i.qty, disc: i.disc || 0, note: i.note || '',
    }))
    setCart(cartItems)
    if (q.customer_name) setCustomer({ id: q.customer_id || null, name: q.customer_name, phone: q.customer_phone || '' })
    setBillDiscount(q.discount > 0 ? String(q.discount) : '')
    setCurrentQuoteId(q.id)
    setShowPendingQuotes(false)
  }

  function handleEditBill(cartItems, cust, billDisc) {
    setCart(cartItems)
    setCustomer(cust)
    setBillDiscount(billDisc > 0 ? String(billDisc) : '')
    setShowHistPanel(false)
  }

  async function cancelQuote(id) {
    await supabase.from('quotations').update({ status: 'cancelled' }).eq('id', id)
    setPendingQuotes(p => p.filter(q => q.id !== id))
  }

  async function openReceipt(r) {
    const cfg = getReceiptCfg()
    if (cfg.ip) {
      try {
        const bytes = await buildReceiptESCPOS(r, parseInt(cfg.paper_width) || 80)
        await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
      } catch (e) {
        console.error('Reprint error:', e)
        alert('❌ พิมใบเสร็จไม่ได้: ' + (e?.message || String(e)) + '\nตรวจสอบ IP เครื่องพิมพ์ในหน้า Admin')
      }
      return
    }
    const html = buildReceiptHTML(r)
    const blob = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0'
    document.body.appendChild(iframe)
    iframe.onload = () => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch {}
      setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(blob) }, 2000)
    }
    iframe.src = blob
  }

  const filtered = products.filter(p => {
    if (activeCat != null && p.category_id !== activeCat) return false
    if (!search) return true
    const q = search.toUpperCase()
    return p.name.toLowerCase().includes(search.toLowerCase()) ||
           (p.barcode || '').toUpperCase().includes(q)
  })

  const displayed = filtered.slice(0, visibleCount)

  function handleGridScroll(e) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      setVisibleCount(n => Math.min(n + 40, filtered.length))
    }
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-100 overflow-hidden">

      {/* Top bar */}
      <header className="bg-[#0f1b14] text-white px-4 py-3 flex items-center gap-3 z-10 flex-shrink-0">
        <span className="font-heading font-bold text-base shrink-0 hidden sm:block">🛒 ขาย</span>
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onBlur={() => setTimeout(() => {
            if (document.activeElement === document.body) scannerRef.current?.focus()
          }, 150)}
          autoFocus
          placeholder="ค้นหาสินค้า (ไทย/ENG)…"
          className="flex-1 bg-white/15 placeholder:text-white/40 text-white border border-white/20 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white/20 focus:border-white/40"
        />
        <input
          ref={scannerRef}
          type="text"
          inputMode="none"
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'fixed', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          onChange={() => {}}
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

      {/* Print status banner */}
      {printStatus === 'printing' && (
        <div className="bg-amber-500 text-white text-xs px-4 py-2 text-center font-semibold shrink-0">
          🖨️ กำลังพิมพ์ใบเสร็จ...
        </div>
      )}
      {printStatus === 'fail' && lastDone && (
        <div className="bg-red-600 text-white text-xs px-4 py-2 flex items-center justify-between shrink-0">
          <span>⚠️ พิมพ์ใบเสร็จไม่สำเร็จ</span>
          <button
            onClick={() => { setPrintStatus('printing'); openReceipt(lastDone).then(() => setPrintStatus('ok')).catch(() => setPrintStatus('fail')) }}
            className="bg-white text-red-600 font-bold px-3 py-1 rounded-lg text-xs ml-3">
            พิมใหม่
          </button>
        </div>
      )}

      {/* Shift banner */}
      {shift ? (
        <div className="bg-emerald-700 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0 gap-2">
          <span className="font-semibold">🟢 {terminalName ? terminalName + ' · ' : ''}กะเปิดอยู่ · เงินเริ่มต้น ฿{fmt(shift.opening_cash)} · เปิดเมื่อ {new Date(shift.opened_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowHistPanel(true)}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg font-semibold transition-colors">📋 ประวัติ</button>
            <button onClick={async () => {
                const { data } = await supabase.from('employees').select('id,name,nickname').eq('active', true).order('name')
                if (data) setEmployees(data)
                setShowEmpPick(true)
              }}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg font-semibold transition-colors">
              👤 {currentEmp ? (currentEmp.nickname || currentEmp.name) : 'เลือกพนักงาน'}
            </button>
            <button onClick={() => setShowDrawerModal(true)}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg font-semibold transition-colors">🔓 ลิ้นชัก</button>
            <button onClick={() => { setShiftModalMode('close'); setShowShiftModal(true) }}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg font-semibold transition-colors">ปิดกะ</button>
          </div>
        </div>
      ) : (
        <div className="bg-slate-700 text-white px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <span className="opacity-60">ยังไม่ได้เปิดกะ</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistPanel(true)}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg font-semibold transition-colors">📋 ประวัติ</button>
            <button onClick={() => setShowDrawerModal(true)}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg font-semibold transition-colors">🔓 ลิ้นชัก</button>
            <button onClick={() => { setShiftModalMode('open'); setShowShiftModal(true) }}
              className="bg-brand hover:bg-brand/80 px-3 py-1 rounded-lg font-semibold transition-colors">เปิดกะ</button>
          </div>
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

          {/* Text search bar */}
          <div className="px-3 py-2 bg-white border-b border-gray-100 flex-shrink-0">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
              <input
                ref={textSearchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={() => setTimeout(() => {
                  if (document.activeElement === document.body) scannerRef.current?.focus()
                }, 150)}
                placeholder="พิมพ์ชื่อสินค้าที่ต้องการค้นหา..."
                className="w-full pl-9 pr-8 py-2 rounded-lg border border-gray-200 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30 bg-gray-50"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); textSearchRef.current?.focus() }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg leading-none"
                >×</button>
              )}
            </div>
          </div>

          {/* Product grid */}
          <div onScroll={handleGridScroll} className="flex-1 overflow-y-auto p-3 grid grid-cols-2 lg:grid-cols-3 gap-3 content-start">
            {displayed.map(p => (
              <button key={p.id} onClick={() => addToCart(p)}
                disabled={false}
                className="bg-white rounded-xl border border-gray-100 text-left shadow-sm active:scale-95 transition-all relative flex flex-col hover:border-brand/40 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                {/* Stock badge */}
                {p.stock <= 0 && (
                  <div className="absolute top-2 right-2 bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold z-10">หมด</div>
                )}
                {p.stock > 0 && p.stock <= p.min_stock && (
                  <div className="absolute top-2 right-2 bg-amber-400 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold z-10">ใกล้หมด</div>
                )}
                {/* Name */}
                <div className="flex-1 px-3 pt-3 pb-1 text-sm font-semibold leading-snug line-clamp-3 text-slate-800">{p.name}</div>
                {p.barcode && <div className="px-3 pb-1 text-[10px] text-slate-400 font-mono truncate">{p.barcode}</div>}
                {/* Price */}
                <div className="px-3 pb-3 flex items-center justify-between gap-1">
                  <div className="font-bold text-lg text-brand">฿{fmt(p.price)}</div>
                  <div className="text-xs text-slate-400">{p.stock} {p.unit}</div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full text-center py-20 text-slate-400 text-sm">
                <div className="text-5xl mb-3 opacity-20">🔍</div>
                ไม่พบสินค้า
              </div>
            )}
            {visibleCount < filtered.length && (
              <div className="col-span-full text-center py-2 text-xs text-slate-300">
                {displayed.length}/{filtered.length}
              </div>
            )}
          </div>
        </div>

        {/* ── Cart panel ── */}
        <div className="w-[300px] md:w-[340px] flex flex-col bg-white border-l border-gray-200 flex-shrink-0 shadow-xl">
          {/* Cart header */}
          <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50 gap-2">
            <span className="font-bold text-base text-slate-700 shrink-0">
              รายการสั่ง
              {cart.length > 0 && <span className="ml-2 bg-brand text-white text-xs font-bold px-2 py-0.5 rounded-full">{cart.length}</span>}
            </span>
            <div className="flex items-center gap-1.5">
              {pendingQuotes.length > 0 && (
                <button onClick={() => setShowPendingQuotes(true)}
                  className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg hover:bg-emerald-100 font-semibold transition-colors shrink-0">
                  💳 รอชำระ {pendingQuotes.length}
                </button>
              )}
            {heldSales.length > 0 && (
                <button onClick={() => setShowHeldModal(true)}
                  className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg hover:bg-amber-100 font-semibold transition-colors shrink-0">
                  📋 พัก {heldSales.length}
                </button>
              )}
              {cart.length > 0 && (<>
                <button onClick={holdSale}
                  className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 font-semibold transition-colors shrink-0">
                  📌 พักบิล
                </button>
                <button onClick={() => { if (confirm('ล้างรายการทั้งหมด?')) setCart([]) }}
                  className="text-xs text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-50 font-medium transition-colors shrink-0">ล้าง</button>
              </>)}
            </div>
          </div>
          {/* Customer row */}
          <button onClick={() => setShowCustModal(true)}
            className="w-full px-4 py-2.5 flex items-center gap-2 bg-brand-50/60 border-b border-brand/10 hover:bg-brand-50 transition-colors text-left">
            <span className="text-base shrink-0">{customer ? '👤' : '➕'}</span>
            <span className="text-sm font-medium text-brand-mid flex-1 truncate">
              {customer ? customer.name : 'เลือก / เพิ่มลูกค้า'}
            </span>
            {customer && (
              <button onClick={e => { e.stopPropagation(); setCustomer(null) }}
                className="text-brand/30 hover:text-red-400 text-lg leading-none shrink-0">×</button>
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
                    {employees.length > 0 && (item.name?.includes('ซ่อม') || item.category_name?.includes('ซ่อม') || item.category_name?.includes('บริการ')) && (
                      <div className="mt-1.5">
                        <p className="text-[10px] text-slate-400 mb-1">🔧 ช่างซ่อม</p>
                        <div className="flex flex-wrap gap-1">
                          {employees.map(emp => {
                            const name = emp.nickname || emp.name
                            const selected = item.tech_name === name
                            return (
                              <button key={emp.id}
                                onPointerDown={e => { e.stopPropagation(); setItemTech(idx, selected ? '' : name) }}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selected ? 'bg-violet-500 text-white border-violet-500' : 'bg-white text-slate-500 border-slate-200 active:bg-violet-50 active:border-violet-300'}`}>
                                {name}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="border-t border-gray-100 p-4 bg-gray-50/80 space-y-2.5">
            <div className="flex justify-between text-sm text-slate-500"><span>ยอดรวม</span><span className="font-medium text-slate-700">฿{fmt(subtotal)}</span></div>
            {tierDisc > 0 && <div className="flex justify-between text-sm text-violet-500"><span>{PRICE_TIERS.find(t=>t.id===priceTier)?.label} −{tierPct}%</span><span>−฿{fmt(tierDisc)}</span></div>}
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
              <div className="flex gap-2">
                <button onClick={() => openReceipt(lastDone)}
                  className="flex-1 text-xs text-slate-400 hover:text-slate-600 underline py-1 transition-colors">พิมพ์ใบเสร็จล่าสุด</button>
                {lastDone.id && (
                  <button onClick={() => setShowCancelModal(true)}
                    className="flex-1 text-xs text-red-400 hover:text-red-600 underline py-1 transition-colors">ยกเลิกบิล</button>
                )}
              </div>
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
              {/* Mode toggle: single / mixed */}
              <div className="flex gap-2">
                {[['single','จ่ายเดี่ยว'],['mixed','ผสม']].map(([m,l]) => (
                  <button key={m} onClick={() => setPayMode(m)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all
                      ${payMode === m ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-400'}`}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Price Tier */}
              <div className="grid grid-cols-2 gap-2">
                {PRICE_TIERS.map(t => (
                  <button key={t.id} onClick={() => setPriceTier(priceTier === t.id ? null : t.id)}
                    className={`py-2.5 rounded-xl text-xs font-bold border-2 transition-all
                      ${priceTier === t.id ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-400 active:bg-slate-50'}`}>
                    {t.label} −{t.pct}%
                  </button>
                ))}
              </div>

              {/* Total */}
              <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-100">
                {tierDisc > 0 && <p className="text-xs text-violet-500 font-semibold mb-0.5">{PRICE_TIERS.find(t=>t.id===priceTier)?.label} ลด {tierPct}% = −฿{fmt(tierDisc)}</p>}
                <p className="text-xs text-slate-400 mb-0.5">ยอดชำระ</p>
                <p className="font-heading font-bold text-4xl text-brand">฿{fmt(total)}</p>
              </div>

              {payMode === 'single' ? (<>
                {/* Single payment method */}
                <div className="grid grid-cols-3 gap-2">
                  {PAY_METHODS.map(m => (
                    <button key={m.id} onClick={() => setPayMethod(m.id)}
                      className={`flex flex-col items-center py-3 rounded-2xl border-2 transition-all gap-1
                        ${payMethod === m.id ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-500 active:bg-slate-50'}`}>
                      <span className="text-xl">{m.icon}</span>
                      <span className="text-[10px] font-semibold">{m.label}</span>
                    </button>
                  ))}
                </div>

                {/* QR/Transfer */}
                {payMethod === 'transfer' && (
                  <div className="flex flex-col items-center gap-2 py-1">
                    {settings.payment_qr ? (
                      <>
                        <button onClick={() => printQRSlip(total)} className="relative group">
                          <img src={settings.payment_qr} alt="QR รับเงิน"
                            className="w-52 h-52 rounded-xl border-2 border-slate-200 object-contain bg-white hover:border-brand transition-colors cursor-pointer" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 rounded-xl transition-all">
                            <span className="opacity-0 group-hover:opacity-100 text-white font-bold text-sm bg-black/60 px-3 py-1 rounded-lg transition-all">🖨️ พิมพ์</span>
                          </div>
                        </button>
                        <p className="text-xs text-slate-500 text-center">กดที่ภาพเพื่อพิมพ์ · ฿{fmt(total)}</p>
                      </>
                    ) : (
                      <p className="text-sm text-amber-600 text-center py-4">ยังไม่ได้อัปโหลด QR รับเงิน<br/><span className="text-xs text-slate-400">ไปที่ ตั้งค่า → QR รับเงิน</span></p>
                    )}
                  </div>
                )}

                {/* Cash input */}
                {payMethod === 'cash' && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 block mb-1.5">รับเงิน (บาท)</label>
<button onClick={() => setNumpad({ idx: -1, field: 'pay', value: payAmount || '0' })}
                        className="w-full border-2 border-slate-200 rounded-2xl px-4 py-3 text-2xl text-right font-bold text-slate-800 bg-white hover:border-brand transition-colors">
                        {payAmount || <span className="text-slate-300">0.00</span>}
                      </button>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5">
                      <button onClick={() => setPayAmount(String(total))}
                        className="col-span-1 bg-brand text-white rounded-xl py-2 text-xs font-bold active:opacity-80">เต็ม</button>
                      {QUICK_CASH.map(n => (
                        <button key={n} onClick={() => setPayAmount(String((parseFloat(payAmount) || 0) + n))}
                          className="bg-slate-100 text-slate-700 rounded-xl py-2 text-xs font-semibold active:bg-slate-200">{n}</button>
                      ))}
                    </div>
                    {payAmount && (
                      <div className={`flex justify-between items-center rounded-2xl p-3 font-bold text-lg ${change >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-500'}`}>
                        <span>เงินทอน</span><span>฿{fmt(Math.abs(change))}</span>
                      </div>
                    )}
                  </>
                )}

                {/* Credit — must pick customer */}
                {payMethod === 'credit' && !customer && (
                  <button onClick={() => setShowCustModal(true)}
                    className="w-full border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700 rounded-2xl py-3 text-sm font-semibold">
                    ⚠️ กรุณาเลือกลูกค้าก่อนขายเชื่อ
                  </button>
                )}
              </>) : (<>
                {/* Mixed payment */}
                <div className="space-y-2">
                  {[
                    { key:'cash',     label:'💵 เงินสด',  },
                    { key:'transfer', label:'📱 โอน/QR',  },
                    { key:'credit',   label:'📝 เชื่อ',   },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500 w-20 shrink-0">{label}</span>
                      <input type="number" min="0" placeholder="0"
                        value={mixAmounts[key]}
                        onChange={e => setMixAmounts(p => ({ ...p, [key]: e.target.value }))}
                        className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-right font-bold text-lg focus:border-brand outline-none" />
                    </div>
                  ))}
                </div>

                {/* Remaining indicator */}
                <div className={`flex justify-between items-center rounded-2xl p-3 font-bold text-base
                  ${Math.abs(mixRemain) < 0.01 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-500'}`}>
                  <span>{mixRemain > 0.01 ? 'ยังขาด' : mixRemain < -0.01 ? 'เกิน' : '✓ ครบแล้ว'}</span>
                  <span>{Math.abs(mixRemain) > 0.01 ? `฿${fmt(Math.abs(mixRemain))}` : ''}</span>
                </div>

                {/* Quick fill remaining */}
                {mixRemain > 0.01 && (
                  <div className="flex gap-2">
                    {[['cash','💵'],['transfer','📱'],['credit','📝']].map(([k,ic]) => (
                      <button key={k} onClick={() => setMixAmounts(p => ({ ...p, [k]: String(((parseFloat(p[k])||0) + mixRemain).toFixed(2)) }))}
                        className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-1.5 text-[10px] font-semibold active:bg-slate-200">
                        {ic} +{fmt(mixRemain)}
                      </button>
                    ))}
                  </div>
                )}

                {/* Credit in mixed — require customer */}
                {mixCredit > 0 && !customer && (
                  <button onClick={() => setShowCustModal(true)}
                    className="w-full border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700 rounded-2xl py-3 text-sm font-semibold">
                    ⚠️ มียอดเชื่อ — กรุณาเลือกลูกค้า
                  </button>
                )}

                {/* QR in mixed */}
                {mixTransfer > 0 && settings.payment_qr && (
                  <div className="flex flex-col items-center gap-1">
                    <button onClick={() => printQRSlip(mixTransfer)} className="relative group">
                      <img src={settings.payment_qr} alt="QR"
                        className="w-40 h-40 rounded-xl border-2 border-slate-200 object-contain bg-white hover:border-brand cursor-pointer transition-colors" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 rounded-xl transition-all">
                        <span className="opacity-0 group-hover:opacity-100 text-white font-bold text-sm bg-black/60 px-3 py-1 rounded-lg transition-all">🖨️ พิมพ์</span>
                      </div>
                    </button>
                    <p className="text-xs text-slate-500">โอน ฿{fmt(mixTransfer)} · กดพิมพ์</p>
                  </div>
                )}
              </>)}

              {/* Bill discount */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">ส่วนลดบิล</label>
                <button onClick={() => setNumpad({ idx: -1, field: 'billdisc', value: billDiscount || '0' })}
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-semibold text-slate-800 bg-white hover:border-brand transition-colors">
                  {billDiscount || <span className="text-slate-300">0</span>}
                </button>
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

      {/* ── Change Display ── */}
      {changeDisplay && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setChangeDisplay(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in text-center"
            onClick={e => e.stopPropagation()}>
            <div className="bg-emerald-600 text-white px-4 py-4">
              <p className="text-sm font-semibold opacity-80">รับเงิน ฿{fmt(changeDisplay.payAmount)} · ยอดชำระ ฿{fmt(changeDisplay.total)}</p>
            </div>
            <div className="px-6 py-8">
              <p className="text-slate-500 text-sm font-semibold mb-2">เงินทอน</p>
              <p className="font-heading font-bold text-emerald-500 leading-none mb-6"
                style={{ fontSize: 'clamp(3rem, 20vw, 6rem)' }}>
                ฿{fmt(changeDisplay.change)}
              </p>
              <button onClick={() => setChangeDisplay(null)}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 rounded-2xl text-lg active:scale-[0.98] transition-all shadow-lg shadow-emerald-200">
                ✓ รับทราบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drawer Modal ── */}
      {showDrawerModal && (
        <DrawerOpenModal
          settings={settings}
          currentEmp={currentEmp}
          empMode={empMode}
          onClose={() => setShowDrawerModal(false)}
        />
      )}

      {/* ── Cancel Bill Modal ── */}
      {showCancelModal && lastDone?.id && (
        <CancelBillModal
          sale={lastDone}
          settings={settings}
          currentEmp={currentEmp}
          empMode={empMode}
          onClose={() => setShowCancelModal(false)}
          onVoided={() => { setShowCancelModal(false); setLastDone(null) }}
        />
      )}

      {/* ── Sales History Panel ── */}
      {showHistPanel && (
        <SalesHistoryPanel
          settings={settings}
          currentEmp={currentEmp}
          empMode={empMode}
          terminalId={terminalId}
          terminalName={terminalName}
          onClose={() => setShowHistPanel(false)}
          onReprint={openReceipt}
          onEditBill={handleEditBill}
        />
      )}

      {/* ── Shift Modal ── */}
      {showShiftModal && (
        <ShiftModal
          mode={shiftModalMode}
          currentShift={shift}
          empMode={empMode}
          settings={settings}
          terminalId={terminalId}
          terminalName={terminalName}
          onClose={() => setShowShiftModal(false)}
          onOpened={s => { setShift(s); setShowShiftModal(false) }}
          onClosed={() => { setShift(null); setShowShiftModal(false) }}
        />
      )}

      {showEmpPick && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowEmpPick(false)}>
          <div className="bg-white rounded-3xl w-full max-w-xs shadow-2xl p-4 fade-in">
            <h2 className="font-bold text-base mb-3 text-slate-700">เลือกพนักงาน</h2>
            <div className="space-y-2">
              {employees.map(e => (
                <button key={e.id} onClick={() => { setCurrentEmp(e); setShowEmpPick(false) }}
                  className={`w-full text-left px-4 py-3 rounded-2xl border-2 font-semibold transition-all
                    ${currentEmp?.id === e.id ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 hover:border-brand/40 text-slate-700'}`}>
                  {e.nickname || e.name}
                  {e.nickname && <span className="text-xs font-normal text-slate-400 ml-2">({e.name})</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Customer Modal ── */}
      {showCustModal && (
        <CustomerModal
          onSelect={c => { setCustomer(c); setShowCustModal(false) }}
          onClose={() => setShowCustModal(false)}
        />
      )}

      {/* ── Doc Modal ── */}
      {showPendingQuotes && (
        <PendingQuotesModal
          quotes={pendingQuotes}
          onLoad={loadQuote}
          onCancel={cancelQuote}
          onClose={() => setShowPendingQuotes(false)}
        />
      )}

      {showDocModal && (
        <CartDocModal
          cart={cart}
          totals={{ subtotal, discount: billDisc, vat: vatAmt, total }}
          customer={customer}
          settings={settings}
          onClose={() => setShowDocModal(false)}
          onSaved={q => setPendingQuotes(p => [q, ...p])}
        />
      )}

      {/* ── Numpad Modal ── */}
      {numpad && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30" onClick={() => setNumpad(null)}>
          <div className="bg-white rounded-t-3xl w-full max-w-sm pb-safe shadow-2xl" onClick={e => e.stopPropagation()}
            tabIndex={0} autoFocus
            onKeyDown={e => {
              const k = e.key
              if (k >= '0' && k <= '9') { e.preventDefault(); numpadKey(k) }
              else if (k === '.') { e.preventDefault(); numpadKey('.') }
              else if (k === 'Backspace') { e.preventDefault(); numpadKey('⌫') }
              else if (k === 'Enter' || k === 'NumpadEnter') { e.preventDefault(); numpadConfirm() }
              else if (k === 'Escape') { e.preventDefault(); setNumpad(null) }
            }}>
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs text-slate-400 mb-1">{numpad.field === 'qty' ? 'จำนวน' : numpad.field === 'price' ? 'ราคา' : numpad.field === 'pay' ? 'รับเงิน (บาท)' : numpad.field === 'billdisc' ? 'ส่วนลดบิล (บาท)' : 'ส่วนลด'}</p>
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

      {/* ── Held Sales Modal ── */}
      {showHeldModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
          onClick={e => e.target === e.currentTarget && setShowHeldModal(false)}>
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in">
            <div className="bg-[#0f1b14] text-white px-4 py-3.5 flex justify-between items-center">
              <h2 className="font-heading font-bold text-base">📋 บิลที่พักไว้ ({heldSales.length})</h2>
              <button onClick={() => setShowHeldModal(false)} className="text-2xl leading-none opacity-70">×</button>
            </div>
            <div className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {heldSales.length === 0 ? (
                <p className="text-center text-slate-400 py-10 text-sm">ไม่มีบิลพักไว้</p>
              ) : heldSales.map(h => {
                const t = h.cart.reduce((s, i) => s + i.price * i.qty - (i.disc || 0), 0)
                const timeStr = new Date(h.savedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={h.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400 mb-0.5">⏱ {timeStr}</p>
                      <p className="text-sm font-semibold text-slate-700 truncate">
                        {h.customer ? `👤 ${h.customer.name} · ` : ''}{h.cart.length} รายการ
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {h.cart.slice(0, 2).map(i => i.name).join(', ')}{h.cart.length > 2 ? ` +${h.cart.length - 2} รายการ` : ''}
                      </p>
                      <p className="text-brand font-bold text-sm mt-1">฿{fmt(t)}</p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button onClick={() => restoreHeld(h.id)}
                        className="bg-brand text-white text-xs font-bold px-3 py-1.5 rounded-xl active:scale-95 transition-transform">
                        ดึงขึ้น
                      </button>
                      <button onClick={() => { if (confirm('ลบบิลพักนี้?')) deleteHeld(h.id) }}
                        className="text-xs text-red-400 border border-red-100 px-3 py-1.5 rounded-xl hover:bg-red-50 transition-colors">
                        ลบ
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Device Setup Modal ── */}
      {showDeviceSetup && (
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">💻</div>
              <h2 className="text-xl font-bold text-slate-800">ตั้งค่าเครื่องนี้</h2>
              <p className="text-sm text-slate-500 mt-1">กำหนดชื่อ/รหัสเครื่อง POS เพื่อแยกกะและยอดการเงิน</p>
            </div>
            <input
              autoFocus
              value={deviceNameInput}
              onChange={e => setDeviceNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveDeviceName() }}
              placeholder="เช่น T1, เคาน์เตอร์ 1, POS-A"
              className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base font-medium focus:border-brand focus:outline-none mb-4"
            />
            <button
              onClick={saveDeviceName}
              disabled={!deviceNameInput.trim()}
              className="w-full py-3 rounded-xl font-bold text-sm btn-primary disabled:opacity-40">
              บันทึกและเริ่มใช้งาน
            </button>
          </div>
        </div>
      )}

    </div>
  )

  function saveDeviceName() {
    const name = deviceNameInput.trim()
    if (!name) return
    setDeviceConfig({ terminal_id: name, terminal_name: name })
    setTerminalId(name); setTerminalName(name)
    setShowDeviceSetup(false)
  }
}

function SalesHistoryPanel({ settings, currentEmp, empMode, terminalId, terminalName, onClose, onReprint, onEditBill }) {
  const [search, setSearch]           = useState('')
  const [sales, setSales]             = useState([])
  const [loading, setLoading]         = useState(false)
  const [selected, setSelected]       = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [page, setPage]               = useState('list') // 'list' | 'detail'
  const [voidSale, setVoidSale]       = useState(null)
  const [termFilter, setTermFilter]   = useState(terminalId ? 'mine' : 'all')

  useEffect(() => {
    const t = setTimeout(loadSales, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search, termFilter])

  async function loadSales() {
    setLoading(true)
    try {
      let q = supabase.from('sales')
        .select('id,receipt_no,created_at,total,payment_method,status,note,void_reason,payment_amount,discount,customer_id,terminal_id')
        .order('created_at', { ascending: false }).limit(60)
      if (search.trim()) q = q.ilike('receipt_no', `%${search.trim()}%`)
      if (termFilter === 'mine' && terminalId) q = q.eq('terminal_id', terminalId)
      const { data } = await q
      setSales(data || [])
    } finally { setLoading(false) }
  }

  async function openDetail(sale) {
    setDetailLoading(true)
    const { data: items } = await supabase.from('sale_items').select('*').eq('sale_id', sale.id).order('id')
    setSelected({ ...sale, items: items || [] })
    setPage('detail')
    setDetailLoading(false)
  }

  function buildReceipt(sale) {
    return {
      ...sale,
      items: (sale.items || []).map(i => ({ ...i, name: i.product_name, disc: i.discount || 0 })),
      shopName: settings.shop_name || '', shopAddress: settings.shop_address || '',
      shopPhone: settings.shop_phone || '', footer: settings.receipt_footer || '',
      cashier: currentEmp ? (currentEmp.nickname || currentEmp.name) : '',
      change: Math.max(0, (sale.payment_amount || 0) - sale.total),
      vatRate: 0, customerName: '', customerPhone: '',
    }
  }

  function handleVoided() {
    setVoidSale(null)
    const updated = { ...selected, status: 'voided' }
    setSelected(updated)
    setSales(prev => prev.map(s => s.id === updated.id ? { ...s, status: 'voided' } : s))
  }

  async function doEditBill() {
    if (!confirm(`ยกเลิกบิล ${selected.receipt_no} และโหลดรายการกลับเข้าตะกร้าเพื่อแก้ไข?`)) return
    await supabase.from('sales').update({
      status: 'voided', void_reason: 'แก้ไขบิล', voided_at: new Date().toISOString(),
    }).eq('id', selected.id)
    const cartItems = (selected.items || []).map(si => ({
      id: si.product_id, name: si.product_name, sku: si.sku || '',
      price: si.price, origPrice: si.price, cost: 0,
      qty: si.qty, disc: si.discount || 0,
      note: si.note || '', tech_name: si.technician_name || '',
    }))
    let cust = null
    if (selected.customer_id) {
      const { data: c } = await supabase.from('customers').select('id,name,phone').eq('id', selected.customer_id).maybeSingle()
      if (c) cust = { id: c.id, name: c.name, phone: c.phone || '' }
    }
    onEditBill(cartItems, cust, selected.discount || 0)
  }

  const payLabel = m => m === 'cash' ? 'เงินสด' : m === 'transfer' ? 'โอน/QR' : m === 'credit' ? 'เชื่อ' : m || '—'

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-sm bg-white h-full flex flex-col shadow-2xl">

        {/* Header */}
        <div className="bg-[#0f1b14] text-white px-4 py-3.5 flex items-center gap-3 shrink-0">
          {page === 'detail' ? (
            <button onClick={() => { setPage('list'); setSelected(null) }} className="text-xl opacity-60 hover:opacity-100">←</button>
          ) : (
            <button onClick={onClose} className="text-2xl leading-none opacity-60 hover:opacity-100">×</button>
          )}
          <h2 className="font-heading font-bold flex-1 text-base">
            {page === 'detail' ? `📄 ${selected?.receipt_no}` : '📋 ประวัติบิล'}
          </h2>
          {page === 'detail' && (
            <button onClick={onClose} className="text-2xl leading-none opacity-60 hover:opacity-100">×</button>
          )}
        </div>

        {page === 'list' ? (
          <>
            <div className="px-3 py-2.5 border-b border-gray-100 shrink-0 space-y-2">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 ค้นหาเลขบิล..."
                className="w-full border border-gray-200 rounded-2xl px-4 py-2 text-sm focus:border-brand outline-none bg-gray-50" />
              {terminalId && (
                <div className="flex gap-1.5">
                  <button onClick={() => setTermFilter('mine')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-colors ${termFilter === 'mine' ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500'}`}>
                    💻 {terminalName || terminalId}
                  </button>
                  <button onClick={() => setTermFilter('all')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-colors ${termFilter === 'all' ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500'}`}>
                    🏪 ทุกเครื่อง
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {loading ? (
                <div className="p-10 text-center text-slate-400 text-sm">กำลังโหลด...</div>
              ) : sales.length === 0 ? (
                <div className="p-10 text-center text-slate-400 text-sm">ไม่พบบิล</div>
              ) : sales.map(sale => (
                <button key={sale.id} onClick={() => openDetail(sale)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-bold text-slate-800 text-sm">{sale.receipt_no}</p>
                      {sale.status === 'voided' && (
                        <span className="text-[10px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded font-semibold">ยกเลิก</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {new Date(sale.created_at).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{payLabel(sale.payment_method)}
                      {termFilter === 'all' && sale.terminal_id && <span className="ml-1 text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-medium">💻 {sale.terminal_id}</span>}
                    </p>
                    {sale.note && <p className="text-xs text-slate-300 truncate mt-0.5">{sale.note}</p>}
                  </div>
                  <span className={`font-bold text-base shrink-0 ${sale.status === 'voided' ? 'text-slate-300 line-through' : 'text-brand'}`}>
                    ฿{fmt(sale.total)}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">กำลังโหลด...</div>
        ) : selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Sale meta */}
            <div className="px-4 py-3 bg-slate-50 border-b border-gray-100 shrink-0">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-slate-400">{new Date(selected.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</p>
                  <p className="text-sm font-semibold text-slate-700 mt-0.5">{payLabel(selected.payment_method)} · ฿{fmt(selected.total)}</p>
                  {selected.note && <p className="text-xs text-slate-400 mt-0.5">{selected.note}</p>}
                </div>
                {selected.status === 'voided' && (
                  <span className="text-xs bg-red-100 text-red-500 px-2 py-1 rounded-lg font-semibold shrink-0">ยกเลิกแล้ว</span>
                )}
              </div>
              {selected.void_reason && (
                <p className="text-xs text-red-400 mt-1.5 bg-red-50 px-2 py-1 rounded-lg">เหตุ: {selected.void_reason}</p>
              )}
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {selected.items.map((item, i) => (
                <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{item.product_name}</p>
                    {item.technician_name && (
                      <p className="text-xs mt-0.5" style={{ color: '#7c3aed' }}>🔧 {item.technician_name}</p>
                    )}
                    {item.note && <p className="text-xs text-slate-400">{item.note}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-brand">฿{fmt(item.subtotal)}</p>
                    <p className="text-xs text-slate-400">{item.qty} × {fmt(item.price)}</p>
                    {item.discount > 0 && <p className="text-xs text-red-400">ลด ฿{fmt(item.discount)}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="px-4 py-3 bg-slate-50 border-t border-gray-100 shrink-0 space-y-1">
              {selected.discount > 0 && (
                <div className="flex justify-between text-xs text-slate-500">
                  <span>ส่วนลดบิล</span><span className="text-red-400">−฿{fmt(selected.discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base">
                <span className="text-slate-700">ยอดสุทธิ</span>
                <span className={selected.status === 'voided' ? 'text-slate-400 line-through' : 'text-brand'}>฿{fmt(selected.total)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="px-4 py-3 border-t border-gray-100 space-y-2 shrink-0">
              <button onClick={() => onReprint(buildReceipt(selected))}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-2xl text-sm transition-colors active:scale-[0.98]">
                🖨️ พิมพ์ใบเสร็จ
              </button>
              {selected.status !== 'voided' && (
                <button onClick={doEditBill}
                  className="w-full font-bold py-3 rounded-2xl text-sm transition-colors active:scale-[0.98]"
                  style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
                  ✏️ แก้ไขบิล (โหลดเข้าตะกร้า)
                </button>
              )}
              {selected.status !== 'voided' && (
                <button onClick={() => setVoidSale(selected)}
                  className="w-full bg-red-50 hover:bg-red-100 text-red-500 font-bold py-3 rounded-2xl text-sm transition-colors active:scale-[0.98]">
                  🚫 ยกเลิกบิล
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* Void overlay */}
        {voidSale && (
          <CancelBillModal
            sale={voidSale}
            settings={settings}
            currentEmp={currentEmp}
            empMode={empMode}
            onClose={() => setVoidSale(null)}
            onVoided={handleVoided}
          />
        )}
      </div>
    </div>
  )
}

function CancelBillModal({ sale, settings, currentEmp, empMode, onClose, onVoided }) {
  const [reason, setReason]       = useState('')
  const [refundMethod, setRefund] = useState('cash') // 'cash'|'transfer'
  const [step, setStep]           = useState('idle') // 'idle'|'saving'|'requesting'|'done'|'rejected'
  const [errMsg, setErr]          = useState('')

  const empName  = currentEmp ? (currentEmp.nickname || currentEmp.name) : (empMode?.name || 'ไม่ระบุ')
  const refundAmt = Number(sale.total) || 0

  async function confirmCancel() {
    if (step !== 'idle') return
    const voidNote = `คืนเงิน ฿${refundAmt.toLocaleString('th-TH')} — ${sale.receipt_no}${reason.trim() ? ' — ' + reason.trim() : ''}`

    try {
      // 1. void the sale
      await supabase.from('sales').update({
        status: 'voided',
        void_reason: reason.trim() || null,
        voided_at: new Date().toISOString(),
        refund_terminal_id: getTerminalId() || null,
      }).eq('id', sale.id)

      // 2. cash refund → open drawer
      if (refundMethod === 'cash') {
        if (empMode) {
          // employee → request approval
          setStep('requesting')
          const res = await fetch('/api/request-drawer', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employee_id: empMode.id, employee_name: empName, note: voidNote }),
          })
          const json = await res.json()
          if (json.error) { setErr(json.error); return }
          pollCancelApproval(json.request_id, { amount: refundAmt, note: voidNote })
          return
        } else {
          // admin → open directly
          setStep('saving')
          try {
            const cfg = getReceiptCfg()
            if (cfg.ip) await kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
          } catch {}
          await supabase.from('drawer_logs').insert({
            employee_name: 'แอดมิน', amount: refundAmt, note: `เบิกเงินออก — ${voidNote}`,
          }).then(null, () => {})
          const timeCam = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
          fetch('/api/camera-snapshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caption: `💸 คืนเงิน — ${sale.receipt_no}  🕐 ${timeCam}` }),
          }).catch(() => {})
        }
      }

      setStep('done')
      setTimeout(onVoided, 1200)
    } catch (e) { setErr(e.message); setStep('idle') }
  }

  function pollCancelApproval(requestId, drawerData) {
    let attempts = 0
    const iv = setInterval(async () => {
      attempts++
      if (attempts > 60) { clearInterval(iv); return }
      try {
        const r = await fetch(`/api/request-drawer?id=${requestId}`)
        const j = await r.json()
        if (j.status === 'approved') {
          clearInterval(iv)
          try {
            const cfg = getReceiptCfg()
            if (cfg.ip) await kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
          } catch {}
          await supabase.from('drawer_logs').insert({
            employee_name: empName, amount: drawerData.amount,
            note: `เบิกเงินออก — ${drawerData.note}`,
          }).then(null, () => {})
          const timeCam = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
          fetch('/api/camera-snapshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caption: `💸 คืนเงิน — ${sale.receipt_no}  🕐 ${timeCam}` }),
          }).catch(() => {})
          setStep('done')
          setTimeout(onVoided, 1200)
        } else if (j.status === 'rejected') {
          clearInterval(iv)
          setStep('rejected')
        }
      } catch {}
    }, 5000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-xs shadow-2xl overflow-hidden fade-in">
        <div className="bg-red-600 text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-heading font-bold text-base">🚫 ยกเลิกบิล</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>

        {step === 'done' ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-2">✅</div>
            <p className="font-bold text-emerald-600 text-lg">ยกเลิกบิลแล้ว</p>
          </div>
        ) : step === 'rejected' ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-2">❌</div>
            <p className="font-bold text-red-500 text-lg">admin ไม่อนุมัติ</p>
            <button onClick={onClose} className="mt-4 text-sm text-slate-500 underline">ปิด</button>
          </div>
        ) : step === 'requesting' ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-2">📨</div>
            <p className="font-bold text-amber-600 text-lg">ส่งคำขอแล้ว</p>
            <p className="text-sm text-slate-500 mt-1">รอ admin อนุมัติคืนเงินทาง Telegram…</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="bg-red-50 rounded-2xl px-4 py-3 border border-red-100">
              <p className="text-xs text-slate-400 mb-0.5">บิล</p>
              <p className="font-bold text-slate-800">{sale.receipt_no}</p>
              <p className="text-sm text-slate-500">฿{Number(sale.total).toLocaleString('th-TH')} · {sale.payment_method === 'cash' ? 'เงินสด' : sale.payment_method === 'transfer' ? 'โอน/QR' : 'เชื่อ'}</p>
            </div>

            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="เหตุผลยกเลิก (บังคับ)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-red-400 outline-none" />

            <div>
              <p className="text-xs text-slate-400 mb-1.5 font-semibold">คืนเงินโดย</p>
              <div className="flex gap-2">
                <button onClick={() => setRefund('cash')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors ${refundMethod === 'cash' ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                  💵 เงินสด
                </button>
                <button onClick={() => setRefund('transfer')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors ${refundMethod === 'transfer' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                  📲 โอน
                </button>
              </div>
              {refundMethod === 'cash' && (
                <p className="text-xs text-amber-600 mt-1.5 text-center">จะขอเปิดลิ้นชักเพื่อคืนเงิน ฿{refundAmt.toLocaleString('th-TH')}</p>
              )}
            </div>

            {errMsg && <p className="text-center text-red-500 text-xs font-semibold">{errMsg}</p>}

            <button onClick={confirmCancel} disabled={!reason.trim() || step === 'saving'}
              className="w-full bg-red-500 text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-40 active:scale-[0.98] transition-transform shadow-lg shadow-red-200">
              {step === 'saving' ? '⏳ กำลังดำเนินการ...' : '✓ ยืนยันยกเลิกบิล'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DrawerOpenModal({ settings, currentEmp, empMode, onClose }) {
  const isEmployee = !!empMode
  const [direction, setDir]   = useState('in')
  const [amount, setAmount]   = useState('')
  const [noteText, setNote]   = useState('')
  const [step, setStep]       = useState('idle') // 'idle' | 'done' | 'requested'
  const [errMsg, setErrMsg]   = useState('')
  const [saving, setSaving]   = useState(false)

  const empName = currentEmp ? (currentEmp.nickname || currentEmp.name) : (empMode?.name || 'ไม่ระบุ')

  async function requestDrawer() {
    if (saving) return
    setSaving(true); setErrMsg('')
    const dirLabel = direction === 'in' ? 'รับเงินเข้า' : 'เบิกเงินออก'
    const amtNum   = parseFloat(amount) || 0
    const fullNote = [dirLabel, noteText.trim()].filter(Boolean).join(' — ')
    try {
      const res = await fetch('/api/request-drawer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: empMode.id, employee_name: empName, note: fullNote, amount: amtNum || null }),
      })
      const json = await res.json()
      if (json.error) { setErrMsg(json.error); return }
      setStep('requested')
      pollApproval(json.request_id, { amount: amtNum, note: fullNote })
    } catch { setErrMsg('เชื่อมต่อไม่ได้') }
    finally { setSaving(false) }
  }

  function pollApproval(requestId, drawerData = {}) {
    let attempts = 0
    const iv = setInterval(async () => {
      attempts++
      if (attempts > 60) { clearInterval(iv); return } // หยุดหลัง 5 นาที
      try {
        const r = await fetch(`/api/request-drawer?id=${requestId}`)
        const j = await r.json()
        if (j.status === 'approved') {
          clearInterval(iv)
          setStep('opening')
          try {
            const cfg = getReceiptCfg()
            if (cfg.ip) await kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
          } catch (e) { console.warn('Drawer kick error:', e.message) }
          supabase.from('drawer_logs').insert({
            employee_name: empName,
            amount: drawerData.amount || null,
            note: drawerData.note || null,
          }).then(null, () => {})
          const timeStr = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
          fetch('/api/camera-snapshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caption: `🔓 เปิดลิ้นชัก — ${empName}  🕐 ${timeStr}` }),
          }).catch(() => {})
          setStep('done')
          setTimeout(onClose, 1500)
        } else if (j.status === 'rejected') {
          clearInterval(iv)
          setStep('rejected')
          setTimeout(onClose, 3000)
        }
      } catch {}
    }, 5000)
  }

  async function confirm() {
    setSaving(true); setErrMsg('')
    try {
      const cfg = getReceiptCfg()
      if (cfg.ip) await kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
    } catch (e) { console.warn('Drawer kick error:', e.message) }

    const dirLabel = direction === 'in' ? 'รับเงินเข้า' : 'เบิกเงินออก'
    const amtNum   = parseFloat(amount) || 0
    const fullNote = [dirLabel, amtNum ? `฿${amtNum.toLocaleString('th-TH')}` : null, noteText.trim()].filter(Boolean).join(' — ')

    try {
      await supabase.from('drawer_logs').insert({
        employee_name: 'แอดมิน', amount: amtNum || null, note: fullNote,
      })
    } catch {}

    fetch('/api/notify-drawer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeName: 'แอดมิน', note: fullNote,
        shopName: settings.shop_name || 'ร้านค้า',
        line_channel_token: settings.line_channel_token || '',
        line_group_id: settings.line_group_id || '',
      }),
    }).catch(() => {})

    // ถ่ายวิดีโอกล้อง (direct — ไม่ผ่าน relay เพื่อให้ URL ถูกต้องเสมอ)
    const timeCam = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
    fetch('/api/camera-snapshot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: `🔓 เปิดลิ้นชัก — แอดมิน  🕐 ${timeCam}` }),
    }).catch(() => {})

    setSaving(false); setStep('done')
    setTimeout(onClose, 1200)
  }

  function numKey(k) {
    setAmount(p => {
      if (k === '⌫') return p.slice(0, -1)
      if (k === '.' && p.includes('.')) return p
      if (p === '' && k === '.') return '0.'
      return p + k
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-xs shadow-2xl overflow-hidden fade-in"
        tabIndex={0} autoFocus
        onKeyDown={e => {
          if (step !== 'idle') return
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
          const k = e.key
          if (k >= '0' && k <= '9') { e.preventDefault(); numKey(k) }
          else if (k === '.') { e.preventDefault(); numKey('.') }
          else if (k === 'Backspace') { e.preventDefault(); numKey('⌫') }
          else if (k === 'Enter' || k === 'NumpadEnter') { e.preventDefault(); if (!saving) confirm() }
          else if (k === 'Escape') { e.preventDefault(); onClose() }
        }}>
        <div className="bg-[#0f1b14] text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-heading font-bold text-base">🔓 เปิดลิ้นชักเงิน</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>

        {step === 'done' ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-2">✅</div>
            <p className="font-bold text-emerald-600 text-lg">เปิดลิ้นชักแล้ว</p>
          </div>
        ) : step === 'opening' ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-2">⏳</div>
            <p className="font-bold text-brand text-lg">กำลังเปิดลิ้นชัก...</p>
          </div>
        ) : step === 'rejected' ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-2">❌</div>
            <p className="font-bold text-red-500 text-lg">ไม่อนุมัติ</p>
            <p className="text-sm text-slate-500 mt-1">admin ปฏิเสธคำขอเปิดลิ้นชัก</p>
          </div>
        ) : step === 'requested' ? (
          <div className="p-8 text-center">
            <div className="text-5xl mb-2">📨</div>
            <p className="font-bold text-amber-600 text-lg">ส่งคำขอแล้ว</p>
            <p className="text-sm text-slate-500 mt-1">รอ admin อนุมัติ ทาง Telegram…</p>
          </div>
        ) : isEmployee ? (
          <div className="p-4 space-y-3">
            <div className="bg-slate-50 rounded-2xl px-4 py-2.5 text-center border border-slate-100">
              <p className="text-xs text-slate-400 mb-0.5">พนักงาน</p>
              <p className="font-bold text-slate-700">{empName}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDir('in')}
                className={`py-3 rounded-2xl text-sm font-bold border-2 transition-all
                  ${direction === 'in' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400'}`}>
                💵 รับเงินเข้า
              </button>
              <button onClick={() => setDir('out')}
                className={`py-3 rounded-2xl text-sm font-bold border-2 transition-all
                  ${direction === 'out' ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-200 text-slate-400'}`}>
                💸 เบิกเงินออก
              </button>
            </div>
            <button className="w-full rounded-2xl px-4 py-3 text-right border-2 border-amber-400 bg-amber-50">
              <p className="text-xs text-slate-400 text-left mb-0.5">จำนวนเงิน (บาท)</p>
              <p className={`text-2xl font-bold ${amount ? 'text-slate-800' : 'text-slate-300'}`}>{amount || '0'}</p>
            </button>
            <input value={noteText} onChange={e => setNote(e.target.value)}
              placeholder="หมายเหตุ (ถ้ามี)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-amber-400 outline-none" />
            {errMsg && <p className="text-center text-red-500 text-xs font-semibold">{errMsg}</p>}
            <div className="grid grid-cols-3 gap-2">
              {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k, i) => (
                <button key={i} onClick={() => numKey(k)}
                  className={`h-12 rounded-2xl text-xl font-semibold transition-colors active:scale-95
                    ${k === '⌫' ? 'bg-red-50 text-red-400 hover:bg-red-100' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>
                  {k}
                </button>
              ))}
            </div>
            <button onClick={requestDrawer} disabled={saving}
              className="w-full bg-amber-500 text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-40 active:scale-[0.98] transition-transform shadow-lg shadow-amber-200">
              {saving ? '⏳ กำลังส่ง...' : `📨 ขอเปิดลิ้นชัก${amount ? ` ฿${parseFloat(amount).toLocaleString('th-TH')}` : ''}`}
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDir('in')}
                className={`py-3 rounded-2xl text-sm font-bold border-2 transition-all
                  ${direction === 'in' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400'}`}>
                💵 รับเงินเข้า
              </button>
              <button onClick={() => setDir('out')}
                className={`py-3 rounded-2xl text-sm font-bold border-2 transition-all
                  ${direction === 'out' ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-200 text-slate-400'}`}>
                💸 เบิกเงินออก
              </button>
            </div>

            <button onClick={() => {}}
              className="w-full rounded-2xl px-4 py-3 text-right border-2 border-brand bg-brand/5">
              <p className="text-xs text-slate-400 text-left mb-0.5">จำนวนเงิน (บาท)</p>
              <p className={`text-2xl font-bold ${amount ? 'text-slate-800' : 'text-slate-300'}`}>
                {amount || '0'}
              </p>
            </button>

            <input value={noteText} onChange={e => setNote(e.target.value)}
              placeholder="หมายเหตุ (ถ้ามี)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />

            {errMsg && <p className="text-center text-red-500 text-xs font-semibold">{errMsg}</p>}

            <div className="grid grid-cols-3 gap-2">
              {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k, i) => (
                <button key={i} onClick={() => numKey(k)}
                  className={`h-12 rounded-2xl text-xl font-semibold transition-colors active:scale-95
                    ${k === '⌫' ? 'bg-red-50 text-red-400 hover:bg-red-100' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>
                  {k}
                </button>
              ))}
            </div>

            <button onClick={confirm} disabled={saving}
              className={`w-full text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-40 active:scale-[0.98] transition-transform shadow-lg
                ${direction === 'out' ? 'bg-red-500 shadow-red-200' : 'bg-brand shadow-brand/30'}`}>
              {saving ? '⏳ กำลังเปิด...' : `✓ ยืนยัน${direction === 'in' ? 'รับเงินเข้า' : 'เบิกเงินออก'}`}
            </button>
          </div>
        )}
      </div>
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
        <div className="bg-brand-mid text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-bold text-base">👤 เลือกลูกค้า</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>
        <div className="p-4 space-y-3">
          <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
            placeholder="ค้นหาชื่อลูกค้า..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />

          <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
            {customers.map(c => (
              <button key={c.id} onClick={() => onSelect(c)}
                className="w-full px-4 py-3 text-left hover:bg-brand-50 transition-colors">
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
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="เบอร์โทร"
                className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
            </div>
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="ที่อยู่"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
            <input value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="เลขที่ผู้เสียภาษี (ถ้ามี)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
            <button onClick={addNew} disabled={!name.trim() || saving}
              className="w-full bg-brand text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-40">
              {saving ? '⏳...' : '+ บันทึกและเลือก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const DENOMS = [
  { v: 1000, label: '1,000', type: 'note' },
  { v: 500,  label: '500',   type: 'note' },
  { v: 100,  label: '100',   type: 'note' },
  { v: 50,   label: '50',    type: 'note' },
  { v: 20,   label: '20',    type: 'note' },
  { v: 10,   label: '10',    type: 'coin' },
  { v: 5,    label: '5',     type: 'coin' },
  { v: 2,    label: '2',     type: 'coin' },
  { v: 1,    label: '1',     type: 'coin' },
  { v: 0.5,  label: '0.50',  type: 'coin' },
]

function DenomRow({ denom, qty, onChange }) {
  const sub = (parseFloat(qty) || 0) * denom.v
  return (
    <div className="flex items-center gap-2">
      <div className={`shrink-0 w-16 text-center rounded-lg py-1 text-sm font-bold
        ${denom.type === 'note' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
        ฿{denom.label}
      </div>
      <span className="text-slate-300 text-xs shrink-0">×</span>
      <input
        type="number" inputMode="numeric" min="0" value={qty}
        onChange={e => onChange(e.target.value)}
        placeholder="0"
        className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-center text-sm font-semibold focus:border-brand outline-none"
      />
      <div className="w-20 text-right text-sm font-semibold tabular-nums shrink-0
        text-slate-700">
        {sub > 0 ? `฿${fmt(sub)}` : <span className="text-slate-300">—</span>}
      </div>
    </div>
  )
}

function ShiftModal({ mode, currentShift, empMode, settings, terminalId, terminalName, onClose, onOpened, onClosed }) {
  const initQtys = () => Object.fromEntries(DENOMS.map(d => [d.v, '']))
  const [qtys, setQtys]               = useState(initQtys)
  const [note, setNote]               = useState('')
  const [saving, setSaving]           = useState(false)
  const [shiftSummary, setShiftSummary] = useState(null)
  const [prevShift, setPrevShift]     = useState(null)
  // โซนเงินออก
  const [expSafe, setExpSafe]         = useState('')
  const [expWages, setExpWages]       = useState('')
  const [expAdvance, setExpAdvance]   = useState('')
  const [expOther, setExpOther]       = useState([]) // [{label, amount}]
  // ขอเปิดลิ้นชัก
  const [drawerReq, setDrawerReq]     = useState(null) // null|'sending'|'sent'|'error'
  const [recSessionId, setRecSessionId] = useState(null)

  const totalCash    = DENOMS.reduce((s, d) => s + (parseFloat(qtys[d.v]) || 0) * d.v, 0)
  const expSafeN     = parseFloat(expSafe)    || 0
  const expWagesN    = parseFloat(expWages)   || 0
  const expAdvanceN  = parseFloat(expAdvance) || 0
  const expOtherN    = expOther.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalExp     = expSafeN + expWagesN + expAdvanceN + expOtherN
  const cashRemaining = totalCash - totalExp
  const diff         = shiftSummary ? totalCash - shiftSummary.expected : 0

  useEffect(() => {
    if (mode === 'close' && currentShift) loadShiftSummary()
    if (mode === 'open') loadPrevShift()
  }, [mode, currentShift]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPrevShift() {
    const q = supabase.from('shifts')
      .select('cash_remaining, closing_cash, closed_at')
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(1)
    if (terminalId) q.eq('terminal_id', terminalId)
    const { data } = await q.maybeSingle()
    setPrevShift(data)
  }

  async function loadShiftSummary() {
    const from = currentShift.opened_at
    const tid  = currentShift.terminal_id || terminalId
    const salesQ = supabase.from('sales').select('total,payment_method,note,status').gte('created_at', from).eq('status','completed')
    if (tid) salesQ.eq('terminal_id', tid)
    const [{ data: sales }, { data: drawers }] = await Promise.all([
      salesQ,
      supabase.from('drawer_logs').select('amount,note').gte('opened_at', from),
    ])
    const salesTotal = (sales || []).reduce((s, r) => s + Number(r.total), 0)
    const cashSales  = (sales || []).reduce((s, r) => {
      if (r.payment_method === 'cash') return s + Number(r.total)
      if (r.payment_method === 'mixed' && r.note) {
        const m = r.note.match(/สด ฿([\d,]+(?:\.\d+)?)/)
        if (m) return s + parseFloat(m[1].replace(/,/g, ''))
      }
      return s
    }, 0)
    const drawerIn  = (drawers || []).filter(d => (d.note||'').includes('รับเงินเข้า')).reduce((s,d) => s + Number(d.amount||0), 0)
    const drawerOut = (drawers || []).filter(d => (d.note||'').includes('เบิกเงินออก')).reduce((s,d) => s + Number(d.amount||0), 0)
    const expected  = Number(currentShift.opening_cash) + cashSales + drawerIn - drawerOut
    setShiftSummary({ salesTotal, cashSales, drawerIn, drawerOut, expected, count: sales?.length || 0 })
  }

  function startShiftRec() {
    fetch('/api/camera-record', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    }).then(r => r.json()).then(j => { if (j.sessionId) setRecSessionId(j.sessionId) }).catch(() => {})
  }

  function stopShiftRec(caption) {
    const sid = recSessionId
    if (!sid) return
    setRecSessionId(null)
    fetch('/api/camera-record', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', sessionId: sid, caption }),
    }).catch(() => {})
  }

  function pollShiftDrawerApproval(requestId) {
    let attempts = 0
    const iv = setInterval(async () => {
      attempts++
      if (attempts > 60) { clearInterval(iv); return }
      try {
        const r = await fetch(`/api/request-drawer?id=${requestId}`)
        const j = await r.json()
        if (j.status === 'approved') {
          clearInterval(iv)
          try {
            const cfg = getReceiptCfg()
            if (cfg.ip) await kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
          } catch {}
          setDrawerReq('sent')
        } else if (j.status === 'rejected') {
          clearInterval(iv)
          setDrawerReq('error')
        }
      } catch {}
    }, 5000)
  }

  async function requestDrawerOpen() {
    const cfg = getReceiptCfg()
    if (!empMode && cfg.ip) {
      // admin — เปิดตรง
      setDrawerReq('sending')
      try {
        await kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
        startShiftRec()
        setDrawerReq('sent')
      } catch { setDrawerReq('error') }
      return
    }
    // employee — ส่ง request แล้ว poll รอ approve
    if (!empMode) { setDrawerReq('error'); return }
    setDrawerReq('sending')
    try {
      const res = await fetch('/api/request-drawer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: empMode.id, employee_name: empMode.name, note: `${mode === 'open' ? 'เปิดกะ' : 'ปิดกะ'} — นับเงิน` }),
      })
      const j = await res.json()
      if (j.error) { setDrawerReq('error'); return }
      startShiftRec()
      setDrawerReq('waiting')
      pollShiftDrawerApproval(j.request_id)
    } catch { setDrawerReq('error') }
  }

  async function openShift() {
    if (totalCash === 0) return alert('กรุณากรอกจำนวนธนบัตร/เหรียญ')
    setSaving(true)
    const { data, error } = await supabase.from('shifts')
      .insert({
        opening_cash: totalCash, opening_breakdown: qtys, note: note.trim() || null,
        terminal_id: terminalId || null,
        cashier_name: terminalName || empMode?.name || null,
      })
      .select().single()
    setSaving(false)
    if (error) return alert('เกิดข้อผิดพลาด: ' + error.message)
    const timeCam = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
    stopShiftRec(`🟢 เปิดกะเรียบร้อย 🕐 ${timeCam}`)
    onOpened(data)
  }

  async function closeShift() {
    if (totalCash === 0) return alert('กรุณากรอกจำนวนธนบัตร/เหรียญ')
    setSaving(true)
    const expected = shiftSummary?.expected || 0
    const { error } = await supabase.from('shifts').update({
      closed_at: new Date().toISOString(),
      closing_cash: totalCash,
      closing_breakdown: qtys,
      safe_amount: expSafeN,
      expense_wages: expWagesN,
      expense_advance: expAdvanceN,
      expense_other: expOther.filter(e => parseFloat(e.amount) > 0),
      cash_remaining: cashRemaining,
      expected_cash: expected,
      difference: diff,
      sales_total: shiftSummary?.salesTotal || 0,
      sales_count: shiftSummary?.count || 0,
      note: note.trim() || null,
      status: 'closed',
    }).eq('id', currentShift.id)
    if (!error) {
      fetch('/api/notify-shift-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cashierName: currentShift.cashier_name || (empMode?.name) || '',
          shopName: settings?.shop_name || 'ร้านค้า',
          openedAt: currentShift.opened_at,
          salesTotal: shiftSummary?.salesTotal || 0,
          salesCount: shiftSummary?.count || 0,
          cashSales: shiftSummary?.cashSales || 0,
          closingCash: totalCash,
          expected,
          diff,
          expSafe: expSafeN,
          expWages: expWagesN,
          expAdvance: expAdvanceN,
          expOther: expOther.filter(e => parseFloat(e.amount) > 0),
          cashRemaining,
        }),
      }).catch(() => {})
      const timeCam = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
      stopShiftRec(`🔴 ปิดกะ — ${currentShift.cashier_name || empMode?.name || ''}  🕐 ${timeCam}`)
    }
    setSaving(false)
    if (error) return alert('เกิดข้อผิดพลาด: ' + error.message)
    onClosed()
  }

  const drawerBtnLabel = drawerReq === 'sending' ? '⏳...'
    : drawerReq === 'waiting' ? '📨 รออนุมัติ...'
    : drawerReq === 'sent' ? '✅ เปิดแล้ว'
    : drawerReq === 'error' ? '❌ ล้มเหลว'
    : '🔓 เปิดลิ้นชักนับเงิน'

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => { if (e.target === e.currentTarget) { stopShiftRec(null); onClose() } }}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in flex flex-col" style={{maxHeight:'92vh'}}>

        <div className={`text-white px-4 py-3.5 flex justify-between items-center shrink-0 ${mode==='open' ? 'bg-emerald-700' : 'bg-red-600'}`}>
          <h2 className="font-bold text-base">{mode==='open' ? '🟢 เปิดกะ — นับเงิน' : '🔴 ปิดกะ — นับเงิน'}</h2>
          <button onClick={() => { stopShiftRec(null); onClose() }} className="text-2xl leading-none opacity-70">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">

          {/* ปุ่มขอเปิดลิ้นชัก */}
          <button onClick={requestDrawerOpen} disabled={drawerReq === 'sending' || drawerReq === 'waiting' || drawerReq === 'sent'}
            className="w-full border-2 border-dashed border-slate-300 rounded-2xl py-2.5 text-sm font-semibold text-slate-500 hover:border-brand hover:text-brand transition-colors disabled:opacity-50">
            {drawerBtnLabel}
          </button>

          {/* เปิดกะ: เงินคงเหลือจากกะก่อน */}
          {mode === 'open' && prevShift && (
            <div className="bg-blue-50 rounded-2xl p-3 border border-blue-100 text-sm space-y-1">
              <div className="font-semibold text-blue-700 text-xs mb-1">📋 กะก่อนหน้า (ปิด {new Date(prevShift.closed_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})})</div>
              <div className="flex justify-between font-bold">
                <span className="text-blue-700">เงินคงเหลือในลิ้นชัก</span>
                <span className="text-blue-900 tabular-nums">฿{fmt(prevShift.cash_remaining ?? prevShift.closing_cash)}</span>
              </div>
            </div>
          )}

          {/* ปิดกะ: สรุปกะ */}
          {mode === 'close' && shiftSummary && (
            <div className="bg-slate-50 rounded-2xl p-3 space-y-1.5 border border-slate-100">
              <div className="flex justify-between text-sm"><span className="text-slate-500">ยอดขายกะนี้</span><span className="font-bold text-brand">฿{fmt(shiftSummary.salesTotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">เงินสดรับ</span><span className="font-semibold text-slate-700">฿{fmt(shiftSummary.cashSales)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">เงินเริ่มต้น</span><span className="font-semibold text-slate-700">฿{fmt(currentShift.opening_cash)}</span></div>
              {shiftSummary.drawerIn > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">รับเงินเข้าเก๊ะ</span><span className="font-semibold text-emerald-600">+฿{fmt(shiftSummary.drawerIn)}</span></div>}
              {shiftSummary.drawerOut > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">เบิกเงินออกเก๊ะ</span><span className="font-semibold text-red-500">−฿{fmt(shiftSummary.drawerOut)}</span></div>}
              <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-1.5">
                <span className="text-slate-700">ควรมีในเก๊ะ</span>
                <span className="text-emerald-600">฿{fmt(shiftSummary.expected)}</span>
              </div>
            </div>
          )}

          {/* Denomination grid */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">แบงค์</p>
            <div className="space-y-1.5 mb-3">
              {DENOMS.filter(d => d.type === 'note').map(d => (
                <DenomRow key={d.v} denom={d} qty={qtys[d.v]} onChange={val => setQtys(p => ({...p, [d.v]: val}))} />
              ))}
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">เหรียญ</p>
            <div className="space-y-1.5">
              {DENOMS.filter(d => d.type === 'coin').map(d => (
                <DenomRow key={d.v} denom={d} qty={qtys[d.v]} onChange={val => setQtys(p => ({...p, [d.v]: val}))} />
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="bg-slate-800 rounded-2xl px-4 py-3 flex justify-between items-center">
            <span className="text-slate-400 text-sm font-medium">รวมทั้งหมด</span>
            <span className="text-white text-2xl font-bold tabular-nums">฿{fmt(totalCash)}</span>
          </div>

          {/* ปิดกะ: โซนเงินออก */}
          {mode === 'close' && (
            <>
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">💸 โซนเงินออก</div>
                <div className="p-3 space-y-2">
                  {[
                    { label: 'ฝากเซฟ', val: expSafe, set: setExpSafe },
                    { label: 'ค่าแรงพนักงาน', val: expWages, set: setExpWages },
                    { label: 'เงินเบิกล่วงหน้า', val: expAdvance, set: setExpAdvance },
                  ].map(({ label, val, set }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-sm text-slate-600 w-32 shrink-0">{label}</span>
                      <input type="number" inputMode="decimal" min="0" value={val}
                        onChange={e => set(e.target.value)} placeholder="0"
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-right text-sm font-semibold focus:border-red-400 outline-none tabular-nums" />
                    </div>
                  ))}
                  {/* ค่าใช้จ่ายอื่นๆ */}
                  {expOther.map((e, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input value={e.label} onChange={ev => setExpOther(p => p.map((x,j) => j===i ? {...x, label: ev.target.value} : x))}
                        placeholder="รายการ..." className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:border-red-400 outline-none" />
                      <input type="number" inputMode="decimal" min="0" value={e.amount}
                        onChange={ev => setExpOther(p => p.map((x,j) => j===i ? {...x, amount: ev.target.value} : x))}
                        placeholder="0" className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-right text-sm font-semibold focus:border-red-400 outline-none tabular-nums" />
                      <button onClick={() => setExpOther(p => p.filter((_,j) => j!==i))} className="text-slate-300 hover:text-red-400 font-bold text-lg leading-none px-1">×</button>
                    </div>
                  ))}
                  <button onClick={() => setExpOther(p => [...p, { label: '', amount: '' }])}
                    className="text-xs text-brand font-semibold mt-1">+ ค่าใช้จ่ายอื่นๆ</button>
                </div>
                <div className="border-t border-slate-200 px-3 py-2 flex justify-between text-sm">
                  <span className="text-slate-500">รวมเงินออก</span>
                  <span className="font-bold text-red-500 tabular-nums">−฿{fmt(totalExp)}</span>
                </div>
              </div>

              {/* เงินคงเหลือ */}
              <div className="bg-emerald-700 rounded-2xl px-4 py-3 flex justify-between items-center">
                <span className="text-emerald-100 text-sm font-medium">💰 เงินคงเหลือ (เปิดกะพรุ่งนี้)</span>
                <span className="text-white text-xl font-bold tabular-nums">฿{fmt(cashRemaining)}</span>
              </div>

              {/* ผลต่าง */}
              {totalCash > 0 && shiftSummary && (
                <div className={`rounded-2xl p-3 text-center font-bold text-lg ${diff >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {diff >= 0 ? '✅ เงินเกิน' : '⚠️ เงินขาด'}&nbsp;฿{fmt(Math.abs(diff))}
                </div>
              )}
            </>
          )}

          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="หมายเหตุ (ถ้ามี)"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />

          <button
            onClick={mode === 'open' ? openShift : closeShift}
            disabled={saving || totalCash === 0}
            className={`w-full text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-40
              ${mode === 'open' ? 'bg-emerald-600' : 'bg-red-500'}`}>
            {saving ? '⏳...' : mode === 'open' ? '✓ เปิดกะ' : '✓ ปิดกะ'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildReceiptHTML(r) {
  const PAY = { cash: 'เงินสด', transfer: 'โอน/QR', credit: 'เชื่อ', mixed: 'ผสม' }
  const rows = (r.items || []).map(i => `
    <tr>
      <td style="padding:4px 0;font-size:17px;word-break:break-word">${i.name}${i.note?`<br><span style="font-size:14px;color:#555">${i.note}</span>`:''}</td>
      <td style="text-align:center;font-size:17px;padding:4px 2px;white-space:nowrap">${i.qty}</td>
      <td style="text-align:right;font-size:17px;padding:4px 2px;white-space:nowrap">${Number(i.price).toFixed(2)}</td>
      <td style="text-align:right;font-size:17px;padding:4px 0;white-space:nowrap">${(i.price*i.qty-i.disc).toFixed(2)}</td>
    </tr>`).join('')
  const dt = new Date(r.created_at)
  const dtStr = dt.toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',monospace;font-size:17px;width:72mm;padding:4px 4px}
    .shop-logo{display:block;margin:0 auto 6px;max-width:60mm;max-height:28mm;object-fit:contain}
    h2{font-size:22px;font-weight:bold;text-align:center;margin-bottom:2px}
    h3{font-size:18px;font-weight:bold;text-align:center;margin-bottom:2px}
    .center{text-align:center;font-size:16px}
    .dash{border:none;border-top:1px dashed #000;margin:5px 0}
    table{width:100%;border-collapse:collapse}
    .th td{font-size:16px;font-weight:bold;border-bottom:1px dashed #000;padding-bottom:3px}
    .total-row td{font-size:20px;font-weight:bold;padding-top:4px}
    .meta{font-size:16px;display:flex;justify-content:space-between;padding:2px 0}
    .footer{text-align:center;margin-top:8px;font-size:16px}
    @media print{body{margin:0;padding:2px}}
  </style></head><body>
  ${r.shopLogo?`<img class="shop-logo" src="${r.shopLogo}"/>`:''}
  <h2>${r.shopName||'ร้านค้า'}</h2>
  <h3>ใบเสร็จรับเงิน</h3>
  ${r.shopAddress?`<p class="center">${r.shopAddress}</p>`:''}
  ${r.shopPhone?`<p class="center">โทร : ${r.shopPhone}</p>`:''}
  <hr class="dash">
  <div class="meta"><span>รายการ</span><span>จำนวน</span><span>ราคา</span><span>ราคารวม</span></div>
  <hr class="dash">
  <table>
    ${rows}
  </table>
  <hr class="dash">
  <table>
    <tr><td style="font-size:17px">รวม</td><td style="text-align:right;font-size:17px">${Number(r.subtotal).toFixed(2)}</td></tr>
    ${r.discount>0?`<tr><td style="font-size:17px">ส่วนลด</td><td style="text-align:right;font-size:17px">-${Number(r.discount).toFixed(2)}</td></tr>`:''}
    ${r.vat>0?`<tr><td style="font-size:17px">VAT ${(r.vatRate*100).toFixed(0)}%</td><td style="text-align:right;font-size:17px">${Number(r.vat).toFixed(2)}</td></tr>`:''}
    <tr class="total-row"><td>สุทธิ</td><td style="text-align:right">${Number(r.total).toFixed(2)}</td></tr>
    <tr><td style="font-size:17px">${PAY[r.payment_method]||r.payment_method||''}</td><td style="text-align:right;font-size:17px">${r.payment_amount?Number(r.payment_amount).toFixed(2):''}</td></tr>
    ${r.change>0?`<tr><td style="font-size:17px">เงินทอน</td><td style="text-align:right;font-size:17px">${Number(r.change).toFixed(2)}</td></tr>`:''}
  </table>
  <hr class="dash">
  ${r.customerName?`<div class="meta"><span>ลูกค้า</span><span>${r.customerName}${r.customerPhone?` ${r.customerPhone}`:''}</span></div>`:''}
  ${r.cashier?`<div class="meta"><span>พนักงาน</span><span>${r.cashier}</span></div>`:''}
  ${r.note?`<div style="font-size:15px;padding:3px 0">หมายเหตุ: ${r.note}</div>`:''}
  <div class="meta"><span>เลขที่</span><span>${r.receipt_no}</span></div>
  <div class="meta"><span></span><span style="font-size:15px">** ${dtStr} **</span></div>
  <hr class="dash">
  <div class="footer">${r.footer||'ขอบคุณที่ใช้บริการ'}</div>
  ${r.lineQr?`<hr class="dash"><p class="center" style="font-size:15px;margin-bottom:4px">ติดตามร้านค้าผ่าน LINE</p><img src="${r.lineQr}" style="display:block;margin:0 auto;max-width:40mm;max-height:40mm"/>`:''}

  <script>window.onload=()=>{window.focus();window.print()}</script>
  </body></html>`
}

const CART_DOC_TYPES = [
  { value: 'quotation',        label: '📝 ใบเสนอราคา' },
  { value: 'delivery_invoice', label: '📦 ใบส่งของ/ใบแจ้งหนี้' },
  { value: 'receipt',          label: '🧾 ใบเสร็จรับเงิน' },
]

function CartDocModal({ cart, totals, customer, settings, onClose, onSaved }) {
  const [docType, setDocType] = useState('quotation')
  const [custName, setCustName]   = useState(customer?.name || '')
  const [custAddr, setCustAddr]   = useState(customer?.address || '')
  const [custPhone, setCustPhone] = useState(customer?.phone || '')
  const [custTaxId, setCustTaxId] = useState(customer?.tax_id || '')
  const [docNo, setDocNo]         = useState('')
  const [docDate, setDocDate]     = useState(new Date().toISOString().slice(0, 10))
  const [validUntil, setValidUntil] = useState('')

  useEffect(() => {
    previewNextDocNo(docType).then(no => setDocNo(no))
  }, [docType])

  async function generate() {
    const win = window.open('', '_blank')
    const finalDocNo = await commitNextDocNo(docType)
    const docItems = cart.map(i => ({
      pid: i.pid || null, name: i.name, barcode: i.barcode || '',
      unit: i.unit || '', price: i.price, cost: i.cost || 0,
      qty: i.qty, disc: i.disc || 0, note: i.note || null,
      subtotal: i.price * i.qty - (i.disc || 0),
    }))
    const html = buildFormalDocHTML(
      docType, docItems, totals,
      { name: custName, address: custAddr, phone: custPhone, tax_id: custTaxId },
      settings,
      { doc_no: finalDocNo, date: docDate, valid_until: validUntil || undefined }
    )
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    if (win) { win.location.href = url } else { window.open(url, '_blank') }
    setTimeout(() => URL.revokeObjectURL(url), 60000)

    // บันทึกลง DB เป็น pending quotation
    const { data: saved } = await supabase.from('quotations').insert({
      doc_no: finalDocNo, doc_type: docType,
      customer_name: custName || null, customer_phone: custPhone || null,
      customer_address: custAddr || null, customer_tax_id: custTaxId || null,
      items: docItems,
      subtotal: totals.subtotal, discount: totals.discount,
      vat: totals.vat, total: totals.total,
      status: 'pending',
    }).select().single()
    if (saved && onSaved) onSaved(saved)

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

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">เลขที่เอกสาร</label>
              <input value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="เช่น QT2506001"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">วันที่</label>
              <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
            </div>
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
            🖨️ สร้างเอกสาร + บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}

const fmtQ = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function PendingQuotesModal({ quotes, onLoad, onCancel, onClose }) {
  const DOC_LABEL = { quotation: 'ใบเสนอราคา', delivery_invoice: 'ใบแจ้งหนี้', invoice: 'ใบแจ้งหนี้', delivery: 'ใบส่งของ' }
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden fade-in flex flex-col" style={{maxHeight:'88vh'}}>
        <div className="bg-emerald-700 text-white px-4 py-3.5 flex justify-between items-center shrink-0">
          <h2 className="font-bold text-base">💳 บิลรอชำระ</h2>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {quotes.length === 0 && (
            <div className="py-16 text-center text-slate-400 text-sm">ไม่มีบิลรอชำระ</div>
          )}
          {quotes.map(q => (
            <div key={q.id} className="p-4 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-slate-800 text-sm">{q.doc_no}</p>
                  <p className="text-xs text-slate-400">{DOC_LABEL[q.doc_type] || q.doc_type} · {new Date(q.created_at).toLocaleString('th-TH',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</p>
                  {q.customer_name && <p className="text-xs text-slate-500 mt-0.5">👤 {q.customer_name}{q.customer_phone ? ` · ${q.customer_phone}` : ''}</p>}
                </div>
                <span className="font-bold text-brand text-base shrink-0 ml-2">฿{fmtQ(q.total)}</span>
              </div>
              <p className="text-xs text-slate-400">{(q.items||[]).length} รายการ: {(q.items||[]).slice(0,3).map(i=>`${i.name} ×${i.qty}`).join(', ')}{(q.items||[]).length > 3 ? '...' : ''}</p>
              <div className="flex gap-2">
                <button onClick={() => onLoad(q)}
                  className="flex-1 bg-emerald-600 text-white font-bold py-2 rounded-xl text-sm active:scale-95 transition-transform">
                  รับชำระ →
                </button>
                <button onClick={() => { if (confirm('ยกเลิกบิลนี้?')) onCancel(q.id) }}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-400 text-sm hover:bg-red-50 hover:text-red-400 transition-colors">
                  ยกเลิก
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

