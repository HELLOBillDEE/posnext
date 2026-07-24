import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { db: { schema: 'pos' } }
)

function fmtTH(n) { return Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }) }

export async function POST(req) {
  try {
    const { productIds, note, requestedBy } = await req.json()
    if (!productIds?.length) return Response.json({ error: 'ไม่มีรายการ' }, { status: 400 })

    // ── Fetch settings (bot token + chat id) ──────────────────────────────
    const { data: settings } = await supabase.from('settings').select('key, value')
      .in('key', ['telegram_bot_token', 'telegram_chat_id'])
    const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]))
    if (!cfg.telegram_bot_token || !cfg.telegram_chat_id) {
      return Response.json({ error: 'ยังไม่ได้ตั้งค่า Telegram (ตั้งในหน้า Admin)' }, { status: 400 })
    }

    // ── Fetch product details ──────────────────────────────────────────────
    const { data: products } = await supabase.from('products')
      .select('id, name, barcode, cost, price, stock, min_stock, unit')
      .in('id', productIds)

    // ── Fetch 6-month sales stats ──────────────────────────────────────────
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    // Get sale IDs in last 6 months (non-void)
    const { data: recentSales } = await supabase.from('sales')
      .select('id, created_at')
      .gte('created_at', sixMonthsAgo.toISOString())
      .neq('status', 'void')

    const saleIds = (recentSales || []).map(s => s.id)
    let statsMap = {}

    if (saleIds.length) {
      const { data: saleItems } = await supabase.from('sale_items')
        .select('product_id, qty, sale_id')
        .in('product_id', productIds)
        .in('sale_id', saleIds)

      // Group by product_id
      ;(saleItems || []).forEach(si => {
        if (!statsMap[si.product_id]) statsMap[si.product_id] = { totalQty: 0, saleIds: new Set() }
        statsMap[si.product_id].totalQty += Number(si.qty || 0)
        statsMap[si.product_id].saleIds.add(si.sale_id)
      })

      // Calculate months span for average (actual months with data, min 1)
      const salesWithDate = Object.fromEntries((recentSales || []).map(s => [s.id, s.created_at]))
      Object.keys(statsMap).forEach(pid => {
        const months = new Set()
        statsMap[pid].saleIds.forEach(sid => {
          const d = salesWithDate[sid]
          if (d) months.add(d.slice(0, 7)) // YYYY-MM
        })
        const spanMonths = Math.max(1, months.size)
        statsMap[pid].avgPerMonth = statsMap[pid].totalQty / spanMonths
        statsMap[pid].spanMonths = spanMonths
      })
    }

    // ── Build Telegram message (HTML) ──────────────────────────────────────
    const now = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
    const lines = []
    lines.push(`🛒 <b>รายการสั่งซื้อสินค้าเข้า</b>`)
    lines.push(`📅 ${now}${requestedBy ? `  👤 ${requestedBy}` : ''}`)
    lines.push(``)
    lines.push(`━━━━━━━━━━━━━━━━`)

    ;(products || []).forEach((p, i) => {
      const st = statsMap[p.id] || { totalQty: 0, avgPerMonth: 0 }
      const stockLabel = Number(p.stock) <= 0 ? '⛔ หมด' : `${fmtTH(p.stock)} ${p.unit || 'ชิ้น'}`
      const minLabel   = p.min_stock ? ` (ขั้นต่ำ ${fmtTH(p.min_stock)})` : ''
      const avgLabel   = st.totalQty > 0
        ? `${fmtTH(st.totalQty)} ชิ้น  เฉลี่ย ${fmtTH(st.avgPerMonth)}/เดือน`
        : 'ไม่มีข้อมูลขาย'

      lines.push(``)
      lines.push(`${i + 1}. <b>${p.name}</b>${p.barcode ? ` <code>[${p.barcode}]</code>` : ''}`)
      lines.push(`   💰 ทุน ฿${fmtTH(p.cost)}  │  ขาย ฿${fmtTH(p.price)}`)
      lines.push(`   📦 สต็อก: <b>${stockLabel}</b>${minLabel}`)
      lines.push(`   📈 6 เดือน: ${avgLabel}`)
    })

    lines.push(``)
    lines.push(`━━━━━━━━━━━━━━━━`)
    if (note) lines.push(`📝 <i>${note}</i>`)

    const text = lines.join('\n')

    // ── Send to Telegram ───────────────────────────────────────────────────
    const tgRes = await fetch(
      `https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text, parse_mode: 'HTML' }),
      }
    )
    const tgJson = await tgRes.json()
    if (!tgJson.ok) {
      return Response.json({ error: `Telegram: ${tgJson.description}` }, { status: 502 })
    }

    // ── Save to stock_order_requests ───────────────────────────────────────
    const items = (products || []).map(p => ({
      pid: p.id, name: p.name, barcode: p.barcode, unit: p.unit,
      cost: p.cost, price: p.price, stock: p.stock, min_stock: p.min_stock,
      total_sold_6m: statsMap[p.id]?.totalQty || 0,
      avg_per_month: +(statsMap[p.id]?.avgPerMonth || 0).toFixed(2),
    }))
    await supabase.from('stock_order_requests').insert({
      items, note, requested_by: requestedBy || '', status: 'pending',
    })

    return Response.json({ ok: true, sent: products?.length || 0 })
  } catch (e) {
    console.error('[order-request]', e)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
