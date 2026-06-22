'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDT, todayISO, PAY_LABEL } from '@/lib/utils'

const TABS = ['ใบเสร็จขาย', 'ใบสั่งซื้อ (PO)', 'ลูกหนี้ AR', 'เจ้าหนี้ AP']

export default function DocumentsPage() {
  const [tab, setTab]         = useState(0)
  const [sales, setSales]     = useState([])
  const [pos, setPOs]         = useState([])
  const [settings, setSettings] = useState({})
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo]   = useState(todayISO())
  const [search, setSearch]   = useState('')
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadData() }, [tab, dateFrom, dateTo])

  async function loadData() {
    setLoading(true)
    const { data: cfg } = await supabase.from('settings').select('*')
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))

    const from = dateFrom + 'T00:00:00'
    const to   = dateTo   + 'T23:59:59'

    if (tab === 0) {
      const { data } = await supabase.from('sales')
        .select('*, customers(name)')
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false })
      setSales(data || [])
    }
    if (tab === 1) {
      const { data } = await supabase.from('purchase_orders')
        .select('*, suppliers(name)')
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false })
      setPOs(data || [])
    }
    setLoading(false)
  }

  async function openSaleDetail(sale) {
    const { data } = await supabase.from('sales')
      .select('*, customers(*), sale_items(*)')
      .eq('id', sale.id).single()
    setDetail({ type: 'sale', data })
  }

  async function openPODetail(po) {
    const { data } = await supabase.from('purchase_orders')
      .select('*, suppliers(*), po_items(*)')
      .eq('id', po.id).single()
    setDetail({ type: 'po', data })
  }

  async function voidSale(id) {
    if (!confirm('ยกเลิกบิลนี้? สต็อกจะถูกคืนอัตโนมัติ')) return
    try {
      // โหลด sale_items ก่อน (อาจมีใน detail แล้ว)
      const items = detail?.data?.sale_items
        ?? (await supabase.from('sale_items').select('*').eq('sale_id', id)).data ?? []

      // void ก่อน
      const { error } = await supabase.from('sales').update({ status: 'voided' }).eq('id', id)
      if (error) throw error

      // คืนสต็อกทีละชิ้น (increment stock)
      for (const item of items) {
        if (!item.product_id) continue
        await supabase.rpc('increment_stock', { p_id: item.product_id, qty: Number(item.qty) })
      }

      setDetail(null)
      loadData()
      alert('ยกเลิกบิลและคืนสต็อกเรียบร้อย')
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    }
  }

  function printDetail() {
    if (!detail) return
    const win = window.open('', '_blank', 'width=640,height=800')
    if (!win) return
    win.document.write(detail.type === 'sale'
      ? buildFullReceiptHTML(detail.data, settings)
      : buildFullPOHTML(detail.data, settings))
    win.document.close()
    setTimeout(() => win.print(), 400)
  }

  const filteredSales = sales.filter(s => !search || s.receipt_no.includes(search) || s.customers?.name?.includes(search))
  const filteredPOs   = pos.filter(p => !search || p.po_no.includes(search) || p.suppliers?.name?.includes(search))

  return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <h1 className="font-heading font-bold text-xl text-brand mb-4">🧾 เอกสาร</h1>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 overflow-x-auto scroll-hidden">
        {TABS.map((t, i) => (
          <button key={i} onClick={() => { setTab(i); setDetail(null) }}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium border transition-colors
              ${tab === i ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200'}`}>{t}</button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาเลขที่ / ชื่อ"
          className="flex-1 min-w-[140px] border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-brand outline-none" />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-brand outline-none" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-brand outline-none" />
        <button onClick={() => { setDateFrom(todayISO()); setDateTo(todayISO()) }}
          className="text-xs text-brand underline px-2">วันนี้</button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* List */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {loading && <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>}

          {/* Sales list */}
          {tab === 0 && !loading && (
            <div className="divide-y divide-gray-50">
              {filteredSales.map(s => (
                <div key={s.id} onClick={() => openSaleDetail(s)}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-sm text-gray-800">{s.receipt_no}</p>
                    <p className="text-xs text-gray-400">{fmtDT(s.created_at)} · {PAY_LABEL[s.payment_method]||s.payment_method}</p>
                    {s.status === 'voided' && <span className="text-[9px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">ยกเลิก</span>}
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold text-sm ${s.status==='voided' ? 'line-through text-gray-400' : 'text-brand'}`}>฿{fmt(s.total)}</p>
                    <p className="text-[10px] text-gray-400">→</p>
                  </div>
                </div>
              ))}
              {filteredSales.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">ไม่มีรายการ</div>}
            </div>
          )}

          {/* PO list */}
          {tab === 1 && !loading && (
            <div className="divide-y divide-gray-50">
              {filteredPOs.map(p => (
                <div key={p.id} onClick={() => openPODetail(p)}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-sm text-gray-800">{p.po_no}</p>
                    <p className="text-xs text-gray-400">{p.suppliers?.name || '—'} · {fmtDT(p.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-brand">฿{fmt(p.total)}</p>
                  </div>
                </div>
              ))}
              {filteredPOs.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">ไม่มีรายการ</div>}
            </div>
          )}

          {(tab === 2 || tab === 3) && (
            <div className="text-center py-12 text-gray-400 text-sm">
              <p className="text-3xl mb-2">{tab === 2 ? '📥' : '📤'}</p>
              <p>{tab === 2 ? 'ลูกหนี้ (AR)' : 'เจ้าหนี้ (AP)'}</p>
              <p className="text-xs mt-1">เปิดจากบิลขายที่มีการจ่ายแบบ "เชื่อ"</p>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {!detail && <div className="flex items-center justify-center h-full min-h-48 text-gray-300 text-sm">← กดเลือกรายการ</div>}
          {detail?.type === 'sale' && <SaleDetail d={detail.data} onVoid={() => voidSale(detail.data.id)} onPrint={printDetail} />}
          {detail?.type === 'po' && <PODetail d={detail.data} onPrint={printDetail} />}
        </div>
      </div>
    </div>
  )
}

function SaleDetail({ d, onVoid, onPrint }) {
  return (
    <div>
      <div className="bg-brand text-white px-4 py-3 flex justify-between items-center">
        <div>
          <h2 className="font-bold text-sm">{d.receipt_no}</h2>
          <p className="text-[10px] opacity-70">{fmtDT(d.created_at)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onPrint} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-medium">🖨️ พิมพ์</button>
          {d.status !== 'voided' && <button onClick={onVoid} className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs">ยกเลิก</button>}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {(d.sale_items || []).map(i => (
          <div key={i.id} className="flex justify-between text-sm">
            <span className="flex-1 text-gray-700">{i.product_name} × {i.qty}</span>
            <span className="text-gray-600">฿{fmt(i.subtotal)}</span>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-2 space-y-1">
          <Row label="รวม" val={`฿${fmt(d.subtotal)}`} />
          {d.discount > 0 && <Row label="ส่วนลด" val={`-฿${fmt(d.discount)}`} cls="text-red-500" />}
          {d.vat > 0 && <Row label="VAT" val={`฿${fmt(d.vat)}`} cls="text-gray-400" />}
          <Row label="สุทธิ" val={`฿${fmt(d.total)}`} bold />
          <Row label="วิธีชำระ" val={PAY_LABEL[d.payment_method]||d.payment_method} />
          {d.change_amount > 0 && <Row label="เงินทอน" val={`฿${fmt(d.change_amount)}`} />}
        </div>
        {d.note && <p className="text-xs text-gray-400 italic">หมายเหตุ: {d.note}</p>}
      </div>
    </div>
  )
}

function PODetail({ d, onPrint }) {
  return (
    <div>
      <div className="bg-blue-700 text-white px-4 py-3 flex justify-between items-center">
        <div>
          <h2 className="font-bold text-sm">{d.po_no}</h2>
          <p className="text-[10px] opacity-70">{d.suppliers?.name || '—'}</p>
        </div>
        <button onClick={onPrint} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs">🖨️ พิมพ์</button>
      </div>
      <div className="p-4 space-y-2">
        {(d.po_items || []).map(i => (
          <div key={i.id} className="flex justify-between text-sm">
            <span className="flex-1 text-gray-700">{i.product_name} × {i.qty}</span>
            <span className="text-gray-600">฿{fmt(i.subtotal)}</span>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-2">
          <Row label="รวมทั้งหมด" val={`฿${fmt(d.total)}`} bold />
        </div>
      </div>
    </div>
  )
}

function Row({ label, val, bold, cls='' }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold text-brand text-base' : 'text-gray-600'} ${cls}`}>
      <span>{label}</span><span>{val}</span>
    </div>
  )
}

function buildFullReceiptHTML(d, s) {
  const rows = (d.sale_items || []).map(i => `
    <tr><td>${i.product_name}</td><td style="text-align:center">${i.qty}</td><td style="text-align:right">฿${fmt(i.price)}</td><td style="text-align:right">฿${fmt(i.subtotal)}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>body{font-family:'Sarabun',sans-serif;font-size:12px;max-width:21cm;margin:auto;padding:15mm}
  h2{font-size:18px;text-align:center}table{width:100%;border-collapse:collapse;margin:10px 0}
  th{background:#1a4731;color:white;padding:6px}td{padding:5px 8px;border-bottom:1px solid #eee}
  .total{font-weight:bold;font-size:14px}.right{text-align:right}
  @media print{body{margin:5mm;padding:5mm}}</style></head><body>
  <h2>${s.shop_name || 'ร้านค้า'}</h2>
  <p style="text-align:center">${s.shop_address || ''} ${s.shop_phone ? '| โทร: '+s.shop_phone : ''}</p>
  <hr>
  <table><tr><td><b>เลขที่บิล:</b> ${d.receipt_no}</td><td class="right"><b>วันที่:</b> ${fmtDT(d.created_at)}</td></tr>
  ${d.customers?.name ? `<tr><td colspan="2"><b>ลูกค้า:</b> ${d.customers.name}</td></tr>` : ''}</table>
  <table><thead><tr><th>สินค้า</th><th>จำนวน</th><th>ราคา</th><th>รวม</th></tr></thead><tbody>${rows}</tbody></table>
  <table style="width:50%;margin-left:auto">
    <tr><td>รวม</td><td class="right">฿${fmt(d.subtotal)}</td></tr>
    ${d.discount>0?`<tr><td>ส่วนลด</td><td class="right">-฿${fmt(d.discount)}</td></tr>`:''}
    ${d.vat>0?`<tr><td>VAT</td><td class="right">฿${fmt(d.vat)}</td></tr>`:''}
    <tr class="total"><td>สุทธิ</td><td class="right">฿${fmt(d.total)}</td></tr>
  </table>
  <script>window.onload=()=>window.print()</script></body></html>`
}

function buildFullPOHTML(d, s) {
  const rows = (d.po_items || []).map(i => `
    <tr><td>${i.product_name}</td><td style="text-align:center">${i.qty} ${i.unit||''}</td><td style="text-align:right">฿${fmt(i.cost)}</td><td style="text-align:right">฿${fmt(i.subtotal)}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>body{font-family:'Sarabun',sans-serif;font-size:12px;max-width:21cm;margin:auto;padding:15mm}
  h2{font-size:18px}table{width:100%;border-collapse:collapse;margin:10px 0}
  th{background:#1e4a8a;color:white;padding:6px}td{padding:5px 8px;border-bottom:1px solid #eee}
  .total{font-weight:bold;font-size:14px}.right{text-align:right}
  @media print{body{margin:5mm;padding:5mm}}</style></head><body>
  <h2>ใบสั่งซื้อ (Purchase Order)</h2>
  <p>${s.shop_name || ''} ${s.shop_address ? '| '+s.shop_address : ''}</p>
  <hr>
  <table><tr><td><b>เลขที่ PO:</b> ${d.po_no}</td><td class="right"><b>วันที่:</b> ${fmtDT(d.created_at)}</td></tr>
  <tr><td><b>ซัพพลายเออร์:</b> ${d.suppliers?.name||'—'}</td><td class="right"><b>สถานะ:</b> ${d.status}</td></tr></table>
  <table><thead><tr><th>สินค้า</th><th>จำนวน</th><th>ราคาทุน</th><th>รวม</th></tr></thead><tbody>${rows}</tbody></table>
  <table style="width:50%;margin-left:auto">
    <tr class="total"><td>รวมทั้งหมด</td><td class="right">฿${fmt(d.total)}</td></tr>
  </table>
  <div style="margin-top:30mm;display:flex;justify-content:space-between;text-align:center">
    <div><hr style="width:120px"><p>ผู้สั่งซื้อ</p></div>
    <div><hr style="width:120px"><p>ผู้อนุมัติ</p></div>
    <div><hr style="width:120px"><p>ผู้รับสินค้า</p></div>
  </div>
  <script>window.onload=()=>window.print()</script></body></html>`
}
