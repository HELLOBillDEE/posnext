// Shared formal document HTML builder (ใบเสร็จ/ใบแจ้งหนี้/ใบส่งของ/ใบเสนอราคา)

const DOC_TITLES = {
  receipt:   { th: 'ใบเสร็จรับเงิน',  en: 'Receipt' },
  invoice:   { th: 'ใบแจ้งหนี้',       en: 'Invoice' },
  delivery:  { th: 'ใบส่งของ',          en: 'Delivery Note' },
  quotation: { th: 'ใบเสนอราคา',       en: 'Quotation' },
}

function fmt2(n) {
  const v = Number(n) || 0
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '.-'
}

function numberToThaiText(amount) {
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
  const placeNames = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']
  function cvt(n) {
    if (n === 0) return ''
    if (n >= 1000000) return cvt(Math.floor(n / 1000000)) + 'ล้าน' + cvt(n % 1000000)
    const s = String(n).padStart(6, '0')
    let r = ''
    const hasHigher = n >= 10
    for (let i = 0; i < 6; i++) {
      const d = parseInt(s[i]), p = 5 - i
      if (d === 0) continue
      if (p === 1) { r += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : digits[d] + 'สิบ' }
      else if (p === 0) { r += d === 1 && hasHigher ? 'เอ็ด' : digits[d] }
      else { r += digits[d] + placeNames[p] }
    }
    return r
  }
  const baht = Math.floor(amount)
  const satang = Math.round((amount - baht) * 100)
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน'
  let res = (baht > 0 ? cvt(baht) : 'ศูนย์') + 'บาท'
  return satang === 0 ? res + 'ถ้วน' : res + cvt(satang) + 'สตางค์'
}

/**
 * @param {string} docType - 'receipt'|'invoice'|'delivery'|'quotation'
 * @param {Array}  items   - [{name, qty, unit, price, disc, subtotal, note}]
 * @param {Object} totals  - {subtotal, discount, vat, total}
 * @param {Object} customer - {name, address, contact, phone, tax_id}
 * @param {Object} shop    - from settings table (key→value map)
 * @param {Object} opts    - {doc_no, date, valid_until, prepared_by, paid_amount, paid_date, note, payment_method}
 */
export function buildFormalDocHTML(docType, items, totals, customer, shop, opts = {}) {
  const title = DOC_TITLES[docType] || DOC_TITLES.receipt
  const isDelivery = docType === 'delivery'
  const isQuotation = docType === 'quotation'

  const docNo = opts.doc_no || '—'
  const today = opts.date || new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const logoHTML = shop.logo_url
    ? `<img src="${shop.logo_url}" style="height:52px;object-fit:contain;max-width:80px">`
    : ''

  const itemRows = (items || []).map((item, idx) => {
    const disc = Number(item.disc) || 0
    const sub  = Number(item.subtotal) || (Number(item.price) * Number(item.qty) - disc)
    return `<tr>
      <td style="text-align:center;border:1px solid #ddd;padding:8px 6px">${idx + 1}</td>
      <td style="border:1px solid #ddd;padding:8px 10px">${item.name || ''}${item.note ? `<br><span style="font-size:10pt;color:#666">${item.note}</span>` : ''}</td>
      <td style="text-align:center;border:1px solid #ddd;padding:8px 6px">${item.qty}</td>
      <td style="text-align:right;border:1px solid #ddd;padding:8px 10px">${isDelivery ? '—' : fmt2(item.price)}</td>
      <td style="text-align:center;border:1px solid #ddd;padding:8px 6px">${disc > 0 ? fmt2(disc) : '-'}</td>
      <td style="text-align:right;border:1px solid #ddd;padding:8px 10px;font-weight:bold">${isDelivery ? '—' : fmt2(sub)}</td>
    </tr>`
  }).join('')

  // Empty filler rows (at least 8 rows total)
  const fillerCount = Math.max(0, 8 - (items || []).length)
  const fillerRows = Array.from({length: fillerCount}, () =>
    `<tr style="height:30px"><td style="border:1px solid #ddd"></td><td style="border:1px solid #ddd"></td><td style="border:1px solid #ddd"></td><td style="border:1px solid #ddd"></td><td style="border:1px solid #ddd"></td><td style="border:1px solid #ddd"></td></tr>`
  ).join('')

  const subtotal = Number(totals.subtotal) || 0
  const discAmt  = Number(totals.discount) || 0
  const vatAmt   = Number(totals.vat) || 0
  const total    = Number(totals.total) || 0

  const pmCash   = opts.payment_method === 'cash' || opts.payment_method === 'เงินสด'
  const pmTransfer = opts.payment_method === 'transfer' || opts.payment_method === 'โอน'

  const bankInfo = (shop.shop_bank_account_name || shop.shop_bank_name || shop.shop_bank_account)
    ? `<p style="margin:4px 0">- ชื่อบัญชี <strong>${shop.shop_bank_account_name || ''}</strong></p>
       <p style="margin:4px 0">- ธนาคาร ${shop.shop_bank_name || ''} เลขที่บัญชี ${shop.shop_bank_account || ''}</p>`
    : ''

  const checkbox = (checked) => `<span style="display:inline-block;width:13px;height:13px;border:1.5px solid #333;margin-right:5px;vertical-align:middle;background:${checked?'#333':'white'};position:relative">${checked?'<span style="position:absolute;color:white;font-size:10px;top:-2px;left:1px">✓</span>':''}</span>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${title.th} ${docNo}</title>
<style>
  @page { size: A4; margin: 15mm 18mm; }
  body { font-family: 'Sarabun','TH Sarabun New',Arial,sans-serif; font-size: 13pt; margin: 0; padding: 0; color: #111; }
  .doc-title-th { font-size: 22pt; font-weight: bold; margin: 0 0 2px; }
  .doc-title-en { font-size: 14pt; color: #444; margin: 0 0 16px; }
  .shop-name { font-size: 16pt; font-weight: bold; text-align: right; margin: 0; }
  .shop-sub  { font-size: 10pt; color: #555; text-align: right; margin: 0; }
  table.info { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  table.info td { padding: 2px 0; font-size: 12pt; vertical-align: top; }
  .label { color: #222; font-weight: bold; white-space: nowrap; padding-right: 8px; }
  .val { color: #111; }
  .val-box { border-bottom: 1px solid #aaa; min-width: 180px; display: inline-block; padding: 0 4px; }
  .dotted { border: none; border-top: 1px dashed #bbb; margin: 10px 0; }
  table.items { width: 100%; border-collapse: collapse; margin: 12px 0 0; }
  table.items th { background: #222; color: white; padding: 8px 10px; font-size: 12pt; border: 1px solid #222; }
  table.items td { font-size: 12pt; }
  .sum-row { background: #f8f8f8; }
  .total-row td { background: #222; color: white; font-weight: bold; font-size: 14pt; padding: 8px 10px; }
  .sec-title { font-weight: bold; font-size: 12pt; margin: 10px 0 4px; }
  .pm-row { font-size: 12pt; margin: 4px 0; display: flex; align-items: flex-start; gap: 6px; }
  .sig-row { display: flex; justify-content: space-around; margin-top: 16px; gap: 12px; }
  .sig-box { flex: 1; text-align: center; }
  .sig-line { border-bottom: 1px solid #555; height: 38px; margin-bottom: 4px; }
  .sig-date { font-size: 11pt; color: #555; margin-top: 2px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<!-- Header -->
<table style="width:100%;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="width:55%;vertical-align:bottom">
      <p class="doc-title-th">${title.th}</p>
      <p class="doc-title-en">${title.en}</p>
    </td>
    <td style="text-align:right;vertical-align:top">
      <div style="display:inline-flex;align-items:center;gap:12px">
        ${logoHTML}
        <div>
          <p class="shop-name">${shop.shop_name || 'ร้านค้า'}</p>
          ${shop.shop_address ? `<p class="shop-sub">${shop.shop_address}</p>` : ''}
          ${shop.shop_tax_id ? `<p class="shop-sub">เลขที่ผู้เสียภาษี ${shop.shop_tax_id}</p>` : ''}
        </div>
      </div>
    </td>
  </tr>
</table>

<!-- Customer + Doc Info -->
<table class="info">
  <tr>
    <td style="width:55%">
      <table><tr><td class="label">ลูกค้า:</td><td class="val">${customer?.name || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</td></tr>
      <tr><td class="label">ที่อยู่:</td><td class="val">${customer?.address || '&nbsp;'}</td></tr>
      ${customer?.contact ? `<tr><td class="label">ผู้ติดต่อ:</td><td class="val">${customer.contact}</td></tr>` : ''}
      <tr><td class="label">เบอร์ติดต่อ:</td><td class="val">${customer?.phone || '—'}</td></tr>
      ${customer?.tax_id ? `<tr><td class="label">เลขที่ผู้เสียภาษี:</td><td class="val">${customer.tax_id}</td></tr>` : ''}
      </table>
    </td>
    <td style="text-align:right;vertical-align:top">
      <table style="margin-left:auto">
        <tr><td class="label" style="text-align:right">เลขที่:</td><td class="val" style="padding-left:8px"><span class="val-box">${docNo}</span></td></tr>
        <tr><td class="label" style="text-align:right">วันที่:</td><td class="val" style="padding-left:8px"><span class="val-box">${today}</span></td></tr>
        ${isQuotation && opts.valid_until ? `<tr><td class="label" style="text-align:right">ใช้ได้ถึง:</td><td class="val" style="padding-left:8px"><span class="val-box">${opts.valid_until}</span></td></tr>` : ''}
      </table>
    </td>
  </tr>
</table>

<hr class="dotted">

<!-- Issuer Info -->
<table class="info" style="margin-bottom:12px">
  <tr>
    <td style="width:55%">
      <table>
        <tr><td class="label">ผู้ออก:</td><td class="val">${shop.shop_name || ''}</td></tr>
        <tr><td class="label">ที่อยู่:</td><td class="val">${shop.shop_address || ''}</td></tr>
      </table>
    </td>
    <td>
      <table>
        ${opts.prepared_by ? `<tr><td class="label">จัดเตรียมโดย:</td><td class="val" style="padding-left:8px">${opts.prepared_by}</td></tr>` : ''}
        ${shop.shop_phone ? `<tr><td class="label">เบอร์ติดต่อ:</td><td class="val" style="padding-left:8px">${shop.shop_phone}</td></tr>` : ''}
        ${shop.shop_email ? `<tr><td class="label">อีเมล:</td><td class="val" style="padding-left:8px">${shop.shop_email}</td></tr>` : ''}
      </table>
    </td>
  </tr>
</table>

<!-- Items Table -->
<table class="items">
  <thead>
    <tr>
      <th style="width:50px">ลำดับที่</th>
      <th>รายละเอียด</th>
      <th style="width:70px">จำนวน</th>
      <th style="width:110px;text-align:right">${isDelivery ? 'หน่วย' : 'ราคาต่อหน่วย'}</th>
      <th style="width:90px;text-align:center">อื่นๆ</th>
      <th style="width:110px;text-align:right">รวมเป็นเงิน</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    ${fillerRows}
  </tbody>
</table>

<!-- Summary -->
<table style="width:100%;border-collapse:collapse">
  <tr>
    <td style="vertical-align:top;padding:10px 0 0;font-size:12pt">
      <strong>หมายเหตุ:</strong> ${opts.note || ''}
    </td>
    <td style="width:300px;vertical-align:top">
      <table style="width:100%;border-collapse:collapse">
        <tr class="sum-row"><td style="padding:6px 10px;border:1px solid #ddd;font-size:12pt">ราคารวมสินค้า (บาท)</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-size:12pt">${fmt2(subtotal)}</td></tr>
        ${discAmt > 0 ? `<tr class="sum-row"><td style="padding:6px 10px;border:1px solid #ddd;font-size:12pt">ส่วนลด</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-size:12pt">${fmt2(discAmt)}</td></tr>` : `<tr class="sum-row"><td style="padding:6px 10px;border:1px solid #ddd;font-size:12pt">อื่นๆ</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-size:12pt">0.-</td></tr>`}
        ${vatAmt > 0 ? `<tr class="sum-row"><td style="padding:6px 10px;border:1px solid #ddd;font-size:12pt">VAT 7%</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-size:12pt">${fmt2(vatAmt)}</td></tr>` : ''}
        <tr class="total-row"><td style="padding:8px 10px;border:1px solid #222">จำนวนเงินรวมทั้งสิ้น (บาท)</td><td style="padding:8px 10px;border:1px solid #222;text-align:right">${fmt2(total)}</td></tr>
      </table>
    </td>
  </tr>
</table>

${!isDelivery && !isQuotation ? `
<!-- Payment Info -->
<div style="margin-top:12px">
  <p class="sec-title">ข้อมูลการชำระเงิน:</p>
  ${bankInfo}
  <div class="pm-row"><span>${checkbox(pmCash)}</span><span>เงินสด:${opts.paid_date ? `&nbsp;&nbsp;ชำระวันที่ <strong>${opts.paid_date}</strong> ยอด <strong>${fmt2(opts.paid_amount || total)}</strong> บาท` : '&nbsp;&nbsp;รายละเอียดเพิ่มเติม ......................................'}</span></div>
  <div class="pm-row"><span>${checkbox(pmTransfer)}</span><span>เงินโอน:</span></div>
  <div style="padding-left:20px;color:#666;font-size:11pt;margin-bottom:4px">รายละเอียดเพิ่มเติม ......................................................</div>
  <div class="pm-row"><span>${checkbox(false)}</span><span>อื่นๆ</span></div>
  <div style="padding-left:20px;color:#666;font-size:11pt">รายละเอียดเพิ่มเติม ......................................................</div>
</div>` : ''}

<!-- Signatures -->
<div class="sig-row">
  <div class="sig-box">
    <div class="sig-line"></div>
    <div style="font-size:12pt">${isQuotation ? 'ผู้เสนอราคา' : isDelivery ? 'ผู้ส่งของ' : 'อนุมัติโดย'}</div>
    <div class="sig-date">วันที่ ................................</div>
  </div>
  <div class="sig-box" style="flex:0.3"></div>
  <div class="sig-box">
    <div class="sig-line"></div>
    <div style="font-size:12pt">${isQuotation ? 'ผู้รับใบเสนอราคา' : isDelivery ? 'ผู้รับของ' : 'รับชำระเงิน'}</div>
    <div class="sig-date">วันที่ ................................</div>
  </div>
</div>

<p style="text-align:center;font-size:11pt;color:#888;margin-top:12px">${numberToThaiText(total)}</p>

<script>window.onload = () => { window.print() }</script>
</body></html>`
}
