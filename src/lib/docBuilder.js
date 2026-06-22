// Shared formal document HTML builder (ใบเสร็จ/ใบแจ้งหนี้/ใบส่งของ/ใบเสนอราคา)

const DOC_TITLES = {
  receipt:   { th: 'ใบเสร็จรับเงิน',  en: 'Receipt' },
  invoice:   { th: 'ใบแจ้งหนี้',       en: 'Invoice' },
  delivery:  { th: 'ใบส่งของ',          en: 'Delivery Note' },
  quotation: { th: 'ใบเสนอราคา',       en: 'Quotation' },
}

function fmt2(n) {
  const v = Number(n) || 0
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
 * @param {Object} customer - {name, address, phone, tax_id, contact}
 * @param {Object} shop    - from settings table (key→value map)
 * @param {Object} opts    - {doc_no, date, valid_until, prepared_by, paid_amount, paid_date, note, payment_method}
 */
export function buildFormalDocHTML(docType, items, totals, customer, shop, opts = {}) {
  const title  = DOC_TITLES[docType] || DOC_TITLES.receipt
  const accent = '#e07a00'
  const isDelivery  = docType === 'delivery'
  const isQuotation = docType === 'quotation'
  const isReceipt   = docType === 'receipt'

  const docNo = opts.doc_no || ''
  const today = opts.date || new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const subtotal = Number(totals.subtotal) || 0
  const discAmt  = Number(totals.discount) || 0
  const vatAmt   = Number(totals.vat) || 0
  const total    = Number(totals.total) || 0

  // Logo
  const logoHTML = shop.logo_url
    ? `<img src="${shop.logo_url}" style="height:48px;max-width:100px;object-fit:contain;display:block;margin-bottom:6px" onerror="this.style.display='none'">`
    : ''

  // Item rows
  const itemRows = (items || []).map((item, idx) => {
    const disc = Number(item.disc) || 0
    const sub  = Number(item.subtotal) ?? (Number(item.price) * Number(item.qty) - disc)
    return `<tr>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;color:#555;font-size:12pt">${idx + 1}</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12pt">${item.name || ''}${item.note ? `<br><span style="font-size:10pt;color:#888">${item.note}</span>` : ''}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;font-size:12pt">${item.qty}</td>
      <td style="padding:8px 8px;border:1px solid #e5e7eb;text-align:center;font-size:12pt">${item.unit || ''}</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;font-size:12pt">${isDelivery ? '—' : fmt2(item.price)}</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;font-size:12pt;font-weight:bold">${isDelivery ? '—' : fmt2(sub)}</td>
    </tr>`
  }).join('')

  const fillerCount = Math.max(0, 7 - (items || []).length)
  const fillerRows  = Array.from({ length: fillerCount }, () =>
    `<tr style="height:28px"><td style="border:1px solid #e5e7eb"></td><td style="border:1px solid #e5e7eb"></td><td style="border:1px solid #e5e7eb"></td><td style="border:1px solid #e5e7eb"></td><td style="border:1px solid #e5e7eb"></td><td style="border:1px solid #e5e7eb"></td></tr>`
  ).join('')

  // Payment method checkboxes
  const pmCash     = opts.payment_method === 'cash'     || opts.payment_method === 'เงินสด'
  const pmTransfer = opts.payment_method === 'transfer' || opts.payment_method === 'โอน'
  const chk = (on) => `<span style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border:1.5px solid #555;margin-right:5px;vertical-align:middle;background:${on?'#333':'white'};color:white;font-size:9px">${on?'✓':''}</span>`

  const bankInfo = (shop.shop_bank_account_name || shop.shop_bank_name)
    ? `<div style="font-size:11pt;margin-top:4px;color:#444">
        ${shop.shop_bank_account_name ? `<div>ชื่อบัญชี <strong>${shop.shop_bank_account_name}</strong></div>` : ''}
        ${shop.shop_bank_name ? `<div>ธนาคาร ${shop.shop_bank_name}${shop.shop_bank_account ? ` เลขที่บัญชี <strong>${shop.shop_bank_account}</strong>` : ''}</div>` : ''}
      </div>` : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${title.th} ${docNo}</title>
<style>
  @page { size: A4; margin: 14mm 18mm 14mm; }
  body { font-family: 'Sarabun','TH Sarabun New',Arial,sans-serif; font-size: 13pt; margin: 0; padding: 0; color: #111; line-height: 1.5; }
  .accent { color: ${accent}; }
  .sec-label { font-size: 12pt; font-weight: bold; color: ${accent}; margin-bottom: 3px; }
  table.items { width: 100%; border-collapse: collapse; margin: 14px 0 0; }
  table.items th { background: #1e293b; color: white; padding: 9px 10px; font-size: 12pt; border: 1px solid #1e293b; }
  .sum-label { color: ${accent}; font-size: 12pt; text-align: right; padding: 4px 10px; }
  .sum-val   { font-size: 12pt; text-align: right; padding: 4px 10px; min-width: 110px; }
  .total-label { color: ${accent}; font-size: 14pt; font-weight: bold; text-align: right; padding: 6px 10px; }
  .total-val   { font-size: 14pt; font-weight: bold; text-align: right; padding: 6px 10px; border-top: 1px solid #ddd; }
  .sig-box { flex: 1; text-align: center; }
  .sig-line { border-bottom: 1px solid #999; height: 42px; margin-bottom: 4px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<!-- ═══ TOP: Logo + Title ═══ -->
<table style="width:100%;border-collapse:collapse;margin-bottom:14px">
  <tr>
    <td style="width:60%;vertical-align:top">
      ${logoHTML}
      <p style="font-size:14pt;font-weight:bold;margin:0 0 2px">${shop.shop_name || 'ร้านค้า'}</p>
      ${shop.shop_address ? `<p style="font-size:11pt;color:#555;margin:0 0 2px;max-width:280px">${shop.shop_address.replace(/\n/g,'<br>')}</p>` : ''}
      ${shop.shop_tax_id ? `<p style="font-size:11pt;color:#555;margin:0 0 2px">เลขประจำตัวผู้เสียภาษี ${shop.shop_tax_id}</p>` : ''}
      ${shop.shop_phone ? `<p style="font-size:11pt;color:#555;margin:0 0 2px">โทร. ${shop.shop_phone}</p>` : ''}
      ${shop.shop_email ? `<p style="font-size:11pt;color:#555;margin:0">อีเมล ${shop.shop_email}</p>` : ''}
    </td>
    <td style="vertical-align:top;text-align:right">
      <p style="font-size:28pt;font-weight:bold;color:${accent};margin:0 0 12px;line-height:1.1">${title.th}</p>
      <table style="margin-left:auto;border-collapse:collapse">
        <tr><td style="font-size:12pt;color:#555;padding:2px 10px 2px 0;text-align:right">เลขที่</td><td style="font-size:12pt;font-weight:bold;padding:2px 0;min-width:130px">${docNo || '—'}</td></tr>
        <tr><td style="font-size:12pt;color:#555;padding:2px 10px 2px 0;text-align:right">วันที่</td><td style="font-size:12pt;padding:2px 0">${today}</td></tr>
        ${isQuotation && opts.valid_until ? `<tr><td style="font-size:12pt;color:#555;padding:2px 10px 2px 0;text-align:right">ใช้ได้ถึง</td><td style="font-size:12pt;padding:2px 0">${opts.valid_until}</td></tr>` : ''}
        ${opts.prepared_by ? `<tr><td style="font-size:12pt;color:#555;padding:2px 10px 2px 0;text-align:right">ผู้ขาย</td><td style="font-size:12pt;padding:2px 0">${opts.prepared_by}</td></tr>` : ''}
      </table>
    </td>
  </tr>
</table>

<hr style="border:none;border-top:1px solid #ddd;margin:10px 0">

<!-- ═══ Customer Info ═══ -->
<div style="margin-bottom:14px">
  <p class="sec-label">ลูกค้า</p>
  ${customer?.name ? `<p style="font-size:13pt;font-weight:bold;margin:0 0 2px">${customer.name}</p>` : '<p style="font-size:13pt;margin:0 0 2px;color:#aaa">— ไม่ระบุ —</p>'}
  ${customer?.address ? `<p style="font-size:11pt;color:#555;margin:0 0 2px;max-width:380px">${customer.address.replace(/\n/g,'<br>')}</p>` : ''}
  ${customer?.tax_id ? `<p style="font-size:11pt;color:#555;margin:0 0 2px">เลขประจำตัวผู้เสียภาษี ${customer.tax_id}</p>` : ''}
  ${customer?.contact ? `<p style="font-size:11pt;color:#555;margin:0 0 2px">ผู้ติดต่อ ${customer.contact}</p>` : ''}
  ${customer?.phone ? `<p style="font-size:11pt;color:#555;margin:0">โทร. ${customer.phone}</p>` : ''}
</div>

<!-- ═══ Items Table ═══ -->
<table class="items">
  <thead>
    <tr>
      <th style="width:44px;text-align:center">#</th>
      <th style="text-align:left">รายละเอียด</th>
      <th style="width:60px;text-align:center">จำนวน</th>
      <th style="width:60px;text-align:center">หน่วย</th>
      <th style="width:110px;text-align:right">${isDelivery ? '—' : 'ราคาต่อหน่วย'}</th>
      <th style="width:110px;text-align:right">ยอดรวม</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    ${fillerRows}
  </tbody>
</table>

<!-- ═══ Summary ═══ -->
<table style="width:100%;border-collapse:collapse;margin-top:0">
  <tr>
    <td style="vertical-align:top;padding:10px 0 0;font-size:12pt;width:55%">
      <p style="margin:0 0 4px;color:#555;font-size:11pt">(${numberToThaiText(total)})</p>
      ${opts.note ? `<p style="margin:4px 0;font-size:11pt;color:#555">หมายเหตุ: ${opts.note}</p>` : ''}
    </td>
    <td style="vertical-align:top;padding-top:10px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td class="sum-label">รวมเป็นเงิน</td><td class="sum-val">${fmt2(subtotal)} บาท</td></tr>
        ${discAmt > 0 ? `<tr><td class="sum-label">ส่วนลด</td><td class="sum-val">${fmt2(discAmt)} บาท</td></tr>` : ''}
        ${vatAmt > 0 ? `<tr><td class="sum-label">ภาษีมูลค่าเพิ่ม 7%</td><td class="sum-val">${fmt2(vatAmt)} บาท</td></tr>` : ''}
        <tr><td class="total-label">จำนวนเงินรวมทั้งสิ้น</td><td class="total-val">${fmt2(total)} บาท</td></tr>
      </table>
    </td>
  </tr>
</table>

${!isDelivery && !isQuotation ? `
<!-- ═══ Payment ═══ -->
<div style="margin-top:12px;border-top:1px solid #eee;padding-top:10px">
  <p style="font-size:12pt;font-weight:bold;margin:0 0 6px">ข้อมูลการชำระเงิน:</p>
  ${bankInfo}
  <div style="margin-top:6px;font-size:12pt">
    <div style="margin-bottom:4px">${chk(pmCash)} เงินสด${opts.paid_date ? `&nbsp; ชำระวันที่ <strong>${opts.paid_date}</strong> ยอด <strong>${fmt2(opts.paid_amount || total)}</strong> บาท` : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</div>
    <div style="margin-bottom:4px">${chk(pmTransfer)} เงินโอน &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
  </div>
</div>` : ''}

<!-- ═══ Signatures ═══ -->
<div style="display:flex;justify-content:space-around;margin-top:20px;gap:16px">
  <div class="sig-box">
    <div class="sig-line"></div>
    <div style="font-size:12pt">${isQuotation ? 'ผู้เสนอราคา' : isDelivery ? 'ผู้ส่งของ' : 'อนุมัติโดย'}</div>
    <div style="font-size:11pt;color:#777;margin-top:2px">วันที่ ................................</div>
  </div>
  <div style="flex:0.2"></div>
  <div class="sig-box">
    <div class="sig-line"></div>
    <div style="font-size:12pt">${isQuotation ? 'ผู้รับใบเสนอราคา' : isDelivery ? 'ผู้รับของ' : 'รับชำระเงิน'}</div>
    <div style="font-size:11pt;color:#777;margin-top:2px">วันที่ ................................</div>
  </div>
</div>

<script>window.onload = () => { window.print() }</script>
</body></html>`
}
