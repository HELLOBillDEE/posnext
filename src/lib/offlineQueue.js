// Offline queue — localStorage-based write queue + cache
// Syncs to Supabase automatically when internet returns

const QUEUE_KEY  = 'offline_queue'
const CACHE_KEYS = {
  products:   'cache_products',
  categories: 'cache_categories',
  settings:   'cache_settings',
  repairs:    'cache_repairs',
  employees:  'cache_employees',
}

// ─── Queue CRUD ───────────────────────────────────────────────
export function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch {}
}
export function addToQueue(type, payload) {
  const q = getQueue()
  const item = { id: `q_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, type, payload, createdAt: new Date().toISOString() }
  q.push(item)
  saveQueue(q)
  return item
}
function removeFromQueue(id) {
  saveQueue(getQueue().filter(i => i.id !== id))
}
export function queueCount() { return getQueue().length }

// ─── Local cache ──────────────────────────────────────────────
export function cacheSet(key, data) {
  try { localStorage.setItem(CACHE_KEYS[key] || key, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_KEYS[key] || key)
    return raw ? JSON.parse(raw).data : null
  } catch { return null }
}

// ─── Offline repair number ────────────────────────────────────
export function genOfflineRepairNo() {
  const n = parseInt(localStorage.getItem('offline_repair_seq') || '0') + 1
  localStorage.setItem('offline_repair_seq', String(n))
  return `OFF-${String(n).padStart(3, '0')}`
}

// ─── Sync ─────────────────────────────────────────────────────
export async function processQueue(supabase) {
  const q = getQueue()
  if (q.length === 0) return { synced: 0, failed: 0 }
  let synced = 0, failed = 0
  for (const item of q) {
    try {
      if (item.type === 'sale')     await syncSale(supabase, item.payload)
      if (item.type === 'repair')   await syncRepair(supabase, item.payload)
      if (item.type === 'customer') await syncCustomer(supabase, item.payload)
      removeFromQueue(item.id)
      synced++
    } catch (e) {
      console.error('[offlineQueue] sync failed:', item.type, e.message)
      failed++
    }
  }
  return { synced, failed }
}

async function syncSale(supabase, payload) {
  const { saleData, items } = payload
  const { data: sale, error } = await supabase.from('sales').insert(saleData).select().single()
  if (error) throw error
  await supabase.from('sale_items').insert(
    items.map(i => ({ ...i, sale_id: sale.id }))
  )
  for (const i of items) {
    try {
      await supabase.rpc('adjust_stock', {
        p_product_id: i.product_id, p_qty_change: -i.qty,
        p_type: 'sale', p_ref_id: sale.id,
      })
    } catch {
      const { data: pd } = await supabase.from('products').select('stock').eq('id', i.product_id).single()
      await supabase.from('products').update({ stock: (pd?.stock || 0) - i.qty }).eq('id', i.product_id)
    }
  }
}

async function syncCustomer(supabase, { action, id, payload }) {
  if (action === 'update') {
    const { error } = await supabase.from('customers').update(payload).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('customers').insert(payload)
    if (error) throw error
  }
}

async function syncRepair(supabase, payload) {
  const { formData, customerData } = payload
  // Get real sequence number
  const { data: seq } = await supabase.from('doc_sequences')
    .select('last_seq').eq('prefix', 'REPW').eq('year_month', 'all').single()
  const next = (seq?.last_seq || 0) + 1
  await supabase.from('doc_sequences')
    .upsert({ prefix: 'REPW', year_month: 'all', last_seq: next }, { onConflict: 'prefix,year_month' })
  const repair_no = `REPW-${String(next).padStart(3, '0')}`
  const { error } = await supabase.from('repair_orders').insert({ ...formData, repair_no })
  if (error) throw error
  // Upsert customer
  if (customerData) {
    const { phone, name } = customerData
    if (phone) {
      const { data: existing } = await supabase.from('customers').select('id,name').eq('phone', phone).maybeSingle()
      if (existing) {
        if (existing.name === phone || existing.name === '0' + phone)
          await supabase.from('customers').update({ name }).eq('id', existing.id)
      } else {
        await supabase.from('customers').insert({ name, phone })
      }
    } else if (name) {
      const { data: existing } = await supabase.from('customers').select('id').ilike('name', name).maybeSingle()
      if (!existing) await supabase.from('customers').insert({ name })
    }
  }
}
