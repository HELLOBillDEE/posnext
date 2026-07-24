'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { printViaBridge, buildReceiptESCPOS } from '@/lib/printBridge'
import { cacheSet, cacheGet, addToQueue, genOfflineRepairNo } from '@/lib/offlineQueue'

const STATUS = {
  waiting:     { label: 'รอรับงาน',    emoji: '⏳', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.3)'  },
  in_progress: { label: 'กำลังซ่อม',   emoji: '🔧', color: '#C72C41', bg: 'rgba(199,44,65,0.15)',   border: 'rgba(199,44,65,0.3)'   },
  done:        { label: 'เสร็จ รอรับ', emoji: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.3)'  },
  picked_up:   { label: 'รับแล้ว',     emoji: '📦', color: '#801336', bg: 'rgba(128,19,54,0.15)',   border: 'rgba(128,19,54,0.3)'   },
  cancelled:   { label: 'ยกเลิก',      emoji: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.25)'  },
}
const STATUS_ORDER = ['waiting', 'in_progress', 'done', 'picked_up']

const TABS = [
  { key: 'all',         label: 'ทั้งหมด' },
  { key: 'waiting',     label: '⏳ รอรับงาน' },
  { key: 'in_progress', label: '🔧 กำลังซ่อม' },
  { key: 'done',        label: '✅ เสร็จ รอรับ' },
  { key: 'picked_up',   label: '📦 รับแล้ว' },
]

const EMPTY_FORM = {
  customer_name: '', phone: '', device: '', description: '',
  appointment_date: '', appointment_time: '', price: '', deposit: '', note: '', status: 'waiting',
  technician_id: null, technician_name: '',
}

function fmt(n) {
  if (!n && n !== 0) return '—'
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

async function printRepairReceipt(job, settings, receiptCfg, barcodeCfg) {
  const cfg = receiptCfg || JSON.parse(typeof localStorage !== 'undefined' ? localStorage.getItem('printer_receipt') || '{}' : '{}')
  const dt = new Date(job.created_at)
  const dtStr = dt.toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
  const apptDate = job.appointment_date ? new Date(job.appointment_date + 'T00:00:00').toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) : ''
  const apptStr = apptDate ? `${apptDate}${job.appointment_time ? ' ' + job.appointment_time : ''}` : ''
  const pm = parseInt(cfg.paper_mm) || 80
  const w = pm >= 80 ? '72mm' : '48mm'

  // ─── ใบรับเครื่อง (receipt printer) ───
  if (cfg.ip) {
    try {
      const bytes = await buildRepairESCPOS(job, settings, pm, dtStr, apptStr)
      await printViaBridge('', cfg.ip, cfg.port || 9100, bytes)
    } catch (e) {
      console.error('receipt print error', e)
      alert('❌ พิมใบนัดไม่ได้: ' + (e?.message || e) + '\nตรวจสอบ IP เครื่องพิมพ์ในหน้า Admin')
    }
  } else {
    const html = buildRepairHTML(job, settings, w, dtStr, apptStr)
    // ใช้ iframe แทน window.open เพื่อหลีกเลี่ยง popup blocker
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

  // ─── สติ๊กเกอร์เลขคิว (barcode printer) ───
  const bcfg = barcodeCfg || JSON.parse(typeof localStorage !== 'undefined' ? localStorage.getItem('printer_barcode') || '{}' : '{}')
  if (bcfg.ip) {
    try {
      const bytes = await buildQueueSticker(job.repair_no, bcfg)
      await printViaBridge('', bcfg.ip, bcfg.port || 9100, bytes)
    } catch (e) { console.error('sticker print error', e) }
  }
}

function buildRepairHTML(job, settings, w, dtStr, apptStr) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Kanit',sans-serif;width:${w};padding:4px 6px;background:#fff;color:#000}
.shop{font-size:18px;font-weight:bold;text-align:center}
.tag{font-size:12px;text-align:center;color:#555;margin-bottom:4px}
.dash{border:none;border-top:1px dashed #000;margin:5px 0}
.no{font-size:30px;font-weight:bold;text-align:center;letter-spacing:1px}
.dt{font-size:12px;text-align:center;color:#555}
.row{display:flex;gap:6px;font-size:14px;padding:2px 0}
.lb{color:#555;min-width:52px;font-size:12px;flex-shrink:0}
.vl{flex:1;word-break:break-word;font-weight:500}
.price{font-size:22px;font-weight:bold;text-align:center}
.foot{text-align:center;font-size:12px;color:#555;margin-top:4px}
@media print{body{margin:0}}</style></head><body>
<p class="shop">${settings.shop_name||'ร้านค้า'}</p>
<p class="tag">— ใบรับเครื่อง —</p>
<hr class="dash">
<p class="no">${job.repair_no}</p>
<p class="dt">${dtStr}</p>
<hr class="dash">
<div class="row"><span class="lb">ชื่อ</span><span class="vl">${job.customer_name||''}</span></div>
${job.phone?`<div class="row"><span class="lb">เบอร์</span><span class="vl">${job.phone}</span></div>`:''}
<hr class="dash">
<div class="row"><span class="lb">อุปกรณ์</span><span class="vl">${job.device}</span></div>
${job.description?`<div class="row"><span class="lb">อาการ</span><span class="vl">${job.description}</span></div>`:''}
${job.note?`<div class="row"><span class="lb">หมายเหตุ</span><span class="vl">${job.note}</span></div>`:''}
${job.price?`<hr class="dash"><p class="price">฿${Number(job.price).toFixed(2)}</p>${job.deposit?`<p class="dt">มัดจำ ฿${Number(job.deposit).toFixed(2)}</p>`:''}`:''}
${apptStr?`<hr class="dash"><div class="row"><span class="lb">📅 นัดรับ</span><span class="vl" style="font-weight:bold">${apptStr}</span></div>`:''}
<hr class="dash">
<p class="foot">ขอบคุณที่ใช้บริการ</p>
${settings.shop_phone?`<p class="foot">โทร ${settings.shop_phone}</p>`:''}
<script>window.onload=()=>{window.focus();window.print()}</script></body></html>`
}

async function buildRepairESCPOS(job, settings, paperMM, dtStr, apptStr) {
  const pw    = paperMM >= 80 ? 576 : 384
  const PAD   = 16
  const INNER = pw - PAD * 2
  const FSM   = 24, FMD = 32, FLG = 44, FXL = 60

  // ─── build draw list ───
  const dl = []
  const add = (text, opts = {}) => dl.push({ text: String(text ?? ''), align: opts.align || 'left', size: opts.size || FSM, bold: !!opts.bold, mt: opts.mt || 0 })
  const div = () => dl.push({ divider: true })
  const sp  = (n = 1) => { for (let i = 0; i < n; i++) add('', { size: FSM }) }

  add(settings.shop_name || 'ร้านค้า', { align: 'center', size: FMD, bold: true })
  add('— ใบรับเครื่อง —', { align: 'center', size: FSM })
  div()
  add('เลขที่', { align: 'center', size: FSM })
  add(job.repair_no, { align: 'center', size: FXL, bold: true })
  add(dtStr, { align: 'center', size: Math.round(FSM * 0.85) })
  div()
  add('ชื่อลูกค้า', { size: Math.round(FSM * 0.85) })
  add(job.customer_name || '', { size: FMD, bold: true })
  if (job.phone) {
    add('เบอร์โทร', { size: Math.round(FSM * 0.85), mt: 6 })
    add(job.phone, { size: FMD, bold: true })
  }
  div()
  add('อุปกรณ์', { size: Math.round(FSM * 0.85) })
  add(job.device, { size: FMD, bold: true })
  if (job.description) { add('อาการ', { size: Math.round(FSM * 0.85), mt: 6 }); add(job.description, { size: FSM }) }
  if (job.note)        { add('หมายเหตุ', { size: Math.round(FSM * 0.85), mt: 6 }); add(job.note, { size: FSM }) }
  if (job.price) {
    div()
    add('ราคาประเมิน', { align: 'center', size: FSM })
    add('฿' + Number(job.price).toFixed(2), { align: 'center', size: FXL, bold: true })
    if (job.deposit) add('มัดจำ ฿' + Number(job.deposit).toFixed(2), { align: 'center', size: FSM })
  }
  if (apptStr) {
    div()
    add('วันนัดรับ', { align: 'center', size: FSM })
    add(apptStr, { align: 'center', size: FLG, bold: true })
  }
  div()
  add('ขอบคุณที่ใช้บริการ', { align: 'center', size: FSM })
  if (settings.shop_phone) add('โทร ' + settings.shop_phone, { align: 'center', size: FSM })
  sp(4)

  // ─── helper: wrap long text ───
  const tmpC = document.createElement('canvas'); tmpC.width = pw; tmpC.height = 1
  const tmpX = tmpC.getContext('2d')
  function wrap(ctx, text, maxW, size, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Kanit,Arial,sans-serif`
    if (!text || ctx.measureText(text).width <= maxW) return [text || '']
    const chars = [...text]; const ls = []; let cur = ''
    for (const ch of chars) { if (ctx.measureText(cur + ch).width > maxW) { ls.push(cur); cur = ch } else cur += ch }
    if (cur) ls.push(cur)
    return ls
  }

  // ─── measure total height ───
  let totalH = 0
  for (const d of dl) {
    if (d.divider) { totalH += 10; continue }
    totalH += d.mt
    const lh = Math.round(d.size * 1.45)
    totalH += lh * wrap(tmpX, d.text, INNER, d.size, d.bold).length
  }

  // ─── draw ───
  const canvas = document.createElement('canvas')
  canvas.width = pw; canvas.height = totalH + 16
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, canvas.height)
  ctx.fillStyle = '#000'

  let y = 8
  for (const d of dl) {
    if (d.divider) { ctx.fillRect(PAD, y + 4, INNER, 1); y += 10; continue }
    y += d.mt
    const lh = Math.round(d.size * 1.45)
    ctx.font = `${d.bold ? 'bold ' : ''}${d.size}px Kanit,Arial,sans-serif`
    for (const wl of wrap(ctx, d.text, INNER, d.size, d.bold)) {
      const tw = ctx.measureText(wl).width
      let x = PAD
      if (d.align === 'center') x = Math.max(PAD, Math.floor((pw - tw) / 2))
      else if (d.align === 'right') x = pw - PAD - tw
      ctx.textAlign = 'left'
      ctx.fillText(wl, x, y + d.size)
      y += lh
    }
  }

  // ─── canvas → ESC/POS GS v 0 bitmap ───
  const imgData = ctx.getImageData(0, 0, pw, canvas.height)
  const wBytes = Math.ceil(pw / 8)
  const bitmap = new Uint8Array(wBytes * canvas.height)
  for (let row = 0; row < canvas.height; row++)
    for (let col = 0; col < pw; col++) {
      const i = (row * pw + col) * 4
      const lum = (imgData.data[i] * 299 + imgData.data[i+1] * 587 + imgData.data[i+2] * 114) / 1000
      if (lum < 128) bitmap[row * wBytes + (col >> 3)] |= (0x80 >> (col & 7))
    }
  const GS = 0x1D, b = [0x1B, 0x40]
  b.push(GS, 0x76, 0x30, 0x00)
  b.push(wBytes & 0xFF, (wBytes >> 8) & 0xFF)
  b.push(canvas.height & 0xFF, (canvas.height >> 8) & 0xFF)
  for (const byte of bitmap) b.push(byte)
  b.push(GS, 0x56, 0x00)
  return new Uint8Array(b)
}

async function buildQueueSticker(repairNo, bcfg) {
  const lang  = bcfg.lang || 'tspl'
  const DPI   = 203
  const mm2d  = mm => Math.round(mm * DPI / 25.4)
  // label เดียว = 1/3 ของกระดาษ 100x25mm → ~32x25mm
  const lw    = 32
  const lh    = 25
  const lwD   = mm2d(lw)
  const lhD   = mm2d(lh)
  const wBytes = Math.ceil(lwD / 8)

  const canvas = document.createElement('canvas')
  canvas.width = lwD; canvas.height = lhD
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lwD, lhD)
  ctx.fillStyle = '#000'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'

  // หาขนาด font ที่พอดีกับ label
  let fs = Math.round(lhD * 0.55)
  ctx.font = `bold ${fs}px Kanit,Arial,sans-serif`
  while (ctx.measureText(repairNo).width > lwD - 4 && fs > 10) {
    fs -= 1
    ctx.font = `bold ${fs}px Kanit,Arial,sans-serif`
  }
  ctx.fillText(repairNo, lwD / 2, lhD / 2)

  const imgData = ctx.getImageData(0, 0, lwD, lhD)

  if (lang === 'escpos') {
    const bitmap = new Uint8Array(wBytes * lhD)
    for (let y = 0; y < lhD; y++)
      for (let x = 0; x < lwD; x++) {
        const i = (y * lwD + x) * 4
        const lum = (imgData.data[i]*299 + imgData.data[i+1]*587 + imgData.data[i+2]*114) / 1000
        if (lum < 128) bitmap[y * wBytes + (x >> 3)] |= (0x80 >> (x & 7))
      }
    const GS = 0x1D, b = [0x1B, 0x40]
    b.push(GS, 0x76, 0x30, 0x00, wBytes&0xFF, (wBytes>>8)&0xFF, lhD&0xFF, (lhD>>8)&0xFF)
    for (const byte of bitmap) b.push(byte)
    b.push(0x0A, GS, 0x56, 0x00)
    return new Uint8Array(b)
  } else {
    const tsplBmp = new Uint8Array(wBytes * lhD).fill(0xFF)
    for (let y = 0; y < lhD; y++)
      for (let x = 0; x < lwD; x++) {
        const i = (y * lwD + x) * 4
        const lum = (imgData.data[i]*299 + imgData.data[i+1]*587 + imgData.data[i+2]*114) / 1000
        if (lum < 128) tsplBmp[y * wBytes + (x >> 3)] &= ~(0x80 >> (x & 7))
      }
    const buf = []; const ascii = s => { for (const c of s) buf.push(c.charCodeAt(0)) }
    const crlf = () => buf.push(0x0D, 0x0A)
    ascii(`SIZE ${lw} mm, ${lh} mm`); crlf()
    ascii(`GAP 2 mm, 0 mm`); crlf()
    ascii(`DIRECTION 0`); crlf()
    ascii(`CLS`); crlf()
    ascii(`BITMAP 0,0,${wBytes},${lhD},0,`)
    for (const byte of tsplBmp) buf.push(byte); crlf()
    ascii(`PRINT 1,1`); crlf()
    return new Uint8Array(buf)
  }
}

async function buildQuoteESCPOS(job, items, subtotal, deposit, total, shopSettings, paperMM) {
  const pw    = (paperMM || 80) >= 80 ? 576 : 384
  const PAD   = 16, INNER = pw - PAD * 2
  const FSM = 24, FMD = 32, FLG = 44

  const dl = []
  const add = (text, opts = {}) => dl.push({ text: String(text ?? ''), align: opts.align || 'left', size: opts.size || FSM, bold: !!opts.bold, mt: opts.mt || 0 })
  const div = () => dl.push({ divider: true })
  const sp  = (n = 1) => { for (let i = 0; i < n; i++) add('', { size: FSM }) }

  const dt = new Date()
  const dtStr = dt.toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
  const fmtN = n => (n||0).toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2})

  add(shopSettings.shop_name || 'ร้านค้า', { align: 'center', size: FMD, bold: true })
  add('— ใบแจ้งรายการซ่อม —', { align: 'center', size: FSM })
  div()
  add(job.repair_no, { align: 'center', size: FLG, bold: true })
  add(dtStr, { align: 'center', size: Math.round(FSM * 0.85) })
  div()
  add('ลูกค้า', { size: Math.round(FSM * 0.85) })
  add(job.customer_name || '', { size: FMD, bold: true })
  if (job.phone) { add('เบอร์', { size: Math.round(FSM * 0.85), mt: 4 }); add(job.phone, { size: FSM }) }
  add('อุปกรณ์', { size: Math.round(FSM * 0.85), mt: 4 })
  add(job.device || '', { size: FMD, bold: true })
  div()

  for (const it of items) {
    const qty = parseFloat(it.qty) || 1
    const price = parseFloat(it.price) || 0
    add(it.product_name || '', { size: FSM })
    const right = qty !== 1 ? `${qty} × ฿${fmtN(price)}  =  ฿${fmtN(price * qty)}` : `฿${fmtN(price)}`
    add(right, { size: FSM, align: 'right' })
  }
  div()

  if (deposit > 0) {
    add(`รวม  ฿${fmtN(subtotal)}`, { align: 'right', size: FSM })
    add(`มัดจำ  -฿${fmtN(deposit)}`, { align: 'right', size: FSM })
  }
  add(`ยอดที่ต้องชำระ  ฿${fmtN(total)}`, { align: 'right', size: FMD, bold: true })
  div()
  add('** กรุณาชำระที่เคาน์เตอร์ **', { align: 'center', size: FSM })
  if (shopSettings.shop_phone) add('โทร ' + shopSettings.shop_phone, { align: 'center', size: FSM })
  sp(4)

  // canvas → ESC/POS bitmap
  const tmpC = document.createElement('canvas'); tmpC.width = pw; tmpC.height = 1
  const tmpX = tmpC.getContext('2d')
  function wrap(ctx, text, maxW, size, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Kanit,Arial,sans-serif`
    if (!text || ctx.measureText(text).width <= maxW) return [text || '']
    const chars = [...text]; const ls = []; let cur = ''
    for (const ch of chars) { if (ctx.measureText(cur + ch).width > maxW) { ls.push(cur); cur = ch } else cur += ch }
    if (cur) ls.push(cur)
    return ls
  }
  let totalH = 0
  for (const d of dl) {
    if (d.divider) { totalH += 10; continue }
    totalH += d.mt
    totalH += Math.round(d.size * 1.45) * wrap(tmpX, d.text, INNER, d.size, d.bold).length
  }
  const canvas = document.createElement('canvas')
  canvas.width = pw; canvas.height = totalH + 16
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, canvas.height); ctx.fillStyle = '#000'
  let y = 8
  for (const d of dl) {
    if (d.divider) { ctx.fillRect(PAD, y + 4, INNER, 1); y += 10; continue }
    y += d.mt
    const lh = Math.round(d.size * 1.45)
    ctx.font = `${d.bold ? 'bold ' : ''}${d.size}px Kanit,Arial,sans-serif`
    for (const wl of wrap(ctx, d.text, INNER, d.size, d.bold)) {
      const tw = ctx.measureText(wl).width
      let x = PAD
      if (d.align === 'center') x = Math.max(PAD, Math.floor((pw - tw) / 2))
      else if (d.align === 'right') x = pw - PAD - tw
      ctx.textAlign = 'left'; ctx.fillText(wl, x, y + d.size); y += lh
    }
  }
  const imgData = ctx.getImageData(0, 0, pw, canvas.height)
  const wBytes = Math.ceil(pw / 8)
  const bitmap = new Uint8Array(wBytes * canvas.height)
  for (let row = 0; row < canvas.height; row++)
    for (let col = 0; col < pw; col++) {
      const i = (row * pw + col) * 4
      const lum = (imgData.data[i]*299 + imgData.data[i+1]*587 + imgData.data[i+2]*114) / 1000
      if (lum < 128) bitmap[row * wBytes + (col >> 3)] |= (0x80 >> (col & 7))
    }
  const GS = 0x1D, b = [0x1B, 0x40]
  b.push(GS, 0x76, 0x30, 0x00, wBytes&0xFF, (wBytes>>8)&0xFF, canvas.height&0xFF, (canvas.height>>8)&0xFF)
  for (const byte of bitmap) b.push(byte)
  b.push(GS, 0x56, 0x00)
  return new Uint8Array(b)
}

export default function RepairPage() {
  const [jobs, setJobs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState('all')
  const [search, setSearch]           = useState('')
  const [modal, setModal]             = useState(null)
  const [form, setForm]               = useState(EMPTY_FORM)
  const [editId, setEditId]           = useState(null)
  const [saving, setSaving]           = useState(false)

  // quote modal state
  const [quoteJob, setQuoteJob]           = useState(null)
  const [quoteItems, setQuoteItems]       = useState([])
  const [quoteSaving, setQuoteSaving]     = useState(false)
  const [quotedJobIds, setQuotedJobIds]   = useState(new Set())
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState([])
  const [settings, setSettings]           = useState({})
  const [printerCfg, setPrinterCfg]       = useState({ receipt: null, barcode: null })
  const [employees, setEmployees]         = useState([])
  const [isEmp, setIsEmp]                 = useState(false)
  const [embed, setEmbed]                 = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('repair_orders').select('*')
        .order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      setJobs(data || [])
      cacheSet('repairs', data || [])
      const doneIds = (data || []).filter(j => j.status === 'done' && !j.sale_id).map(j => j.id)
      if (doneIds.length) {
        supabase.from('quotations').select('repair_order_id')
          .in('repair_order_id', doneIds).eq('status', 'pending')
          .then(({ data: qs }) => setQuotedJobIds(new Set((qs || []).map(q => q.repair_order_id))))
      } else {
        setQuotedJobIds(new Set())
      }
    } catch {
      const cached = cacheGet('repairs')
      if (cached) setJobs(cached)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setIsEmp(document.cookie.includes('pos_emp=1'))
  }, [])
  useEffect(() => {
    setEmbed(new URLSearchParams(window.location.search).get('embed') === '1')
  }, [])
  useEffect(() => {
    const onSynced = () => load()
    window.addEventListener('offline-synced', onSynced)
    return () => window.removeEventListener('offline-synced', onSynced)
  }, [load])

  useEffect(() => {
    supabase.from('employees').select('id,name,nickname,repair_commission_pct').eq('active', true).order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  useEffect(() => {
    supabase.from('settings').select('key,value')
      .in('key', ['shop_name','shop_address','shop_phone','printer_receipt','printer_barcode'])
      .then(({ data }) => {
        const m = {}; (data||[]).forEach(r => m[r.key]=r.value); setSettings(m)
        const parseCfg = (val, fallbackKey) => {
          try { if (val) return JSON.parse(val) } catch {}
          try { const ls = localStorage.getItem(fallbackKey); if (ls) return JSON.parse(ls) } catch {}
          return null
        }
        const receipt = parseCfg(m['printer_receipt'], 'printer_receipt')
        const barcode = parseCfg(m['printer_barcode'], 'printer_barcode')
        setPrinterCfg({ receipt, barcode })
        if (receipt) try { localStorage.setItem('printer_receipt', JSON.stringify(receipt)) } catch {}
        if (barcode) try { localStorage.setItem('printer_barcode', JSON.stringify(barcode)) } catch {}
      })
  }, [])

  // product search for parts
  useEffect(() => {
    if (!productSearch.trim()) { setProductResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('products')
        .select('id,name,price,cost,unit').ilike('name', `%${productSearch}%`).limit(8)
      setProductResults(data || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [productSearch])

  // ── Status update ──
  async function updateStatus(job, newStatus) {
    await supabase.from('repair_orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', job.id)
    await load()
  }

  async function reprintReceipt(job) {
    await printRepairReceipt(job, settings, printerCfg.receipt, printerCfg.barcode)
  }

  async function reprintSticker(job) {
    const bcfg = printerCfg.barcode || JSON.parse(localStorage.getItem('printer_barcode') || '{}')
    if (!bcfg.ip) { alert('ยังไม่ได้ตั้งค่า IP เครื่องพิมพ์สติ๊กเกอร์\nไปที่ Admin → เครื่องพิมพ์ → Barcode Printer'); return }
    try {
      const bytes = await buildQueueSticker(job.repair_no, bcfg)
      await printViaBridge('', bcfg.ip, bcfg.port || 9100, bytes)
    } catch (e) { alert('พิมพ์ไม่ได้: ' + e.message) }
  }

  // ── Open quote modal ──
  function openQuote(job) {
    setQuoteJob(job)
    setQuoteItems([{
      product_id: null,
      product_name: `ค่าซ่อม: ${job.device}${job.description ? ` (${job.description})` : ''}`,
      qty: 1,
      price: job.price || 0,
      cost: 0,
      unit: 'งาน',
      is_labor: true,
      tech_id: job.technician_id || null,
      tech_name: job.technician_name || '',
    }])
    setProductSearch('')
    setProductResults([])
  }

  function closeQuote() { setQuoteJob(null); setQuoteItems([]) }

  async function saveQuote(thenGoToPOS = false) {
    if (quoteItems.length === 0) return
    setQuoteSaving(true)
    try {
      let customerId = null
      if (quoteJob.phone) {
        const { data: cust } = await supabase.from('customers').select('id').eq('phone', quoteJob.phone).single()
        customerId = cust?.id || null
      }
      const deposit  = parseFloat(quoteJob.deposit) || 0
      const subtotal = quoteItems.reduce((s, it) => s + (parseFloat(it.price)||0) * (parseFloat(it.qty)||1), 0)
      const total    = Math.max(0, subtotal - deposit)
      const items    = quoteItems.map(it => ({
        pid: it.product_id || null, barcode: '', unit: it.unit || 'งาน',
        cost: parseFloat(it.cost) || 0, disc: 0,
        qty: parseFloat(it.qty) || 1, price: parseFloat(it.price) || 0,
        name: it.product_name, note: '',
        is_labor: it.is_labor ?? false,
        tech_id: it.tech_id || null,
        tech_name: it.tech_name || null,
      }))

      const { data: existing } = await supabase.from('quotations')
        .select('id').eq('repair_order_id', quoteJob.id).eq('status', 'pending').maybeSingle()

      if (existing) {
        const { error } = await supabase.from('quotations').update({
          customer_id: customerId, customer_name: quoteJob.customer_name,
          customer_phone: quoteJob.phone || null,
          items, subtotal, discount: deposit, vat: 0, total,
        }).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('quotations').insert({
          doc_no: `RP${Date.now()}`, doc_type: 'repair',
          customer_id: customerId, customer_name: quoteJob.customer_name,
          customer_phone: quoteJob.phone || null,
          items, subtotal, discount: deposit, vat: 0, total,
          note: `[ซ่อม:${quoteJob.repair_no}]`,
          status: 'pending', repair_order_id: quoteJob.id,
        })
        if (error) throw error
      }

      setQuotedJobIds(prev => new Set([...prev, quoteJob.id]))

      // พิมพ์ใบแจ้งรายการซ่อม (ถ้ามีเครื่องพิมพ์)
      const rcfg = printerCfg.receipt
      if (rcfg?.ip) {
        buildQuoteESCPOS(quoteJob, quoteItems, subtotal, deposit, total, settings, parseInt(rcfg.paper_mm) || 80)
          .then(bytes => printViaBridge('', rcfg.ip, rcfg.port || 9100, bytes))
          .catch(e => console.error('print quote error', e))
      }

      closeQuote()
      if (thenGoToPOS) window.location.href = '/pos'
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setQuoteSaving(false)
    }
  }

  function addPart(p) {
    setQuoteItems(prev => [...prev, { product_id: p.id, product_name: p.name, qty: 1, price: p.price, cost: p.cost || 0, unit: p.unit || 'ชิ้น', is_labor: false, tech_id: null, tech_name: '' }])
    setProductSearch('')
    setProductResults([])
  }

  function updateQuoteItemMulti(idx, obj) {
    setQuoteItems(prev => prev.map((it, i) => i === idx ? { ...it, ...obj } : it))
  }

  function updateQuoteItem(idx, field, val) {
    setQuoteItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }

  function removeQuoteItem(idx) {
    setQuoteItems(prev => prev.filter((_, i) => i !== idx))
  }

  const quoteSubtotal = quoteItems.reduce((s, it) => s + (parseFloat(it.price) || 0) * (parseFloat(it.qty) || 1), 0)
  const quoteDeposit  = parseFloat(quoteJob?.deposit) || 0
  const quoteTotal    = Math.max(0, quoteSubtotal - quoteDeposit)

  // ── Add/Edit form ──
  async function saveJob() {
    if (!form.customer_name.trim()) return alert('กรุณากรอกชื่อลูกค้า')
    if (!form.device.trim())        return alert('กรุณากรอกชื่ออุปกรณ์')
    setSaving(true)
    try {
      if (modal === 'add') {
        const cleanPhone = form.phone.trim().replace(/\D/g, '') || null

        // ── ออฟไลน์ ──
        if (!navigator.onLine) {
          const repair_no = genOfflineRepairNo()
          const formData = {
            repair_no, customer_name: form.customer_name.trim(), phone: cleanPhone,
            device: form.device.trim(), description: form.description.trim() || null,
            appointment_date: form.appointment_date || null,
            appointment_time: form.appointment_time.trim() || null,
            price: form.price ? parseFloat(form.price) : null,
            deposit: form.deposit ? parseFloat(form.deposit) : 0,
            note: form.note.trim() || null, status: form.status,
          }
          addToQueue('repair', {
            formData,
            customerData: { name: form.customer_name.trim(), phone: cleanPhone },
          })
          window.dispatchEvent(new Event('offline-queue-changed'))
          // แสดงในคิวแบบ local ทันที
          setJobs(prev => [{ ...formData, id: `offline_${Date.now()}`, created_at: new Date().toISOString() }, ...prev])
          printRepairReceipt({ ...formData, created_at: new Date().toISOString() }, settings, printerCfg.receipt, printerCfg.barcode)
          closeModal()
          setSaving(false)
          return
        }

        // ── ออนไลน์ ──
        const { data: seq } = await supabase.from('doc_sequences')
          .select('last_seq').eq('prefix', 'REPW').eq('year_month', 'all').single()
        const next = (seq?.last_seq || 0) + 1
        await supabase.from('doc_sequences')
          .upsert({ prefix: 'REPW', year_month: 'all', last_seq: next }, { onConflict: 'prefix,year_month' })
        const repair_no = `REPW-${String(next).padStart(3, '0')}`
        const { error } = await supabase.from('repair_orders').insert({
          repair_no,
          customer_name: form.customer_name.trim(),
          phone: cleanPhone,
          device: form.device.trim(),
          description: form.description.trim() || null,
          appointment_date: form.appointment_date || null,
          appointment_time: form.appointment_time.trim() || null,
          price: form.price ? parseFloat(form.price) : null,
          deposit: form.deposit ? parseFloat(form.deposit) : 0,
          note: form.note.trim() || null,
          status: form.status,
          technician_id: form.technician_id || null,
          technician_name: form.technician_name || null,
        })
        if (error) throw error

        // พิมใบรับเครื่อง
        printRepairReceipt({
          repair_no, customer_name: form.customer_name.trim(),
          phone: cleanPhone, device: form.device.trim(),
          description: form.description.trim() || '',
          price: form.price || '', deposit: form.deposit || '',
          note: form.note.trim() || '',
          appointment_date: form.appointment_date || '',
          appointment_time: form.appointment_time.trim() || '',
          created_at: new Date().toISOString(),
        }, settings, printerCfg.receipt, printerCfg.barcode)

        // Auto-upsert ลูกค้าเข้า customers table
        const custName = form.customer_name.trim()
        if (cleanPhone) {
          const { data: existing } = await supabase.from('customers')
            .select('id,name').eq('phone', cleanPhone).maybeSingle()
          if (existing) {
            if (existing.name === cleanPhone || existing.name === '0' + cleanPhone) {
              await supabase.from('customers').update({ name: custName }).eq('id', existing.id)
            }
          } else {
            await supabase.from('customers').insert({ name: custName, phone: cleanPhone })
          }
        } else if (custName) {
          // ไม่มีเบอร์ — เช็คชื่อซ้ำก่อน แล้วค่อย insert
          const { data: existing } = await supabase.from('customers')
            .select('id').ilike('name', custName).maybeSingle()
          if (!existing) {
            await supabase.from('customers').insert({ name: custName })
          }
        }
      } else {
        const { error } = await supabase.from('repair_orders').update({
          customer_name: form.customer_name.trim(),
          phone: form.phone.trim() || null,
          device: form.device.trim(),
          description: form.description.trim() || null,
          appointment_date: form.appointment_date || null,
          appointment_time: form.appointment_time.trim() || null,
          price: form.price ? parseFloat(form.price) : null,
          deposit: form.deposit ? parseFloat(form.deposit) : 0,
          note: form.note.trim() || null,
          status: form.status,
          technician_id: form.technician_id || null,
          technician_name: form.technician_name || null,
          updated_at: new Date().toISOString(),
        }).eq('id', editId)
        if (error) throw error
      }
      await load()
      closeModal()
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteJob(id) {
    if (!confirm('ลบรายการนี้?')) return
    await supabase.from('repair_orders').delete().eq('id', id)
    await load()
    closeModal()
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM, appointment_date: new Date().toISOString().slice(0, 10) })
    setEditId(null)
    setModal('add')
  }

  function openEdit(job) {
    setForm({
      customer_name: job.customer_name || '', phone: job.phone || '',
      device: job.device || '', description: job.description || '',
      appointment_date: job.appointment_date || '', appointment_time: job.appointment_time || '',
      price: job.price != null ? String(job.price) : '',
      deposit: job.deposit != null ? String(job.deposit) : '',
      note: job.note || '', status: job.status || 'waiting',
      technician_id: job.technician_id || null,
      technician_name: job.technician_name || '',
    })
    setEditId(job.id)
    setModal('edit')
  }

  function closeModal() { setModal(null); setForm(EMPTY_FORM); setEditId(null) }

  const filtered = jobs.filter(j => {
    if (tab !== 'all' && j.status !== tab) return false
    if (search) {
      const q = search.toLowerCase()
      return (j.repair_no||'').toLowerCase().includes(q) ||
             (j.customer_name||'').toLowerCase().includes(q) ||
             (j.phone||'').includes(q) ||
             (j.device||'').toLowerCase().includes(q)
    }
    return true
  })
  const counts = {}
  jobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1 })

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg,#14060a 0%,#2D142C 100%)', fontFamily: 'Kanit,sans-serif' }}>
      <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">🔧 คิวซ่อม</h1>
            <p className="text-white/40 text-sm mt-0.5">{jobs.length} รายการทั้งหมด</p>
          </div>
          <div className="flex items-center gap-2">
            {!isEmp && (
              <a href="/repair/commission"
                className="px-3 py-2.5 rounded-xl text-sm font-semibold text-violet-300 transition-all active:scale-95"
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>
                💰 คอมช่าง
              </a>
            )}
            <button onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)', boxShadow: '0 4px 14px rgba(199,44,65,0.4)' }}>
              <span className="text-lg leading-none">+</span> เพิ่มคิว
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-sm">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา ชื่อ, เบอร์, อุปกรณ์, เลขคิว..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/30 outline-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 scroll-hidden">
          {TABS.map(t => {
            const cnt = t.key === 'all' ? jobs.length : (counts[t.key] || 0)
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={active
                  ? { background: 'rgba(199,44,65,0.3)', border: '1px solid rgba(199,44,65,0.5)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                {t.label}
                {cnt > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                  style={{ background: active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', color: active ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  {cnt}
                </span>}
              </button>
            )
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-16 text-white/30">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <div className="text-5xl mb-3">🔧</div>
            <p>{search ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีคิวซ่อม'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(job => {
              const st      = STATUS[job.status] || STATUS.waiting
              const nextSts = STATUS_ORDER[STATUS_ORDER.indexOf(job.status) + 1]
              const nextSt  = nextSts ? STATUS[nextSts] : null
              const billed  = !!job.sale_id
              return (
                <div key={job.id} onClick={() => openEdit(job)}
                  className="rounded-2xl p-4 cursor-pointer transition-all active:scale-[0.99] hover:brightness-110"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>

                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold text-white/40">{job.repair_no}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.color }}>
                          {st.emoji} {st.label}
                        </span>
                        {billed && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>
                            🧾 ออกบิลแล้ว
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-white mt-1">{job.customer_name}</p>
                      {job.phone && <p className="text-white/40 text-xs">{job.phone}</p>}
                    </div>
                    {job.price != null && (
                      <div className="text-right flex-shrink-0">
                        <p className="text-white font-bold">฿{fmt(job.price)}</p>
                        {job.deposit > 0 && <p className="text-white/40 text-xs">มัดจำ ฿{fmt(job.deposit)}</p>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">🔩</span>
                    <p className="text-white/80 text-sm font-semibold">{job.device}</p>
                    {job.technician_name && (
                      <span className="ml-auto text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)' }}>
                        🔧 {job.technician_name}
                      </span>
                    )}
                  </div>
                  {job.description && (
                    <p className="text-white/50 text-xs mb-3 line-clamp-2">{job.description}</p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-white/35">
                      {job.appointment_date && (
                        <span>📅 {fmtDate(job.appointment_date)}{job.appointment_time ? ` ${job.appointment_time}` : ''}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Reprint receipt */}
                      <button
                        onClick={e => { e.stopPropagation(); reprintReceipt(job) }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}
                        title="พิมพ์ใบรับเครื่องซ้ำ">
                        🖨️ ใบนัด
                      </button>
                      {/* Reprint sticker */}
                      <button
                        onClick={e => { e.stopPropagation(); reprintSticker(job) }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}
                        title="พิมพ์สติ๊กเกอร์เลขคิว">
                        🏷️ สติ๊กเกอร์
                      </button>
                      {/* Quote / send-to-POS buttons — only for done + not yet billed */}
                      {job.status === 'done' && !billed && (
                        quotedJobIds.has(job.id) ? (
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); openQuote(job) }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.65)' }}>
                              📋 รายการ
                            </button>
                            {!embed && (
                            <button
                              onClick={e => { e.stopPropagation(); window.location.href = '/pos' }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                              style={{ background: 'linear-gradient(135deg,#1d4ed8,#60a5fa)', color: '#fff', boxShadow: '0 2px 8px rgba(29,78,216,0.4)' }}>
                              💳 ชำระที่ POS
                            </button>
                            )}
                          </>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); openQuote(job) }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                            style={{ background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', color: '#fff', boxShadow: '0 2px 8px rgba(124,58,237,0.4)' }}>
                            📋 คำนวนรายการ
                          </button>
                        )
                      )}
                      {/* Next status button — skip 'done→picked_up' (use billing instead) */}
                      {nextSt && nextSts !== 'picked_up' && (
                        <button
                          onClick={e => { e.stopPropagation(); updateStatus(job, nextSts) }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                          style={{ background: nextSt.bg, border: `1px solid ${nextSt.border}`, color: nextSt.color }}>
                          {nextSt.emoji} {nextSt.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Quote Modal ── */}
      {quoteJob && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeQuote() }}>
          <div className="w-full md:max-w-lg rounded-t-3xl md:rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '94vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0"
              style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <h2 className="font-bold text-white text-lg">📋 คำนวนรายการ</h2>
                <p className="text-white/40 text-xs mt-0.5">{quoteJob.repair_no} · {quoteJob.customer_name} · {quoteJob.device}</p>
              </div>
              <button onClick={closeQuote} className="text-white/40 hover:text-white text-2xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>

            <div className="overflow-y-auto px-5 py-4 space-y-4" style={{ maxHeight: 'calc(94vh - 80px)' }}>

              {/* Items */}
              <div>
                <p className="text-white/50 text-xs mb-2">รายการ</p>
                <div className="space-y-2">
                  {quoteItems.map((it, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl space-y-1.5"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {/* Row 1: name + delete */}
                      <div className="flex items-center gap-2">
                        <input value={it.product_name}
                          onChange={e => updateQuoteItem(idx, 'product_name', e.target.value)}
                          className="flex-1 text-sm text-white bg-transparent outline-none"
                          placeholder="ชื่อรายการ" />
                        <button onClick={() => removeQuoteItem(idx)} className="text-red-400/60 hover:text-red-400 text-lg leading-none w-6 flex-shrink-0">×</button>
                      </div>
                      {/* Row 2: qty × price | is_labor + tech */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input type="number" value={it.qty}
                          onChange={e => updateQuoteItem(idx, 'qty', e.target.value)}
                          className="w-12 text-center text-xs text-white rounded-lg px-1 py-1 outline-none"
                          style={{ background: 'rgba(255,255,255,0.08)' }} min="1" />
                        <span className="text-white/30 text-xs">×</span>
                        <input type="number" value={it.price}
                          onChange={e => updateQuoteItem(idx, 'price', e.target.value)}
                          className="w-20 text-right text-xs text-white rounded-lg px-2 py-1 outline-none"
                          style={{ background: 'rgba(255,255,255,0.08)' }} />
                        <div className="flex-1" />
                        <button
                          onClick={() => updateQuoteItem(idx, 'is_labor', !it.is_labor)}
                          className={`text-xs px-2 py-1 rounded-lg font-semibold transition-all flex-shrink-0 ${it.is_labor
                            ? 'text-emerald-300' : 'text-white/30'}`}
                          style={it.is_labor
                            ? { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }
                            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {it.is_labor ? '🔧ค่าแรง' : '📦อะไหล่'}
                        </button>
                        {it.is_labor && (
                          <select
                            value={it.tech_id || ''}
                            onChange={e => {
                              const emp = employees.find(em => em.id === parseInt(e.target.value))
                              updateQuoteItemMulti(idx, { tech_id: emp?.id || null, tech_name: emp ? (emp.nickname || emp.name) : '' })
                            }}
                            className="text-xs text-white rounded-lg px-2 py-1 outline-none flex-shrink-0"
                            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', maxWidth: 90 }}>
                            <option value="">— ช่าง —</option>
                            {employees.map(emp => (
                              <option key={emp.id} value={emp.id}>{emp.nickname || emp.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add parts search */}
                <div className="mt-2 relative">
                  <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                    placeholder="🔍 ค้นหาอะไหล่จากสต๊อก..."
                    className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-white/30 outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
                  {productResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 rounded-xl overflow-hidden shadow-xl"
                      style={{ background: '#2D142C', border: '1px solid rgba(255,255,255,0.12)' }}>
                      {productResults.map(p => (
                        <button key={p.id} onClick={() => addPart(p)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-white/10 transition-colors">
                          <span className="text-white">{p.name}</span>
                          <span className="text-white/50 text-xs">฿{fmt(p.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {!embed && (
                <button onClick={() => setQuoteItems(prev => [...prev, { product_id: null, product_name: 'ค่าแรง', qty: 1, price: 0, cost: 0, unit: 'ครั้ง', is_labor: true, tech_id: quoteJob?.technician_id || null, tech_name: quoteJob?.technician_name || '' }])}
                  className="mt-2 text-xs text-white/40 hover:text-white/70 transition-colors">
                  + เพิ่มรายการเอง
                </button>
                )}
              </div>

              {/* Summary */}
              <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">รวมค่าซ่อม</span>
                  <span className="text-white">฿{fmt(quoteSubtotal)}</span>
                </div>
                {quoteDeposit > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-400/80">หักมัดจำที่รับไป</span>
                    <span className="text-amber-400">-฿{fmt(quoteDeposit)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t border-white/10">
                  <span className="text-white">ยอดที่ต้องชำระ</span>
                  <span className="text-violet-400">฿{fmt(quoteTotal)}</span>
                </div>
              </div>

              {/* Commission preview */}
              {(() => {
                const commByTech = {}
                quoteItems.forEach(it => {
                  if (!it.is_labor || !it.tech_id) return
                  const emp = employees.find(e => e.id === it.tech_id)
                  if (!emp) return
                  const pct   = parseFloat(emp.repair_commission_pct) || 0
                  const labor = (parseFloat(it.price) || 0) * (parseFloat(it.qty) || 1)
                  if (!commByTech[it.tech_id]) commByTech[it.tech_id] = { name: it.tech_name || (emp.nickname || emp.name), laborTotal: 0, pct }
                  commByTech[it.tech_id].laborTotal += labor
                })
                const techList = Object.values(commByTech)
                if (techList.length === 0) return null
                return (
                  <div className="rounded-xl p-3 space-y-1" style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)' }}>
                    <p className="text-xs text-violet-400/70 mb-1.5">💰 คอมมิชชั่นช่าง (ประมาณการ)</p>
                    {techList.map(t => (
                      <div key={t.name} className="flex justify-between text-xs">
                        <span className="text-violet-300">{t.name} ({t.pct}%)</span>
                        <span className="text-violet-200 font-semibold">฿{fmt(t.laborTotal * t.pct / 100)}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Actions */}
              <div className="flex gap-3 pb-2">
                <button onClick={closeQuote}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white/60"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  ยกเลิก
                </button>
                <button onClick={() => saveQuote(false)} disabled={quoteSaving || quoteItems.length === 0}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)' }}>
                  {quoteSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
                {!embed && (
                <button onClick={() => saveQuote(true)} disabled={quoteSaving || quoteItems.length === 0}
                  className="flex-[2] py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#1d4ed8,#60a5fa)', boxShadow: '0 4px 14px rgba(29,78,216,0.4)' }}>
                  {quoteSaving ? '...' : `💳 ชำระที่ POS ฿${fmt(quoteTotal)}`}
                </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="w-full md:max-w-lg rounded-t-3xl md:rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '92vh' }}>

            <div className="flex items-center justify-between px-5 pt-5 pb-4 sticky top-0"
              style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <h2 className="font-bold text-white text-lg">{modal === 'add' ? '➕ เพิ่มคิวซ่อม' : '✏️ แก้ไขคิว'}</h2>
                {editId && <p className="text-white/40 text-xs mt-0.5">{jobs.find(j => j.id === editId)?.repair_no}</p>}
              </div>
              <button onClick={closeModal} className="text-white/40 hover:text-white text-2xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 'calc(92vh - 80px)' }}>
              <div className="px-5 py-4 space-y-4">

                {modal === 'edit' && (
                  <div>
                    <label className="text-white/50 text-xs mb-2 block">สถานะ</label>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(STATUS).map(([k, v]) => (
                        <button key={k} onClick={() => setForm(f => ({ ...f, status: k }))}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                          style={form.status === k
                            ? { background: v.bg, border: `1px solid ${v.border}`, color: v.color }
                            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                          {v.emoji} {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">ชื่อลูกค้า *</label>
                    <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                      placeholder="ชื่อลูกค้า"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">เบอร์โทร</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="0XX-XXX-XXXX" type="tel"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                </div>

                <div>
                  <label className="text-white/50 text-xs mb-1.5 block">อุปกรณ์ / เครื่อง *</label>
                  <input value={form.device} onChange={e => setForm(f => ({ ...f, device: e.target.value }))}
                    placeholder="เช่น เครื่องตัดหญ้า, เลื่อยไฟฟ้า..."
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                </div>

                <div>
                  <label className="text-white/50 text-xs mb-1.5 block">🔧 ช่างซ่อม</label>
                  <select
                    value={form.technician_id || ''}
                    onChange={e => {
                      const emp = employees.find(em => em.id === parseInt(e.target.value))
                      setForm(f => ({ ...f, technician_id: emp?.id || null, technician_name: emp ? (emp.nickname || emp.name) : '' }))
                    }}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <option value="">— ไม่ระบุช่าง —</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.nickname || emp.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-white/50 text-xs mb-1.5 block">อาการ / รายละเอียดงาน</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="เช่น สตาร์ทไม่ติด, เปลี่ยนหัวเกียร์..."
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">วันที่นัด</label>
                    <input type="date" value={form.appointment_date} onChange={e => setForm(f => ({ ...f, appointment_date: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', colorScheme: 'dark' }} />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">เวลานัด</label>
                    <input type="time" value={form.appointment_time} onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', colorScheme: 'dark' }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">ค่าซ่อม (฿)</label>
                    <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                      placeholder="0.00" min="0"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                  <div>
                    <label className="text-white/50 text-xs mb-1.5 block">มัดจำ (฿)</label>
                    <input type="number" value={form.deposit} onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))}
                      placeholder="0.00" min="0"
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                </div>

                <div>
                  <label className="text-white/50 text-xs mb-1.5 block">หมายเหตุ</label>
                  <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="หมายเหตุเพิ่มเติม..."
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }} />
                </div>

                <div className="flex gap-3 pt-2 pb-2">
                  {modal === 'edit' && (
                    <button onClick={() => deleteJob(editId)}
                      className="px-4 py-3 rounded-xl text-sm font-semibold text-red-400 transition-all active:scale-95"
                      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                      ลบ
                    </button>
                  )}
                  <button onClick={closeModal}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold text-white/60"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    ยกเลิก
                  </button>
                  <button onClick={saveJob} disabled={saving}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)', boxShadow: '0 4px 14px rgba(199,44,65,0.4)' }}>
                    {saving ? 'กำลังบันทึก...' : modal === 'add' ? 'เพิ่มคิว' : 'บันทึก'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
