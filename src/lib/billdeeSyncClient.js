// billdeeSyncClient.js — Push completed POS sales to BillDEE as income transactions

export function getBilldeeConfig() {
  if (typeof window === 'undefined') return null
  const cfg = JSON.parse(localStorage.getItem('billdee_config') || 'null')
  if (!cfg?.enabled || !cfg?.url || !cfg?.business_id || !cfg?.token) return null
  return cfg
}

/**
 * Sync a completed POS sale to BillDEE.
 * Fires silently — never throws. Call after successful DB commit.
 *
 * @param {object} sale - { id, receipt_no, total, vat, payment_method, created_at, note }
 * @param {Array}  items - [{ product_name, qty, price, subtotal }]
 * @param {string} shopName - from settings.shop_name
 */
export async function syncSaleToBillDee(sale, items = [], shopName = '') {
  const cfg = getBilldeeConfig()
  if (!cfg) return

  try {
    const endpoint = cfg.url.replace(/\/$/, '') + '/api/pos-sync'
    const body = {
      business_id:    cfg.business_id,
      receipt_no:     sale.receipt_no || String(sale.id),
      total:          sale.total,
      vat:            sale.vat || 0,
      sale_date:      (sale.created_at || new Date().toISOString()).slice(0, 10),
      payment_method: sale.payment_method || 'cash',
      shop_name:      shopName,
      note:           sale.note || '',
      items:          items.map(i => ({
        product_name: i.product_name,
        qty:          i.qty,
        price:        i.price,
        subtotal:     i.subtotal,
      })),
    }

    await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-POS-Token': cfg.token },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8000),
    })
  } catch (e) {
    // Silently log — POS operation must never be blocked by sync errors
    console.warn('[BillDEE Sync] failed:', e?.message || e)
  }
}
