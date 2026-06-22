'use client'

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

// ส่ง ESC/POS ไปเครื่องพิมพ์ผ่าน local print bridge
export async function printViaBridge(bridgeUrl, ip, port, bytes) {
  const b64 = btoa(Array.from(bytes).map(b => String.fromCharCode(b)).join(''))
  const url = bridgeUrl.replace(/\/$/, '') + '/print'
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port: parseInt(port) || 9100, data: b64 }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error('Bridge: ' + await res.text())
  } finally {
    clearTimeout(tid)
  }
}

// คำสั่งเปิดลิ้นชัก (cash drawer) ผ่าน printer port
export function buildDrawerKickESCPOS() {
  // ESC p pin t1 t2 — pin 2 (0x00) หรือ pin 5 (0x01), pulse 50ms on / 500ms off
  return new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA])
}

// เปิดลิ้นชักผ่าน bridge
export async function kickDrawerViaBridge(bridgeUrl, ip, port) {
  return printViaBridge(bridgeUrl, ip, port, buildDrawerKickESCPOS())
}

// สร้าง ESC/POS ใบเสร็จแบบ bitmap — ไม่มีปัญหา Thai codepage
export async function buildReceiptESCPOS(r, paperMM = 80) {
  // printable width: 80mm paper → 576 dots (72mm), 58mm → 384 dots (48mm)
  const pw   = paperMM >= 80 ? 576 : 384
  const pad  = 10   // dots left/right padding
  const fSm  = 18   // normal font px
  const fLg  = 30   // header font px
  const lhSm = fSm + 8
  const lhLg = fLg + 8

  // build draw list
  const dl = []
  const line = (text, align = 'left', size = fSm, bold = false) =>
    dl.push({ text, align, size, bold })
  const two  = (left, right, bold = false) =>
    dl.push({ two: true, left, right, size: fSm, bold })
  const div  = () => dl.push({ divider: true })
  const nl   = () => dl.push({ text: '', align: 'left', size: fSm })

  if (r.shopLogo) dl.push({ logo: r.shopLogo })
  line(r.shopName || 'ร้านค้า', 'center', fLg, true)
  if (r.shopAddress) line(r.shopAddress, 'center')
  if (r.shopPhone)   line('โทร: ' + r.shopPhone, 'center')
  nl(); div()
  line('เลขที่: ' + (r.receipt_no || ''))
  line('วันที่: ' + new Date(r.created_at || Date.now()).toLocaleString('th-TH'))
  div()

  for (const i of r.items || []) {
    line(i.name || '')
    two(`  ${i.qty} x ${Number(i.price).toFixed(2)}`,
        Number(i.price * i.qty - (i.disc || 0)).toFixed(2))
  }
  div()

  two('รวม', Number(r.subtotal).toFixed(2))
  if (Number(r.discount) > 0) two('ส่วนลด', '-' + Number(r.discount).toFixed(2))
  if (Number(r.vat) > 0)      two(`VAT ${Number((r.vatRate||0) * 100).toFixed(0)}%`, Number(r.vat).toFixed(2))
  two('สุทธิ', '฿' + Number(r.total).toFixed(2), true)
  two('ชำระ', Number(r.payment_amount || r.total).toFixed(2))
  if (Number(r.change) > 0) two('ทอน', Number(r.change).toFixed(2))

  nl()
  line(r.footer || 'ขอบคุณที่ใช้บริการ', 'center')
  nl(); nl(); nl()

  // โหลดโลโก้ก่อน (ถ้ามี)
  const logoItem = dl.find(d => d.logo)
  let logoImg = null
  const logoH = 160   // สูง 160 dots (~20mm) = 2x
  if (logoItem) {
    logoImg = await new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload  = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = logoItem.logo
    })
  }

  // measure total height
  let totalH = 0
  for (const d of dl) {
    if (d.logo)    totalH += logoImg ? logoH + 8 : 0
    else if (d.divider) totalH += 4
    else totalH += (d.size || fSm) + 8
  }

  // render to canvas
  const canvas = document.createElement('canvas')
  canvas.width  = pw
  canvas.height = totalH + 10
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, pw, canvas.height)
  ctx.fillStyle = '#000'

  let y = 6
  for (const d of dl) {
    if (d.logo) {
      if (logoImg) {
        const scale = Math.min(1, (pw - pad*2) / logoImg.width, logoH / logoImg.height)
        const dw = logoImg.width  * scale
        const dh = logoImg.height * scale
        ctx.drawImage(logoImg, (pw - dw) / 2, y, dw, dh)
        y += dh + 8
      }
      continue
    }
    if (d.divider) {
      ctx.fillRect(pad, y + 1, pw - pad * 2, 1)
      y += 4
      continue
    }
    const sz  = d.size || fSm
    const lh  = sz + 8
    ctx.font = `${d.bold ? 'bold ' : ''}${sz}px Sarabun, Arial, sans-serif`
    if (d.two) {
      ctx.textAlign = 'left'
      if (d.bold) ctx.font = `bold ${sz}px Sarabun, Arial, sans-serif`
      ctx.fillText(d.left, pad, y + sz)
      ctx.textAlign = 'right'
      ctx.fillText(d.right, pw - pad, y + sz)
    } else {
      ctx.textAlign = d.align === 'center' ? 'center' : d.align === 'right' ? 'right' : 'left'
      const x = d.align === 'center' ? pw / 2 : d.align === 'right' ? pw - pad : pad
      ctx.fillText(d.text, x, y + sz)
    }
    y += lh
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
  b.push(...bitmap)
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

  // Load JsBarcode dynamically if not yet loaded
  if (typeof window.JsBarcode === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js'
      s.onload = resolve; s.onerror = reject
      document.head.appendChild(s)
    })
  }

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
      const ox = m + col * lw   // origin x (dots)
      const oy = m               // origin y (dots)

      // Product name
      const nameFontPx = Math.max(10, Math.round(lh * 0.18))
      ctx.font = `bold ${nameFontPx}px Sarabun, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(
        item.name.length > 14 ? item.name.slice(0, 13) + '…' : item.name,
        ox + lw / 2, oy + nameFontPx
      )

      // Barcode
      if (item.barcode) {
        try {
          const bc = document.createElement('canvas')
          window.JsBarcode(bc, item.barcode, {
            format: 'CODE128',
            width: Math.max(1, Math.floor(lw / 72)),
            height: Math.round(lh * 0.52),
            displayValue: true,
            fontSize: Math.max(6, Math.round(lh * 0.09)),
            margin: 0,
          })
          const bx = ox + Math.floor((lw - bc.width) / 2)
          const by = oy + nameFontPx + 3
          ctx.drawImage(bc, bx, by)
        } catch { /* skip if barcode fails */ }
      }

      // Price
      const priceFontPx = Math.max(10, Math.round(lh * 0.16))
      ctx.font = `bold ${priceFontPx}px Sarabun, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('฿' + Number(item.price).toFixed(2), ox + lw / 2, oy + lh - 3)
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
    allBytes.push(...bitmap)
    allBytes.push(0x0A)  // LF
  }

  return new Uint8Array(allBytes)
}

// ─── TSPL Label Generator (canvas bitmap — รองรับภาษาไทย) ───────────────────
export async function buildLabelTSPL(items, size) {
  const dpm  = 8   // 203 DPI ≈ 8 dots/mm
  const pw   = size.pw   || 100
  const ph   = size.ph   || 25
  const cols = size.cols || 3
  const mx   = size.mx  ?? size.m ?? 1
  const my   = size.my  ?? size.m ?? 0
  const hGap = size.hGap ?? 2
  const vGap = size.vGap ?? 2

  const lw   = size.lw ?? (pw - mx*2 - hGap*(cols-1)) / cols
  const lh   = ph - my*2
  const pwD  = Math.round(pw  * dpm)
  const phD  = Math.round(ph  * dpm)
  const lwD  = Math.round(lw  * dpm)
  const lhD  = Math.round(lh  * dpm)
  const mxD  = Math.round(mx  * dpm)
  const myD  = Math.round(my  * dpm)
  const hGpD = Math.round(hGap * dpm)
  const wBytes = Math.ceil(pwD / 8)

  // โหลด JsBarcode ถ้ายังไม่มี
  if (typeof window.JsBarcode === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js'
      s.onload = resolve; s.onerror = reject
      document.head.appendChild(s)
    })
  }

  async function renderRow(rowItems) {
    const canvas = document.createElement('canvas')
    canvas.width  = pwD
    canvas.height = phD
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, pwD, phD)
    ctx.fillStyle = '#000'

    for (let col = 0; col < rowItems.length; col++) {
      const item = rowItems[col]
      const ox = mxD + col * (lwD + hGpD)
      const oy = myD
      const cx = ox + lwD / 2

      // ชื่อสินค้า
      const namePx = Math.round(lhD * 0.1)
      const nameY  = oy + namePx + 2
      const bcY    = nameY + 4

      ctx.font = `bold ${namePx}px Sarabun, Arial, sans-serif`
      ctx.textAlign = 'center'
      const maxChars = Math.floor(lwD / (namePx * 0.65))
      ctx.fillText((item.name || '').substring(0, maxChars), cx, nameY)

      // บาร์โค้ด — render ก่อน เพื่อรู้ความสูงจริง
      let bcBottom = bcY
      if (item.barcode) {
        try {
          const bc = document.createElement('canvas')
          // ความสูง bar = พื้นที่เหลือ หักชื่อ หักราคา หักข้อความใต้ barcode
          const availH = phD - myD - nameY - namePx - 8
          const bcH    = Math.max(40, Math.round(availH * 0.72))
          window.JsBarcode(bc, item.barcode, {
            format: 'CODE128', width: 1.4,
            height: bcH,
            displayValue: true, fontSize: 10, margin: 0,
          })
          const bx = ox + Math.round((lwD - bc.width) / 2)
          ctx.drawImage(bc, bx, bcY)
          bcBottom = bcY + bc.height   // ตำแหน่งใต้ barcode จริง
        } catch(e) { /* skip */ }
      }

      // ราคา — วางทันทีใต้ barcode
      const pricePx = Math.round(lhD * 0.1)
      ctx.font = `bold ${pricePx}px Sarabun, Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('฿' + Number(item.price).toFixed(2), cx, bcBottom + pricePx + 2)
    }

    // canvas → 1-bit bitmap (TSPL: 0=black, 1=white — invert จาก ESC/POS)
    const imgData = ctx.getImageData(0, 0, pwD, phD)
    const bitmap  = new Uint8Array(wBytes * phD).fill(0xFF)   // เริ่มต้น=ขาวหมด
    for (let y = 0; y < phD; y++) {
      for (let x = 0; x < pwD; x++) {
        const i   = (y * pwD + x) * 4
        const lum = (imgData.data[i]*299 + imgData.data[i+1]*587 + imgData.data[i+2]*114) / 1000
        if (lum < 128) bitmap[y * wBytes + (x >> 3)] &= ~(0x80 >> (x & 7))  // clear bit = ดำ
      }
    }
    return bitmap
  }

  // Build TSPL byte stream
  const buf = []
  const ascii = s => { for (const c of s) buf.push(c.charCodeAt(0)) }
  const crlf  = () => buf.push(0x0D, 0x0A)
  const line  = s => { ascii(s); crlf() }

  for (let row = 0; row < Math.ceil(items.length / cols); row++) {
    const rowItems = items.slice(row * cols, row * cols + cols)
    const bitmap   = await renderRow(rowItems)

    line(`SIZE ${pw} mm, ${ph} mm`)
    line(`GAP ${vGap} mm, 0 mm`)
    line(`DIRECTION 0`)
    line(`CLS`)
    // BITMAP x,y,width_bytes,height,mode,<binary data>
    ascii(`BITMAP 0,0,${wBytes},${phD},0,`)
    for (const b of bitmap) buf.push(b)
    crlf()
    line(`PRINT 1,1`)
    crlf()
  }

  return new Uint8Array(buf)
}
