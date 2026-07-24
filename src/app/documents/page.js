'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { fmt, fmtDT, todayISO, PAY_LABEL } from '@/lib/utils'
import { buildFormalDocHTML, commitNextDocNo } from '@/lib/docBuilder'
import { buildReceiptESCPOS, buildDeliverySlipESCPOS, buildMapSnapshotESCPOS, printViaBridge } from '@/lib/printBridge'
import { cacheSet, cacheGet } from '@/lib/offlineQueue'
import { getTerminalId, getTerminalName } from '@/lib/deviceConfig'

const TABS = ['ใบเสร็จขาย', 'ใบสั่งซื้อ (PO)', 'ลูกหนี้ AR', 'เจ้าหนี้ AP', 'ใบส่งของ']

export default function DocumentsPage() {
  const auth = useAuth()
  const isAdmin = auth?.role === 'admin'
  const visibleTabs = TABS.filter((_, i) => (i !== 1 && i !== 3) || isAdmin)

  const [tab, setTab]         = useState(0)
  const [sales, setSales]     = useState([])
  const [pos, setPOs]         = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [arQuotes, setArQuotes]   = useState([])   // ใบส่งของ/แจ้งหนี้ รอชำระ
  const [arCredits, setArCredits] = useState([])   // ยอดขายเชื่อ
  const [deliveryHistory, setDeliveryHistory] = useState([]) // ประวัติใบส่งของทั้งหมด
  const [settings, setSettings] = useState({})
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo]   = useState(todayISO())
  const [search, setSearch]   = useState('')
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [printDocType, setPrintDocType] = useState('receipt')
  const [printDate, setPrintDate] = useState(new Date().toISOString().slice(0, 10))
  const [blankDate, setBlankDate] = useState(false)
  const [terminalFilter, setTerminalFilter] = useState('mine') // 'mine' | 'all'
  const thisTerminalId   = typeof window !== 'undefined' ? getTerminalId()   : ''
  const thisTerminalName = typeof window !== 'undefined' ? getTerminalName() : ''

  useEffect(() => { loadData() }, [tab, dateFrom, dateTo, terminalFilter])

  async function loadData() {
    setLoading(true)
    // ── ออฟไลน์: โหลดจาก cache ──
    if (!navigator.onLine) {
      const cached = cacheGet(`docs_tab${tab}`)
      if (tab === 0) setSales(cached || [])
      if (tab === 1) setPOs(cached || [])
      if (tab === 3) setSuppliers(cached || [])
      const cfgCache = cacheGet('settings')
      if (cfgCache) setSettings(cfgCache)
      setLoading(false)
      return
    }
    const { data: cfg } = await supabase.from('settings').select('*')
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))
    const from = dateFrom + 'T00:00:00'
    const to   = dateTo   + 'T23:59:59'
    if (tab === 0) {
      let q = supabase.from('sales')
        .select('*, customers(name)')
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false })
      if (terminalFilter === 'mine' && thisTerminalId) q = q.eq('terminal_id', thisTerminalId)
      const { data } = await q
      setSales(data || [])
      cacheSet('docs_tab0', data || [])
    }
    if (tab === 1) {
      const { data } = await supabase.from('purchase_orders')
        .select('*, suppliers(name)')
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false })
      setPOs(data || [])
      cacheSet('docs_tab1', data || [])
    }
    if (tab === 2) {
      const [{ data: quotes }, { data: credits }] = await Promise.all([
        supabase.from('quotations')
          .select('id,doc_no,doc_type,customer_name,customer_phone,customer_address,total,items,note,created_at')
          .in('doc_type', ['delivery_invoice', 'invoice'])
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        supabase.from('sales')
          .select('id,receipt_no,total,created_at,customer_id,customers(name,phone)')
          .eq('payment_method', 'credit')
          .neq('status', 'voided')
          .order('created_at', { ascending: false }),
      ])
      setArQuotes(quotes || [])
      setArCredits(credits || [])
    }
    if (tab === 4) {
      const { data } = await supabase.from('quotations')
        .select('id,doc_no,doc_type,status,customer_name,customer_phone,customer_address,total,subtotal,discount,delivery_fee,distance_km,map_snapshot_url,items,note,created_at,customer_id')
        .eq('doc_type', 'delivery_invoice')
        .gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: false })
        .limit(200)
      setDeliveryHistory(data || [])
    }
    if (tab === 3) {
      const { data: poAll } = await supabase.from('purchase_orders')
        .select('id,po_no,status,total,created_at,supplier_id,suppliers(id,name,code,phone,address,tax_id)')
        .order('created_at', { ascending: false })
      const map = new Map()
      for (const po of (poAll || [])) {
        const sid = po.supplier_id ?? '__none__'
        if (!map.has(sid)) map.set(sid, { supplier: po.suppliers || null, pos: [] })
        map.get(sid).pos.push(po)
      }
      const suppliers = [...map.values()]
      setSuppliers(suppliers)
      cacheSet('docs_tab3', suppliers)
    }
    setLoading(false)
  }

  async function openSaleDetail(sale) {
    const { data: saleData } = await supabase.from('sales').select('*').eq('id', sale.id).single()
    const [{ data: items }, { data: customers }] = await Promise.all([
      supabase.from('sale_items').select('*').eq('sale_id', sale.id).order('id'),
      saleData?.customer_id
        ? supabase.from('customers').select('*').eq('id', saleData.customer_id).single()
        : Promise.resolve({ data: null }),
    ])
    setDetail({ type: 'sale', data: { ...(saleData || {}), sale_items: items || [], customers: customers || null } })
  }

  async function openPODetail(po) {
    const { data } = await supabase.from('purchase_orders')
      .select('*, suppliers(*), po_items(*)')
      .eq('id', po.id).single()
    setDetail({ type: 'po', data })
  }

  function openSupplierGroup(group) {
    setDetail({ type: 'supplier', data: group })
  }

  async function voidSale(id) {
    if (!confirm('ยกเลิกบิลนี้? สต็อกจะถูกคืนอัตโนมัติ')) return
    try {
      const items = detail?.data?.sale_items
        ?? (await supabase.from('sale_items').select('*').eq('sale_id', id)).data ?? []
      const { error } = await supabase.from('sales').update({ status: 'voided' }).eq('id', id)
      if (error) throw error
      for (const item of items) {
        if (!item.product_id) continue
        try {
          const { error: rpcErr } = await supabase.rpc('adjust_stock', {
            p_product_id: item.product_id, p_qty_change: Number(item.qty),
            p_type: 'void', p_ref_id: id,
          })
          if (rpcErr) throw rpcErr
        } catch {
          const { data: pd } = await supabase.from('products').select('stock').eq('id', item.product_id).single()
          await supabase.from('products').update({ stock: (pd?.stock || 0) + Number(item.qty) }).eq('id', item.product_id)
        }
      }
      setDetail(null)
      loadData()
      alert('ยกเลิกบิลและคืนสต็อกเรียบร้อย')
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    }
  }

  async function printDetail(docType) {
    if (!detail) return
    let html
    if (detail.type === 'sale') {
      const d = detail.data
      const items = (d.sale_items || []).map(i => ({
        name: i.product_name, qty: i.qty, unit: i.unit,
        price: i.price, disc: i.discount || 0, subtotal: i.subtotal, note: i.note,
      }))
      const totals = { subtotal: d.subtotal, discount: d.discount, vat: d.vat || 0, total: d.total }
      const customer = d.customers ? {
        name: d.customers.name, address: d.customers.address,
        phone: d.customers.phone, tax_id: d.customers.tax_id,
        contact: d.customers.contact,
      } : {}
      const pmMap = { cash: 'เงินสด', transfer: 'โอน', credit: 'เครดิต' }
      const useDocType = docType || printDocType
      const docNo = useDocType === 'receipt'
        ? d.receipt_no
        : await commitNextDocNo(useDocType)
      html = buildFormalDocHTML(
        useDocType, items, totals, customer, settings,
        { doc_no: docNo, date: blankDate ? '' : printDate, blank_date: blankDate, payment_method: pmMap[d.payment_method] || d.payment_method, note: d.note }
      )
    } else {
      html = buildFullPOHTML(detail.data, settings)
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const win  = window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    if (!win) alert('กรุณาอนุญาต Popup ใน Safari Settings')
  }

  const filteredSales = sales.filter(s => !search || s.receipt_no.includes(search) || s.customers?.name?.includes(search))
  const filteredPOs   = pos.filter(p => !search || p.po_no.includes(search) || p.suppliers?.name?.includes(search))

  return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <h1 className="font-heading font-bold text-xl text-brand mb-4">🧾 เอกสาร</h1>

      <div className="flex gap-1 mb-4 overflow-x-auto scroll-hidden">
        {visibleTabs.map((t) => {
          const i = TABS.indexOf(t)
          return (
            <button key={i} onClick={() => { setTab(i); setDetail(null) }}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium border transition-colors
                ${tab === i ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200'}`}>{t}</button>
          )
        })}
      </div>

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

      {tab === 0 && thisTerminalId && (
        <div className="flex gap-2 mb-3">
          <button onClick={() => setTerminalFilter('mine')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all
              ${terminalFilter === 'mine' ? 'bg-brand text-white border-brand' : 'bg-white text-slate-500 border-slate-200'}`}>
            💻 {thisTerminalName || 'เครื่องนี้'}
          </button>
          <button onClick={() => setTerminalFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all
              ${terminalFilter === 'all' ? 'bg-brand text-white border-brand' : 'bg-white text-slate-500 border-slate-200'}`}>
            🏪 ทุกเครื่อง
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {loading && <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>}

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

          {tab === 2 && !loading && (
            <div className="divide-y divide-gray-50">
              {/* ใบส่งของ/แจ้งหนี้ รอชำระ */}
              {arQuotes.filter(q => !search || q.doc_no.includes(search) || (q.customer_name||'').includes(search)).map(q => (
                <div key={q.id} onClick={() => setDetail({ type: 'ar_quote', data: q })}
                  className={`px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center ${detail?.data?.id === q.id ? 'bg-blue-50' : ''}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm text-gray-800">{q.doc_no}</p>
                      <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold">ส่งของ</span>
                    </div>
                    <p className="text-xs text-gray-400">{q.customer_name || '—'}{q.customer_phone ? ` · ${q.customer_phone}` : ''}</p>
                    <p className="text-xs text-gray-400">{fmtDT(q.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-blue-600">฿{fmt(q.total)}</p>
                    <span className="text-[10px] text-amber-500 font-semibold">รอชำระ</span>
                  </div>
                </div>
              ))}
              {/* ยอดขายเชื่อ */}
              {arCredits.filter(s => !search || s.receipt_no.includes(search) || (s.customers?.name||'').includes(search)).map(s => (
                <div key={s.id} onClick={() => setDetail({ type: 'ar_credit', data: s })}
                  className={`px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center ${detail?.data?.id === s.id ? 'bg-amber-50' : ''}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm text-gray-800">{s.receipt_no}</p>
                      <span className="text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-semibold">เชื่อ</span>
                    </div>
                    <p className="text-xs text-gray-400">{s.customers?.name || '—'}{s.customers?.phone ? ` · ${s.customers.phone}` : ''}</p>
                    <p className="text-xs text-gray-400">{fmtDT(s.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-amber-600">฿{fmt(s.total)}</p>
                    <span className="text-[10px] text-amber-500 font-semibold">เชื่อ</span>
                  </div>
                </div>
              ))}
              {arQuotes.length === 0 && arCredits.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">ไม่มีลูกหนี้ค้างชำระ 🎉</div>
              )}
            </div>
          )}

          {tab === 3 && !loading && (
            <div className="divide-y divide-gray-50">
              {suppliers.filter(g => !search ||
                (g.supplier?.name||'ไม่ระบุ').includes(search) ||
                g.pos.some(p => p.po_no.includes(search))
              ).map((g, idx) => {
                const name = g.supplier?.name || 'ไม่ระบุเจ้าหนี้'
                const total = g.pos.reduce((s, p) => s + Number(p.total||0), 0)
                const isActive = detail?.type === 'supplier' && detail?.data === g
                return (
                  <div key={g.supplier?.id ?? '__none__'} onClick={() => openSupplierGroup(g)}
                    className={`px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center ${isActive ? 'bg-brand-50' : ''}`}>
                    <div>
                      <p className="font-medium text-sm text-gray-800">{name}</p>
                      <p className="text-xs text-gray-400">{g.pos.length} รายการ</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-sm text-brand">฿{fmt(total)}</p>
                      <span className="text-gray-300 text-xs">→</span>
                    </div>
                  </div>
                )
              })}
              {suppliers.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">ไม่มี PO ในระบบ</div>}
            </div>
          )}

          {tab === 4 && !loading && (
            <div className="divide-y divide-gray-50">
              {deliveryHistory
                .filter(q => !search || q.doc_no.includes(search) || (q.customer_name||'').includes(search))
                .map(q => {
                  const isCancelled = q.status === 'cancelled'
                  const isPaid = q.status === 'paid'
                  return (
                  <div key={q.id} onClick={() => setDetail({ type: 'delivery_hist', data: q })}
                    className={`px-4 py-3 cursor-pointer active:bg-gray-50 flex justify-between items-center ${
                      detail?.data?.id === q.id ? 'bg-blue-50' : ''} ${isCancelled ? 'opacity-50' : ''}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`font-medium text-sm ${isCancelled ? 'line-through text-gray-400' : 'text-gray-800'}`}>{q.doc_no}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          isPaid ? 'bg-green-100 text-green-600'
                          : isCancelled ? 'bg-gray-100 text-gray-400'
                          : 'bg-amber-100 text-amber-600'
                        }`}>{isPaid ? 'สำเร็จ' : isCancelled ? 'ยกเลิก' : 'ค้างจ่าย'}</span>
                      </div>
                      <p className="text-xs text-gray-500">{q.customer_name || '—'}{q.customer_phone ? ` · ${q.customer_phone}` : ''}</p>
                      {q.customer_address && <p className="text-xs text-gray-400">📍 {q.customer_address}</p>}
                      <p className="text-xs text-gray-400">{fmtDT(q.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold text-sm ${isCancelled ? 'text-gray-300 line-through' : 'text-blue-600'}`}>฿{fmt(q.total)}</p>
                    </div>
                  </div>
                )}
              )}
              {deliveryHistory.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">ไม่มีใบส่งของในช่วงนี้</div>}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {!detail && <div className="flex items-center justify-center h-full min-h-48 text-gray-300 text-sm">← กดเลือกรายการ</div>}
          {detail?.type === 'sale' && (
            <SaleDetail
              d={detail.data}
              settings={settings}
              docType={printDocType}
              docDate={printDate}
              blankDate={blankDate}
              onDocTypeChange={setPrintDocType}
              onDocDateChange={setPrintDate}
              onBlankDateChange={setBlankDate}
              onVoid={() => voidSale(detail.data.id)}
              onPrint={() => printDetail(printDocType)}
              onEdit={() => setShowEdit(true)}
            />
          )}
          {detail?.type === 'po' && <PODetail d={detail.data} onPrint={printDetail} />}
          {detail?.type === 'supplier' && <SupplierAPDetail d={detail.data} />}
          {detail?.type === 'ar_quote' && (
            <ARQuoteDetail d={detail.data} settings={settings}
              onCancelled={() => { setDetail(null); loadData() }} />
          )}
          {detail?.type === 'ar_credit' && (
            <ARCreditDetail d={detail.data} />
          )}
          {detail?.type === 'delivery_hist' && (
            <ARQuoteDetail d={detail.data} settings={settings}
              onCancelled={() => { setDetail(null); loadData() }} />
          )}
        </div>
      </div>

      {/* Edit Bill Modal */}
      {showEdit && detail?.type === 'sale' && (
        <EditBillModal
          sale={detail.data}
          settings={settings}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false)
            await openSaleDetail({ id: detail.data.id })
            loadData()
          }}
        />
      )}
    </div>
  )
}

const DOC_OPTS = [
  { value: 'receipt',          label: '🧾 ใบเสร็จ' },
  { value: 'delivery_invoice', label: '📦 ใบส่งของ/ใบแจ้งหนี้' },
  { value: 'quotation',        label: '📝 ใบเสนอราคา' },
]

async function printReceiptSmall(d, settings) {
  try {
    const cfg = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
    const r = {
      shopName: settings.shop_name || 'ร้านค้า',
      shopAddress: settings.shop_address || '',
      shopPhone: settings.shop_phone || '',
      items: (d.sale_items || []).map(i => ({
        name: i.product_name, qty: Number(i.qty), price: Number(i.price),
        disc: Number(i.discount) || 0, note: i.note || '',
      })),
      subtotal: Number(d.subtotal), discount: Number(d.discount) || 0,
      vat: Number(d.vat) || 0, vatRate: 0, total: Number(d.total),
      payment_method: d.payment_method, payment_amount: Number(d.payment_amount) || 0,
      change: Number(d.change_amount) || 0,
      receipt_no: d.receipt_no, created_at: d.created_at,
      customerName: d.customers?.name || '', customerPhone: d.customers?.phone || '',
    }
    if (cfg.ip) {
      const bytes = await buildReceiptESCPOS(r, cfg.paper_mm || 80)
      await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
    } else {
      const blob = new Blob([buildDocReceiptHTML(r)], { type: 'text/html;charset=utf-8' })
      window.open(URL.createObjectURL(blob))
    }
  } catch (e) { alert('พิมไม่สำเร็จ: ' + e.message) }
}

// ── ลูกหนี้: ใบส่งของ/แจ้งหนี้ รอชำระ ────────────────────────────────────────
function ARQuoteDetail({ d, settings, onCancelled }) {
  const [cancelling, setCancelling] = useState(false)

  async function cancelQuote() {
    if (!confirm(`ยกเลิกใบ ${d.doc_no}?`)) return
    setCancelling(true)
    await supabase.from('quotations').update({ status: 'cancelled' }).eq('id', d.id)
    setCancelling(false)
    onCancelled()
  }

  async function reprint() {
    const cfg = JSON.parse(settings.printer_receipt || localStorage.getItem('printer_receipt') || '{}')
    if (!cfg.ip) return alert('ไม่ได้ตั้งค่าเครื่องพิมพ์')
    const paperW = parseInt(cfg.paper_width) || 80
    const slipBytes = await buildDeliverySlipESCPOS({
      doc_no: d.doc_no,
      shopName: settings.shop_name, shopAddress: settings.shop_address,
      shopPhone: settings.shop_phone,
      customer_name: d.customer_name, customer_phone: d.customer_phone,
      customer_address: d.customer_address,
      items: d.items || [], subtotal: d.subtotal || d.total, discount: d.discount || 0,
      delivery_fee: d.delivery_fee || 0, total: d.total,
      note: d.note, created_at: d.created_at,
    }, paperW)
    if (d.map_snapshot_url) {
      const mapDetails = {
        customer_name: d.customer_name, customer_phone: d.customer_phone,
        customer_address: d.customer_address,
        delivery_fee: d.delivery_fee, distance_km: d.distance_km,
      }
      const mapBytes = await buildMapSnapshotESCPOS(d.map_snapshot_url, paperW, mapDetails).catch(() => null)
      if (mapBytes) {
        // slip (2 ใบ + cut) → แผนที่ (header + ภาพ + cut) ส่งเป็น job เดียว
        const combined = new Uint8Array(slipBytes.length + mapBytes.length)
        combined.set(slipBytes, 0); combined.set(mapBytes, slipBytes.length)
        await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, combined)
          .catch(e => { alert('พิมไม่สำเร็จ: ' + e.message) })
        return
      }
    }
    await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, slipBytes)
      .catch(e => { alert('พิมไม่สำเร็จ: ' + e.message) })
  }

  const isCancelled = d.status === 'cancelled'

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-bold text-base text-blue-700">{d.doc_no}</p>
          <p className="text-xs text-gray-400">ใบส่งของ/แจ้งหนี้ · {fmtDT(d.created_at)}</p>
          {isCancelled && <span className="text-xs font-semibold text-red-400">ยกเลิกแล้ว</span>}
        </div>
        <span className={`font-bold text-lg ${isCancelled ? 'text-gray-300 line-through' : 'text-blue-700'}`}>฿{fmt(d.total)}</span>
      </div>
      <div className="bg-blue-50 rounded-xl p-3 text-sm space-y-1">
        <p className="font-semibold">{d.customer_name || '—'}</p>
        {d.customer_phone && <p className="text-xs text-gray-500">📞 {d.customer_phone}</p>}
        {d.customer_address && <p className="text-xs text-gray-500">📍 {d.customer_address}</p>}
        {d.distance_km && <p className="text-xs text-blue-500">🛣️ {Number(d.distance_km).toFixed(1)} กม. · ค่าส่ง ฿{fmt(d.delivery_fee || 0)}</p>}
      </div>
      {d.map_snapshot_url && (
        <div className="rounded-xl overflow-hidden border border-blue-100">
          <img src={d.map_snapshot_url} alt="แผนที่" className="w-full object-cover max-h-48" />
          <p className="text-[10px] text-center text-gray-400 py-1">แผนที่ตำแหน่งจัดส่ง</p>
        </div>
      )}
      <div className="divide-y divide-gray-50">
        {(d.items || []).map((i, idx) => (
          <div key={idx} className="flex justify-between py-2 text-sm">
            <span>{i.name} ×{i.qty}</span>
            <span className="font-medium">฿{fmt(i.subtotal)}</span>
          </div>
        ))}
      </div>
      {d.note && <p className="text-xs text-gray-400 italic">หมายเหตุ: {d.note}</p>}
      <div className={`gap-2 pt-1 ${isCancelled ? 'flex' : 'grid grid-cols-2'}`}>
        <button onClick={reprint}
          className="flex-1 py-2 rounded-xl border border-blue-200 text-blue-600 text-sm font-semibold active:bg-blue-50">
          🖨️ พิมซ้ำ
        </button>
        {!isCancelled && (
          <button onClick={cancelQuote} disabled={cancelling}
            className="py-2 rounded-xl border border-red-200 text-red-500 text-sm font-semibold active:bg-red-50 disabled:opacity-50">
            ยกเลิกใบ
          </button>
        )}
      </div>
      {!isCancelled && <p className="text-xs text-center text-gray-400">หากลูกค้าจ่ายแล้ว → เปิด POS กด "รอชำระ" แล้วเลือกใบนี้</p>}
    </div>
  )
}

// ── ลูกหนี้: ยอดขายเชื่อ ───────────────────────────────────────────────────
function ARCreditDetail({ d }) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-bold text-base text-amber-600">{d.receipt_no}</p>
          <p className="text-xs text-gray-400">ขายเชื่อ · {fmtDT(d.created_at)}</p>
        </div>
        <span className="font-bold text-amber-600 text-lg">฿{fmt(d.total)}</span>
      </div>
      <div className="bg-amber-50 rounded-xl p-3 text-sm">
        <p className="font-semibold">{d.customers?.name || '—'}</p>
        {d.customers?.phone && <p className="text-xs text-gray-500">📞 {d.customers.phone}</p>}
      </div>
      <p className="text-xs text-center text-gray-400">ขายเชื่อ — ตัดสต็อกแล้ว · เก็บเงินเมื่อไหร่ก็ได้</p>
    </div>
  )
}

function SaleDetail({ d, settings, docType, docDate, blankDate, onDocTypeChange, onDocDateChange, onBlankDateChange, onVoid, onPrint, onEdit }) {
  if (!d) return <div className="p-6 text-center text-gray-400 text-sm">กำลังโหลด...</div>
  return (
    <div>
      <div className="bg-brand text-white px-4 py-3 flex justify-between items-center flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-sm">{d.receipt_no}</h2>
          <p className="text-[10px] opacity-70">{fmtDT(d.created_at)}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => printReceiptSmall(d, settings)} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-medium">🖨️ ใบเสร็จย่อ</button>
          {d.status !== 'voided' && (
            <button onClick={onEdit} className="bg-amber-400 text-white px-3 py-1.5 rounded-lg text-xs font-medium">✏️ แก้ไข</button>
          )}
          {d.status !== 'voided' && <button onClick={onVoid} className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs">ยกเลิก</button>}
        </div>
      </div>
      <div className="px-4 pt-3 pb-1 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-400 mb-1.5">ออกเอกสาร</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {DOC_OPTS.map(o => (
            <button key={o.value} onClick={() => onDocTypeChange(o.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${docType === o.value ? 'bg-brand text-white border-brand' : 'bg-white text-gray-500 border-gray-200'}`}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center mb-1">
          <label className="text-xs text-slate-400 whitespace-nowrap">วันที่</label>
          <input type="date" value={docDate} onChange={e => onDocDateChange(e.target.value)}
            disabled={blankDate}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-brand outline-none disabled:opacity-40" />
        </div>
        <label className="flex items-center gap-1.5 mb-2 cursor-pointer">
          <input type="checkbox" checked={blankDate} onChange={e => onBlankDateChange(e.target.checked)}
            className="w-3.5 h-3.5 accent-brand" />
          <span className="text-xs text-slate-400">ไม่ลงวันที่</span>
        </label>
        <button onClick={onPrint} className="w-full bg-slate-800 text-white py-2 rounded-xl text-xs font-semibold">
          🖨️ พิมพ์ A4
        </button>
      </div>
      <div className="p-4 space-y-2">
        {d.customers?.name && (
          <div className="flex items-center gap-2 bg-brand-50 rounded-xl px-3 py-2 mb-1">
            <span>👤</span>
            <span className="text-sm font-medium text-brand-mid">{d.customers.name}</span>
            {d.customers.phone && <span className="text-xs text-brand">{d.customers.phone}</span>}
          </div>
        )}
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
      <div className="bg-brand-mid text-white px-4 py-3 flex justify-between items-center">
        <div>
          <h2 className="font-bold text-sm">{d.po_no}</h2>
          <p className="text-[10px] opacity-70">{d.suppliers?.name || '—'}</p>
        </div>
        <button onClick={onPrint} className="bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs">📄 A4 / AirPrint</button>
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

const PO_STATUS = { draft:'ร่าง', ordered:'สั่งแล้ว', received:'รับแล้ว', cancelled:'ยกเลิก' }
const PO_STATUS_CLS = { draft:'bg-gray-100 text-gray-500', ordered:'bg-blue-50 text-blue-600', received:'bg-green-100 text-green-700', cancelled:'bg-red-100 text-red-500' }

function SupplierAPDetail({ d }) {
  const { supplier, pos: poList } = d
  const name = supplier?.name || 'ไม่ระบุเจ้าหนี้'
  const totalPaid    = poList.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.total||0), 0)
  const totalPending = poList.filter(p => p.status === 'ordered' ).reduce((s, p) => s + Number(p.total||0), 0)
  return (
    <div>
      <div className="bg-brand-mid text-white px-4 py-3">
        <p className="font-bold text-sm">{name}</p>
        <p className="text-[10px] opacity-70">
          {supplier ? [supplier.code, supplier.phone].filter(Boolean).join(' · ') || 'เจ้าหนี้' : 'PO ที่ยังไม่ได้ระบุเจ้าหนี้'}
        </p>
      </div>
      {supplier && (supplier.address || supplier.tax_id) && (
        <div className="px-4 py-2 border-b border-gray-100 text-xs text-gray-500 space-y-0.5">
          {supplier.address && <p>{supplier.address}</p>}
          {supplier.tax_id && <p>เลขภาษี: {supplier.tax_id}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-gray-100">
        <div className="bg-orange-50 rounded-xl p-2 text-center">
          <p className="text-[10px] text-orange-400 mb-0.5">รอรับสินค้า</p>
          <p className="font-bold text-orange-600 text-sm">฿{fmt(totalPending)}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-2 text-center">
          <p className="text-[10px] text-green-500 mb-0.5">รับแล้วทั้งหมด</p>
          <p className="font-bold text-green-700 text-sm">฿{fmt(totalPaid)}</p>
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        {poList.length === 0 && <p className="text-center text-gray-400 text-sm py-6">ยังไม่มี PO</p>}
        {poList.map(p => (
          <div key={p.id} className="flex items-center gap-2 border border-gray-100 rounded-xl px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{p.po_no}</p>
              <p className="text-[10px] text-gray-400">{fmtDT(p.created_at)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-brand">฿{fmt(p.total)}</p>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${PO_STATUS_CLS[p.status]||'bg-gray-100 text-gray-500'}`}>
                {PO_STATUS[p.status]||p.status}
              </span>
            </div>
          </div>
        ))}
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

/* ── Edit Bill Modal ── */
function EditBillModal({ sale, settings, onClose, onSaved }) {
  const [items, setItems]         = useState([])
  const [discount, setDiscount]   = useState(String(sale.discount || 0))
  const [note, setNote]           = useState(sale.note || '')
  const [customer, setCustomer]   = useState(sale.customers || null)
  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState([])
  const [prodSearch, setProdSearch] = useState('')
  const [prodResults, setProdResults] = useState([])
  const [saving, setSaving]       = useState(false)
  const [printing, setPrinting]   = useState(false)

  const [itemsLoading, setItemsLoading] = useState(true)

  useEffect(() => {
    if (!sale?.id) return
    setItemsLoading(true)
    supabase.from('sale_items').select('*').eq('sale_id', sale.id).order('id')
      .then(({ data }) => {
        setItems((data || []).map(i => ({
          id: i.id, pid: i.product_id, name: i.product_name,
          qty: Number(i.qty), price: Number(i.price),
          cost: Number(i.cost) || 0, disc: Number(i.discount) || 0,
          unit: i.unit || '', note: i.note || '',
        })))
        setItemsLoading(false)
      })
  }, [sale?.id])

  useEffect(() => {
    if (!custSearch.trim()) { setCustResults([]); return }
    supabase.from('customers').select('id,name,phone,address,tax_id,credit_limit,balance')
      .ilike('name', '%'+custSearch+'%').limit(6)
      .then(({ data }) => setCustResults(data || []))
  }, [custSearch])

  useEffect(() => {
    if (!prodSearch.trim()) { setProdResults([]); return }
    supabase.from('products').select('id,name,price,cost,unit,barcode')
      .ilike('name', '%'+prodSearch+'%').eq('active', true).limit(8)
      .then(({ data }) => setProdResults(data || []))
  }, [prodSearch])

  function addProduct(p) {
    setItems(prev => {
      const idx = prev.findIndex(i => i.pid === p.id)
      if (idx >= 0) {
        const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n
      }
      return [...prev, { id: null, pid: p.id, name: p.name, qty: 1, price: p.price, cost: p.cost || 0, disc: 0, unit: p.unit }]
    })
    setProdSearch(''); setProdResults([])
  }

  function setQty(idx, qty) {
    const q = parseFloat(qty)
    if (isNaN(q) || q <= 0) { setItems(p => p.filter((_,i) => i !== idx)); return }
    setItems(p => { const n=[...p]; n[idx]={...n[idx],qty:q}; return n })
  }

  function setPrice(idx, price) {
    const v = parseFloat(price); if (isNaN(v)) return
    setItems(p => { const n=[...p]; n[idx]={...n[idx],price:v}; return n })
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty - (i.disc||0), 0)
  const discAmt  = parseFloat(discount) || 0
  const total    = Math.max(0, subtotal - discAmt)

  async function printCurrentReceipt() {
    setPrinting(true)
    try {
      const r = {
        shopName: settings?.shop_name || 'ร้านค้า',
        shopAddress: settings?.shop_address || '',
        shopPhone: settings?.shop_phone || '',
        items: items.map(i => ({ name: i.name, qty: Number(i.qty), price: Number(i.price), disc: Number(i.disc)||0, note: i.note||'' })),
        subtotal, discount: discAmt, vat: 0, vatRate: 0, total,
        payment_method: sale.payment_method, payment_amount: Number(sale.payment_amount)||0,
        change: Number(sale.change_amount)||0,
        receipt_no: sale.receipt_no, created_at: sale.created_at,
        customerName: customer?.name || '', customerPhone: customer?.phone || '',
      }
      const cfg = JSON.parse(localStorage.getItem('printer_receipt') || '{}')
      if (cfg.ip) {
        const bytes = await buildReceiptESCPOS(r, cfg.paper_mm || 80)
        await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
      } else {
        const blob = new Blob([buildDocReceiptHTML(r)], { type: 'text/html;charset=utf-8' })
        window.open(URL.createObjectURL(blob))
      }
    } catch (e) { alert('พิมไม่สำเร็จ: ' + e.message) }
    finally { setPrinting(false) }
  }

  async function printInvoice() {
    setPrinting(true)
    try {
      const docItems = items.map(i => ({
        name: i.name, qty: i.qty, unit: i.unit || '',
        price: i.price, disc: i.disc || 0,
        subtotal: i.price * i.qty - (i.disc || 0),
      }))
      const custObj = customer ? {
        name: customer.name, address: customer.address,
        phone: customer.phone, tax_id: customer.tax_id, contact: customer.contact,
      } : {}
      const docNo = await commitNextDocNo('invoice')
      const html = buildFormalDocHTML('invoice', docItems,
        { subtotal, discount: discAmt, vat: 0, total }, custObj, settings || {},
        { doc_no: docNo, date: new Date().toISOString().slice(0, 10), payment_method: sale.payment_method }
      )
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      window.open(URL.createObjectURL(blob))
    } catch (e) { alert('ออกใบแจ้งหนี้ไม่สำเร็จ: ' + e.message) }
    finally { setPrinting(false) }
  }

  async function save() {
    setSaving(true)
    try {
      if (items.length > 0) {
        await supabase.from('sale_items').delete().eq('sale_id', sale.id)
        await supabase.from('sale_items').insert(
          items.map(i => ({
            sale_id: sale.id, product_id: i.pid, product_name: i.name,
            unit: i.unit, qty: i.qty, price: i.price, cost: i.cost || 0,
            discount: i.disc || 0,
            subtotal: i.price * i.qty - (i.disc || 0),
            note: i.note || null,
          }))
        )
      }
      await supabase.from('sales').update({
        subtotal, discount: discAmt, total,
        note: note.trim() || null,
        customer_id: customer?.id || null,
      }).eq('id', sale.id)
      onSaved()
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-3"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden fade-in flex flex-col max-h-[90vh]">
        <div className="bg-amber-500 text-white px-4 py-3.5 flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-base">✏️ แก้ไขบิล</h2>
            <p className="text-[11px] opacity-80">{sale.receipt_no}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none opacity-70">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Customer */}
          <div className="relative">
            {customer ? (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                <span className="text-lg">👤</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-blue-800 truncate">{customer.name}</p>
                  {customer.phone && <p className="text-xs text-blue-500">{customer.phone}</p>}
                </div>
                <button onClick={() => setCustomer(null)} className="text-blue-300 hover:text-red-400 text-lg leading-none">×</button>
              </div>
            ) : (
              <div className="relative">
                <input value={custSearch} onChange={e => setCustSearch(e.target.value)}
                  placeholder="👤 เพิ่มลูกค้า (ค้นหาชื่อ)..."
                  className="w-full border border-blue-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-400 outline-none bg-blue-50/50" />
                {custResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto mt-1">
                    {custResults.map(c => (
                      <button key={c.id} onClick={() => { setCustomer(c); setCustSearch(''); setCustResults([]) }}
                        className="w-full px-3 py-2 text-left hover:bg-blue-50 flex justify-between text-sm border-b border-gray-50 last:border-0">
                        <span className="font-medium text-slate-700">{c.name}</span>
                        {c.phone && <span className="text-xs text-gray-400">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Add product search */}
          <div className="relative">
            <input value={prodSearch} onChange={e => setProdSearch(e.target.value)}
              placeholder="🔍 ค้นหาสินค้าเพื่อเพิ่ม..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-amber-400 outline-none" />
            {prodResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto mt-1">
                {prodResults.map(p => (
                  <button key={p.id} onClick={() => addProduct(p)}
                    className="w-full px-3 py-2.5 text-left hover:bg-amber-50 flex justify-between text-sm border-b border-gray-50 last:border-0">
                    <span className="font-medium text-slate-700">{p.name}</span>
                    <span className="text-brand font-semibold">฿{fmt(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2">
            {itemsLoading && <p className="text-center text-slate-400 text-sm py-4">กำลังโหลดสินค้า...</p>}
            {items.map((item, idx) => (
              <div key={idx} className="border border-gray-100 rounded-2xl p-3 bg-gray-50/50">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-semibold text-slate-800 flex-1 pr-2">{item.name}</p>
                  <button onClick={() => setItems(p => p.filter((_,i) => i !== idx))}
                    className="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-400 text-sm">✕</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(idx, item.qty - 1)}
                      className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center font-bold text-base leading-none">−</button>
                    <input type="number" value={item.qty} onChange={e => setQty(idx, e.target.value)}
                      className="w-12 text-center border border-gray-200 rounded-lg py-1 text-sm font-bold focus:border-amber-400 outline-none" />
                    <button onClick={() => setQty(idx, item.qty + 1)}
                      className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-white font-bold text-base leading-none">+</button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">ราคา</span>
                    <input type="number" value={item.price} onChange={e => setPrice(idx, e.target.value)}
                      className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm font-semibold text-brand focus:border-amber-400 outline-none" />
                  </div>
                  <span className="text-sm font-bold text-brand ml-auto">฿{fmt(item.price * item.qty - (item.disc||0))}</span>
                </div>
              </div>
            ))}
            {items.length === 0 && <p className="text-center text-slate-400 text-sm py-4">ยังไม่มีสินค้า</p>}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500 whitespace-nowrap">ส่วนลดบิล</span>
              <input type="number" value={discount} onChange={e => setDiscount(e.target.value)}
                placeholder="0"
                className="flex-1 text-right border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 outline-none" />
              <span className="text-xs text-slate-400">บาท</span>
            </div>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="หมายเหตุ"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 outline-none" />
            <div className="bg-amber-50 rounded-2xl p-3 flex justify-between items-baseline border border-amber-100">
              <span className="font-bold text-slate-700">ยอดสุทธิใหม่</span>
              <span className="font-heading font-bold text-2xl text-amber-600">฿{fmt(total)}</span>
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 pt-2 shrink-0 space-y-2">
          <div className="flex gap-2">
            <button onClick={printCurrentReceipt} disabled={printing || items.length === 0}
              className="flex-1 bg-slate-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 active:scale-95">
              🖨️ ใบเสร็จย่อ
            </button>
            {sale.payment_method === 'credit' && (
              <button onClick={printInvoice} disabled={printing || items.length === 0}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 active:scale-95">
                📄 ใบแจ้งหนี้
              </button>
            )}
          </div>
          <button onClick={save} disabled={saving}
            className="w-full bg-amber-500 text-white font-bold py-3.5 rounded-2xl text-base disabled:opacity-50 active:scale-[0.98] transition-transform">
            {saving ? '⏳ กำลังบันทึก...' : '✓ บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  )
}


function buildDocReceiptHTML(r) {
  const PAY = { cash: 'เงินสด', transfer: 'โอน/QR', credit: 'เชื่อ', mixed: 'ผสม' }
  const rows = (r.items || []).map(i => `
    <tr>
      <td style="padding:4px 0;font-size:17px;word-break:break-word">${i.name}${i.note?`<br><span style="font-size:14px;color:#555">${i.note}</span>`:''}</td>
      <td style="text-align:center;font-size:17px;padding:4px 2px">${i.qty}</td>
      <td style="text-align:right;font-size:17px;padding:4px 2px">${Number(i.price).toFixed(2)}</td>
      <td style="text-align:right;font-size:17px;padding:4px 0">${(i.price*i.qty-(i.disc||0)).toFixed(2)}</td>
    </tr>`).join('')
  const dt = new Date(r.created_at||Date.now())
  const dtStr = dt.toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:17px;width:72mm;padding:4px}
  h2{font-size:22px;font-weight:bold;text-align:center;margin-bottom:2px}h3{font-size:18px;text-align:center;margin-bottom:2px}
  .center{text-align:center;font-size:16px}.dash{border:none;border-top:1px dashed #000;margin:5px 0}
  table{width:100%;border-collapse:collapse}.total-row td{font-size:20px;font-weight:bold;padding-top:4px}
  .meta{font-size:16px;display:flex;justify-content:space-between;padding:2px 0}
  @media print{body{margin:0;padding:2px}}</style></head><body>
  <h2>${r.shopName||'ร้านค้า'}</h2><h3>ใบเสร็จรับเงิน</h3>
  ${r.shopAddress?`<p class="center">${r.shopAddress}</p>`:''}${r.shopPhone?`<p class="center">โทร : ${r.shopPhone}</p>`:''}
  <hr class="dash"><div class="meta"><span>รายการ</span><span>จำนวน</span><span>ราคา</span><span>รวม</span></div><hr class="dash">
  <table>${rows}</table><hr class="dash">
  <table>
    <tr><td style="font-size:17px">รวม</td><td style="text-align:right;font-size:17px">${Number(r.subtotal).toFixed(2)}</td></tr>
    ${r.discount>0?`<tr><td style="font-size:17px">ส่วนลด</td><td style="text-align:right;font-size:17px">-${Number(r.discount).toFixed(2)}</td></tr>`:''}
    <tr class="total-row"><td>สุทธิ</td><td style="text-align:right">${Number(r.total).toFixed(2)}</td></tr>
    <tr><td style="font-size:17px">${PAY[r.payment_method]||r.payment_method||''}</td><td style="text-align:right;font-size:17px">${r.payment_amount?Number(r.payment_amount).toFixed(2):''}</td></tr>
    ${r.change>0?`<tr><td style="font-size:17px">เงินทอน</td><td style="text-align:right;font-size:17px">${Number(r.change).toFixed(2)}</td></tr>`:''}
  </table><hr class="dash">
  ${r.customerName?`<div class="meta"><span>ลูกค้า</span><span>${r.customerName}</span></div>`:''}
  <div class="meta"><span>เลขที่</span><span>${r.receipt_no||''}</span></div>
  <div class="meta"><span></span><span style="font-size:15px">** ${dtStr} **</span></div>
  <hr class="dash"><div style="text-align:center;font-size:16px;margin-top:8px">ขอบคุณที่ใช้บริการ</div>
  <script>window.onload=()=>{window.focus();window.print()}</script></body></html>`
}

function buildFullPOHTML(d, s) {
  const rows = (d.po_items || []).map(i => `
    <tr><td>${i.product_name}</td><td style="text-align:center">${i.qty} ${i.unit||''}</td><td style="text-align:right">฿${fmt(i.cost)}</td><td style="text-align:right">฿${fmt(i.subtotal)}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
  @page { size: A4; margin: 15mm; }
  body{font-family:'Kanit',sans-serif;font-size:13px;max-width:21cm;margin:auto}
  h2{font-size:20px}table{width:100%;border-collapse:collapse;margin:10px 0}
  th{background:#1e4a8a;color:white;padding:7px}td{padding:5px 8px;border-bottom:1px solid #eee}
  .total{font-weight:bold;font-size:15px}.right{text-align:right}
  </style></head><body>
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
