'use client'

import JsBarcode from 'jsbarcode'

// แปลงข้อความเป็น TIS-620 (Thai thermal printers ใช้ TIS-620 ไม่ใช่ UTF-8)
function tis620(str) {
  const out = []
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    if (cp < 0x80) {
      out.push(cp)
    } else if (cp >= 0x0E00 && cp <= 0x0E7F) {
      out.push(cp - 0x0E00 + 0xA0)   // Thai Unicode → TIS-620
    } else {
      out.push(0x3F)                  // '?' สำหรับ char ที่ไม่รองรับ
    }
  }
  return out
}

// ส่ง ESC/POS ไปเครื่องพิมพ์ผ่าน Next.js API route (ไม่ต้องมี bridge server)
function getPosToken() {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(/(?:^|;\s*)pos_token=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function sendPrintRequest(url, token, ip, port, b64, timeoutMs = 30000) {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ip, port: parseInt(port) || 9100, data: b64 }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      let msg = await res.text()
      try { msg = JSON.parse(msg).error || msg } catch {}
      throw new Error(msg)
    }
    return true
  } finally {
    clearTimeout(tid)
  }
}

// delays: ms ก่อน retry แต่ละครั้ง เช่น [0,3000,6000] = ทันที,รอ3วิ,รอ6วิ
export async function printViaBridge(bridgeUrl, ip, port, bytes, delays = [0, 3000, 6000]) {
  const b64 = btoa(Array.from(bytes).map(b => String.fromCharCode(b)).join(''))
  const url = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/print-raw'
  let lastErr
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise(r => setTimeout(r, delays[i]))
    try {
      await sendPrintRequest(url, getPosToken(), ip, port, b64)
      return
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

// คำสั่งเปิดลิ้นชัก (cash drawer) ผ่าน printer port
export function buildDrawerKickESCPOS() {
  // ESC p pin t1 t2 — pin 2 (0x00) หรือ pin 5 (0x01), pulse 50ms on / 500ms off
  return new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA])
}

// เปิดลิ้นชักผ่าน bridge
export async function kickDrawerViaBridge(bridgeUrl, ip, port) {
  // ใช้ retry เดียวกับ receipt เพื่อรองรับ printer sleep mode ตอนเช้า
  return printViaBridge(bridgeUrl, ip, port, buildDrawerKickESCPOS(), [0, 3000, 6000])
}

// สร้าง ESC/POS ใบเสร็จแบบ bitmap — ไม่มีปัญหา Thai codepage
export async function buildReceiptESCPOS(r, paperMM = 80) {
  // printable width: 80mm paper → 576 dots (72mm), 58mm → 384 dots (48mm)
  const pw   = paperMM >= 80 ? 576 : 384
  const pad  = 12   // dots left/right padding
  const fSm  = 26   // normal font px
  const fLg  = 42   // header font px
  const inner = pw - pad * 2

  // helper: wrap long text into multiple lines
  function wrapLines(ctx, text, maxW, size, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Kanit, Arial, sans-serif`
    if (ctx.measureText(text).width <= maxW) return [text]
    const chars = [...text]
    const lines = []
    let cur = ''
    for (const ch of chars) {
      if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch }
      else cur += ch
    }
    if (cur) lines.push(cur)
    return lines
  }

  // build draw list
  const dl = []
  const line = (text, align = 'left', size = fSm, bold = false) =>
    dl.push({ text, align, size, bold })
  const two  = (left, right, bold = false) =>
    dl.push({ two: true, left, right, size: fSm, bold })
  const div  = () => dl.push({ divider: true })
  const nl   = () => dl.push({ text: '', align: 'left', size: fSm })

  if (r.shopLogo)  dl.push({ logo: r.shopLogo })
  else line(r.shopName || 'ร้านค้า', 'center', fLg, true)
  line('ใบเสร็จรับเงิน', 'center', fSm, false)
  if (r.shopAddress) line(r.shopAddress, 'center', Math.round(fSm * 0.8))
  if (r.shopPhone)   line('โทร : ' + r.shopPhone, 'center', Math.round(fSm * 1.2), true)
  div()
  line('เลขที่: ' + (r.receipt_no || ''))
  line('วันที่: ' + new Date(r.created_at || Date.now()).toLocaleString('th-TH'))
  div()

  for (const i of r.items || []) {
    line(i.name || '')
    two(`  ${i.qty} x ${Number(i.price).toFixed(2)}`,
        Number(i.price * i.qty - (i.disc || 0)).toFixed(2))
  }
  div()

  const n = v => (isNaN(Number(v)) ? 0 : Number(v))
  two('รวม', n(r.subtotal).toFixed(2))
  if (n(r.discount) > 0) two('ส่วนลด', '-' + n(r.discount).toFixed(2))
  if (n(r.vat) > 0)      two(`VAT ${(n(r.vatRate) * 100).toFixed(0)}%`, n(r.vat).toFixed(2))
  two('สุทธิ', '฿' + n(r.total).toFixed(2), true)
  two('ชำระ', n(r.payment_amount || r.total).toFixed(2))
  if (n(r.change) > 0) two('ทอน', n(r.change).toFixed(2))
  if (r.cashier) two('ผู้รับเงิน', r.cashier)
  if (r.note)    { div(); line('หมายเหตุ: ' + r.note, 'left', Math.round(fSm * 0.9)) }

  nl()
  line(r.footer || 'ขอบคุณที่ใช้บริการ', 'center')
  if (r.hasLineQr) {
    div()
    line('แอด LINE เพื่อสั่งสินค้าได้เลย', 'center', fSm, false)
    if (r.lineQr) dl.push({ lineQr: r.lineQr })
  }
  nl(); nl(); nl(); nl(); nl(); nl()

  // โหลด logo และ LINE QR พร้อมกัน
  const logoItem   = dl.find(d => d.logo)
  const lineQrItem = dl.find(d => d.lineQr)
  let logoImg  = null
  let lineQrImg = null
  const logoH  = 260
  const qrSize = 260

  const loadImg = (src) => new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img); img.onerror = () => resolve(null)
    img.src = src
  })

  if (logoItem)   logoImg   = await loadImg(logoItem.logo)
  if (lineQrItem) lineQrImg = await loadImg(lineQrItem.lineQr)

  // pre-measure canvas height (need a temp canvas for wrapLines)
  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width = pw; tmpCanvas.height = 10
  const tmpCtx = tmpCanvas.getContext('2d')

  // measure total height (accounting for text wrap)
  let totalH = 0
  for (const d of dl) {
    if (d.lineQr) { totalH += lineQrImg ? qrSize + 12 : 0 }
    else if (d.logo)    { totalH += logoImg ? logoH + 12 : 0 }
    else if (d.divider) { totalH += 6 }
    else {
      const sz = d.size || fSm
      const lh = sz + 14
      if (d.two) { totalH += lh }
      else {
        const wrapped = wrapLines(tmpCtx, d.text || '', inner, sz, d.bold)
        totalH += lh * wrapped.length
      }
    }
  }

  // render to canvas
  const canvas = document.createElement('canvas')
  canvas.width  = pw
  canvas.height = totalH + 16
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, pw, canvas.height)
  ctx.fillStyle = '#000'

  let y = 8
  for (const d of dl) {
    if (d.lineQr) {
      if (lineQrImg) {
        const s = Math.min(qrSize, inner)
        ctx.drawImage(lineQrImg, (pw - s) / 2, y, s, s)
        y += s + 12
      }
      continue
    }
    if (d.logo) {
      if (logoImg) {
        const scale = Math.min(1, inner / logoImg.width, logoH / logoImg.height)
        const dw = logoImg.width  * scale
        const dh = logoImg.height * scale
        ctx.drawImage(logoImg, (pw - dw) / 2, y, dw, dh)
        y += dh + 12
      }
      continue
    }
    if (d.divider) {
      ctx.fillRect(pad, y + 2, inner, 1)
      y += 6
      continue
    }
    const sz = d.size || fSm
    const lh = sz + 14
    ctx.font = `${d.bold ? 'bold ' : ''}${sz}px Kanit, Arial, sans-serif`
    if (d.two) {
      ctx.textAlign = 'left'
      ctx.fillText(d.left,  pad,      y + sz)
      ctx.textAlign = 'right'
      ctx.fillText(d.right, pw - pad, y + sz)
      y += lh
    } else {
      const wrapped = wrapLines(ctx, d.text || '', inner, sz, d.bold)
      ctx.textAlign = 'left'
      for (const wl of wrapped) {
        let xPos = pad
        if (d.align === 'center') {
          const tw = ctx.measureText(wl).width
          xPos = Math.max(pad, Math.floor((pw - tw) / 2))
        } else if (d.align === 'right') {
          const tw = ctx.measureText(wl).width
          xPos = pw - pad - tw
        }
        ctx.fillText(wl, xPos, y + sz)
        y += lh
      }
    }
  }

  // canvas → 1-bit bitmap
  const imgData = ctx.getImageData(0, 0, pw, canvas.height)
  const wBytes  = Math.ceil(pw / 8)
  const bitmap  = new Uint8Array(wBytes * canvas.height)
  for (let row = 0; row < canvas.height; row++) {
    for (let col = 0; col < pw; col++) {
      const i   = (row * pw + col) * 4
      const lum = (imgData.data[i]*299 + imgData.data[i+1]*587 + imgData.data[i+2]*114) / 1000
      if (lum < 128) bitmap[row * wBytes + (col >> 3)] |= (0x80 >> (col & 7))
    }
  }

  const GS = 0x1D
  const b  = [0x1B, 0x40]   // ESC @ init
  b.push(GS, 0x76, 0x30, 0x00)
  b.push(wBytes & 0xFF, (wBytes >> 8) & 0xFF)
  b.push(canvas.height & 0xFF, (canvas.height >> 8) & 0xFF)
  for (const byte of bitmap) b.push(byte)
  b.push(GS, 0x56, 0x00)    // cut

  return new Uint8Array(b)
}

// สร้าง ESC/POS label โดย render canvas → bitmap
export async function buildLabelESCPOS(items, size, printerWidthMM = 100) {
  const DPI     = 203
  const mm2dot  = mm => Math.round(mm * DPI / 25.4)

  const pgW  = mm2dot(printerWidthMM)
  const pgH  = mm2dot(size.ph || 25)
  const m    = mm2dot(size.m  || 2)
  const cols = size.cols || 3
  const lw   = Math.floor((pgW - m * 2) / cols)
  const lh   = pgH - m * 2

  const canvas = document.createElement('canvas')
  canvas.width  = pgW
  canvas.height = pgH
  const ctx = canvas.getContext('2d')

  const GS = 0x1D
  const allBytes = [0x1B, 0x40]  // ESC @ init

  for (let row = 0; row < Math.ceil(items.length / cols); row++) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, pgW, pgH)
    ctx.fillStyle = '#000'

    const rowItems = items.slice(row * cols, row * cols + cols)

    for (let col = 0; col < rowItems.length; col++) {
      const item = rowItems[col]
      const cx   = m + col * lw + lw / 2   // center x of this label cell
      const oy   = m

      const nameBoxH    = Math.round(lh * 0.28)   // fixed name area height
      const nameFontPx  = Math.max(12, Math.round(lh * 0.22))
      const smallFontPx = Math.round(nameBoxH * 0.43)  // smaller font for 2-line
      const priceFontPx = Math.max(14, Math.round(lh * 0.28))
      const bcFontPx    = Math.max(8,  Math.round(lh * 0.09))
      const bcStartY    = oy + nameBoxH + 3   // barcode always starts here

      // ── Name: ซิดซ้าย, 1 หรือ 2 บรรทัดอัตโนมัติ ──
      ctx.textAlign = 'left'
      const lx   = m + col * lw + 2   // left edge of label cell
      const name = (item.name || '').trim()
      ctx.font = `bold ${nameFontPx}px Kanit, sans-serif`

      if (ctx.measureText(name).width <= lw - 4) {
        ctx.fillText(name, lx, oy + Math.round((nameBoxH + nameFontPx) / 2))
      } else {
        ctx.font = `bold ${smallFontPx}px Kanit, sans-serif`
        const maxW = lw - 4
        const mid  = Math.ceil(name.length / 2)
        const sp   = name.indexOf(' ', mid - 3)
        const split = (sp > 0 && sp <= mid + 5) ? sp : mid
        let l1 = name.slice(0, split).trim()
        let l2 = name.slice(split).trim()
        while (ctx.measureText(l1 + '…').width > maxW && l1.length > 1) l1 = l1.slice(0, -1)
        while (ctx.measureText(l2 + '…').width > maxW && l2.length > 1) l2 = l2.slice(0, -1)
        if (l1.length < name.slice(0, split).trim().length) l1 += '…'
        if (l2.length < name.slice(split).trim().length)    l2 += '…'
        ctx.fillText(l1, lx, oy + smallFontPx)
        ctx.fillText(l2, lx, oy + smallFontPx * 2 + 2)
      }

      // ── Barcode ──
      if (item.barcode) {
        try {
          const bc = document.createElement('canvas')
          JsBarcode(bc, item.barcode, {
            format: 'CODE128',
            width: Math.max(1, Math.floor(lw / 72)),
            height: Math.round(lh * 0.38),
            displayValue: true,
            fontSize: bcFontPx,
            margin: 0,
          })
          // scale down if barcode is wider than label
          const scale = bc.width > lw ? lw / bc.width : 1
          const dw = Math.round(bc.width * scale)
          const dh = Math.round(bc.height * scale)
          ctx.drawImage(bc, Math.round(cx - dw / 2), bcStartY, dw, dh)
        } catch { /* skip if barcode fails */ }
      }

      // ── Price: ซิดซ้าย ด้านล่าง ──
      ctx.font = `bold ${priceFontPx}px Kanit, sans-serif`
      ctx.textAlign = 'left'
      ctx.fillText('฿' + Number(item.price).toFixed(2), lx, oy + lh - 2)
    }

    // Canvas → 1-bit bitmap for GS v 0
    const imgData  = ctx.getImageData(0, 0, pgW, pgH)
    const wBytes   = Math.ceil(pgW / 8)
    const bitmap   = new Uint8Array(wBytes * pgH)

    for (let y = 0; y < pgH; y++) {
      for (let x = 0; x < pgW; x++) {
        const i   = (y * pgW + x) * 4
        const lum = (imgData.data[i] * 299 + imgData.data[i+1] * 587 + imgData.data[i+2] * 114) / 1000
        if (lum < 128) bitmap[y * wBytes + (x >> 3)] |= (0x80 >> (x & 7))
      }
    }

    // GS v 0: raster bit image
    allBytes.push(GS, 0x76, 0x30, 0x00)
    allBytes.push(wBytes & 0xFF, (wBytes >> 8) & 0xFF)
    allBytes.push(pgH   & 0xFF, (pgH   >> 8) & 0xFF)
    for (const b of bitmap) allBytes.push(b)
    allBytes.push(0x0A)  // LF
  }

  return new Uint8Array(allBytes)
}

// ─── TSPL Label Generator ─────────────────────────────────────────────────────
// Hybrid: name bitmap (canvas, รองรับไทย) + native BARCODE + native TEXT
// BARCODE command ให้ printer วางตำแหน่งบาร์โค้ดเอง — ไม่เกิดปัญหา bitmap x-offset
export async function buildLabelTSPL(items, size) {
  const dpm  = 8
  const pw   = size.pw   || 100
  const ph   = size.ph   || 25
  const cols = size.cols || 3
  const mx   = size.mx  ?? size.m ?? 0
  const my   = size.my  ?? size.m ?? 0
  const hGap = size.hGap ?? 2
  const vGap = size.vGap ?? 2

  const lw   = size.lw ?? (pw - mx*2 - hGap*(cols-1)) / cols
  const lh   = ph - my*2
  const phD  = Math.round(ph  * dpm)
  const lwD  = Math.round(lw  * dpm)
  const lhD  = Math.round(lh  * dpm)
  const mxD  = Math.round(mx  * dpm)
  const myD  = Math.round(my  * dpm)
  const hGpD = Math.round(hGap * dpm)
  const lwByt = Math.ceil(lwD / 8)

  // Layout
  const nameBoxH = Math.round(lhD * 0.28)   // ~56 dots (7mm)
  const namePx   = Math.max(14, Math.round(lhD * 0.15))
  const smallPx  = Math.round(nameBoxH * 0.43)
  const bcY      = myD + nameBoxH + 2        // barcode y
  const bcH      = Math.round(lhD * 0.40)   // barcode height (ลดจาก 50% เพื่อเว้นที่ human-readable text)
  const priceY   = bcY + bcH + 26           // price y (เว้น 26 dots สำหรับตัวเลขใต้บาร์โค้ด)

  // Render product name (Thai) on small canvas → 1-bit bitmap ต่อ column
  // escape 0x0D + 0x0A ป้องกัน TSPL parser ตัด BITMAP command กลางทาง
  async function renderNameBitmap(name) {
    const canvas = document.createElement('canvas')
    canvas.width  = lwD
    canvas.height = nameBoxH
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, lwD, nameBoxH)
    ctx.fillStyle = '#000'
    ctx.textAlign = 'left'

    const text = (name || '').trim()
    ctx.font = `bold ${namePx}px Kanit, Arial, sans-serif`
    if (ctx.measureText(text).width <= lwD - 4) {
      ctx.fillText(text, 2, Math.round((nameBoxH + namePx) / 2))
    } else {
      ctx.font = `bold ${smallPx}px Kanit, Arial, sans-serif`
      const maxW = lwD - 4
      const mid  = Math.ceil(text.length / 2)
      const sp   = text.indexOf(' ', mid - 3)
      const split = (sp > 0 && sp <= mid + 5) ? sp : mid
      let l1 = text.slice(0, split).trim()
      let l2 = text.slice(split).trim()
      while (ctx.measureText(l1 + '…').width > maxW && l1.length > 1) l1 = l1.slice(0, -1)
      while (ctx.measureText(l2 + '…').width > maxW && l2.length > 1) l2 = l2.slice(0, -1)
      if (l1.length < text.slice(0, split).trim().length) l1 += '…'
      if (l2.length < text.slice(split).trim().length)    l2 += '…'
      ctx.fillText(l1, 2, smallPx)
      ctx.fillText(l2, 2, smallPx * 2 + 2)
    }

    const imgData = ctx.getImageData(0, 0, lwD, nameBoxH)
    const bmp = new Uint8Array(lwByt * nameBoxH).fill(0xFF)
    for (let y = 0; y < nameBoxH; y++) {
      for (let bx = 0; bx < lwD; bx++) {
        const i   = (y * lwD + bx) * 4
        const lum = (imgData.data[i]*299 + imgData.data[i+1]*587 + imgData.data[i+2]*114) / 1000
        if (lum < 128) bmp[y * lwByt + (bx >> 3)] &= ~(0x80 >> (bx & 7))
      }
    }
    // escape CR+LF ป้องกัน TSPL parser ตัด BITMAP data กลางทาง
    for (let i = 0; i < bmp.length; i++) {
      if (bmp[i] === 0x0D) bmp[i] = 0x0C
      if (bmp[i] === 0x0A) bmp[i] = 0x0B
    }
    return bmp
  }

  const buf = []
  const ascii = s => { for (const c of s) buf.push(c.charCodeAt(0)) }
  const crlf  = () => buf.push(0x0D, 0x0A)
  const line  = s => { ascii(s); crlf() }

  for (let row = 0; row < Math.ceil(items.length / cols); row++) {
    const rowItems = items.slice(row * cols, row * cols + cols)

    line(`SIZE ${pw} mm, ${ph} mm`)
    line(`GAP ${vGap} mm, 0 mm`)
    line(`DIRECTION 1`)
    line(`CLS`)

    for (let col = 0; col < rowItems.length; col++) {
      const item = rowItems[col]
      const ox   = mxD + col * (lwD + hGpD)   // column left x in dots

      // 1. Name: small bitmap (nameBoxH rows) + CR/LF escaped
      const nameBmp = await renderNameBitmap(item.name)
      ascii(`BITMAP ${ox},${myD},${lwByt},${nameBoxH},0,`)
      for (const b of nameBmp) buf.push(b)
      crlf()

      // 2. Barcode: native TSPL — printer วางตำแหน่งเอง ไม่ผ่าน bitmap x-offset
      if (item.barcode) {
        const bc = String(item.barcode).replace(/["\r\n]/g, '')
        line(`BARCODE ${ox},${bcY},"128",${bcH},1,0,2,2,"${bc}"`)
      }

      // 3. Price: native TSPL TEXT
      const price = Number(item.price || 0).toFixed(2)
      line(`TEXT ${ox},${priceY},"3",0,1,1,"${price}"`)
    }

    line(`PRINT 1,1`)
    crlf()
  }

  return new Uint8Array(buf)
}
