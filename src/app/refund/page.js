'use client'
import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { fmt, fmtDT, PAY_LABEL } from '@/lib/utils'

export default function RefundPage() {
  const auth = useAuth()
  const isAdmin = auth?.role === 'admin'

  const [query, setQuery]       = useState('')
  const [sale, setSale]         = useState(null)
  const [items, setItems]       = useState([])
  const [selected, setSelected] = useState({}) // { [item_id]: qty }
  const [reason, setReason]     = useState('')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [doneMsg, setDoneMsg]   = useState('')
  const [error, setError]       = useState('')
  const [history, setHistory]   = useState([])
  const [showHistory, setShowHistory] = useState(false)

  const searchSale = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true); setSale(null); setItems([]); setSelected({}); setError('')
    const q = query.trim().toUpperCase()
    const { data, error: err } = await supabase.from('sales').select('*')
      .or(`receipt_no.eq.${q},receipt_no.ilike.%${q}%`)
      .eq('status', 'completed').order('created_at', { ascending: false }).limit(5)
    setSearching(false)
    if (err || !data?.length) { setError('ไม่พบใบเสร็จ: ' + q); return }
    const found = data[0]
    const { data: its } = await supabase.from('sale_items').select('*').eq('sale_id', found.id).order('id')
    setSale(found)
    setItems(its || [])
    setSelected(Object.fromEntries((its || []).map(i => [i.id, 0])))
  }, [query])

  const totalRefund = items.reduce((s, i) => {
    const qty = Number(selected[i.id]) || 0
    if (qty <= 0) return s
    const unitPrice = (Number(i.subtotal) + Number(i.discount || 0)) / Number(i.qty)
    return s + unitPrice * qty - (Number(i.discount || 0) / Number(i.qty)) * qty
  }, 0)

  async function confirmRefund() {
    const refundItems = items.filter(i => (Number(selected[i.id]) || 0) > 0).map(i => ({
      ...i, refund_qty: Number(selected[i.id]),
    }))
    if (refundItems.length === 0) { alert('กรุณาเลือกสินค้าที่ต้องการคืน'); return }
    if (!reason.trim()) { alert('กรุณาระบุเหตุผล'); return }

    setSaving(true)
    try {
      const emp = auth?.employee
      const { error: insErr } = await supabase.from('returns').insert({
        sale_id: sale.id,
        receipt_no: sale.receipt_no,
        items: refundItems,
        total_refund: Math.round(totalRefund * 100) / 100,
        reason: reason.trim(),
        refunded_by: emp ? (emp.nickname || emp.name) : 'admin',
      })
      if (insErr) throw insErr

      // คืนสต็อก
      for (const i of refundItems) {
        try {
          await supabase.rpc('adjust_stock', {
            p_product_id: i.product_id, p_qty_change: i.refund_qty,
            p_type: 'return', p_ref_id: sale.id,
          })
        } catch {
          const { data: pd } = await supabase.from('products').select('stock').eq('id', i.product_id).single()
          if (pd) await supabase.from('products').update({ stock: (pd.stock || 0) + i.refund_qty }).eq('id', i.product_id)
        }
      }

      setDoneMsg(`คืนเงินสำเร็จ ฿${fmt(totalRefund)} — ${refundItems.length} รายการ`)
      setSale(null); setItems([]); setSelected({}); setQuery(''); setReason('')
    } catch (e) {
      alert('เกิดข้อผิดพลาด: ' + e.message)
    }
    setSaving(false)
  }

  async function loadHistory() {
    const { data } = await supabase.from('returns').select('*').order('created_at', { ascending: false }).limit(30)
    setHistory(data || [])
    setShowHistory(true)
  }

  if (!isAdmin) return (
    <div className="flex items-center justify-center h-64 text-slate-400">เฉพาะ Admin เท่านั้น</div>
  )

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-heading font-bold text-slate-800">คืนสินค้า / Refund</h1>
        <button onClick={loadHistory} className="text-xs text-slate-400 hover:text-slate-600 underline">ประวัติ</button>
      </div>

      {doneMsg && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-green-700 font-semibold text-sm flex justify-between">
          {doneMsg}
          <button onClick={() => setDoneMsg('')} className="text-green-400 ml-2">×</button>
        </div>
      )}

      {/* ค้นหาใบเสร็จ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <label className="text-xs font-semibold text-slate-500">เลขใบเสร็จ</label>
        <div className="flex gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchSale()}
            placeholder="เช่น R-240801-001"
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
          <button onClick={searchSale} disabled={searching}
            className="bg-brand text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-50">
            {searching ? '...' : 'ค้นหา'}
          </button>
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
      </div>

      {/* รายละเอียดใบเสร็จ */}
      {sale && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-100">
            <div className="flex justify-between">
              <span className="font-bold text-slate-800 text-sm">{sale.receipt_no}</span>
              <span className="text-xs text-slate-400">{fmtDT(sale.created_at)}</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {PAY_LABEL[sale.payment_method] || sale.payment_method} · ฿{fmt(sale.total)}
              {sale.note ? ` · ${sale.note}` : ''}
            </div>
          </div>

          <div className="p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 mb-2">เลือกสินค้าที่คืน (ใส่จำนวน)</p>
            {items.map(i => {
              const selQty = Number(selected[i.id]) || 0
              return (
                <div key={i.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{i.product_name}</p>
                    <p className="text-xs text-slate-400">ซื้อ {i.qty} {i.unit || 'ชิ้น'} · ฿{fmt(Number(i.subtotal) / Number(i.qty))}/ชิ้น</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setSelected(s => ({ ...s, [i.id]: Math.max(0, (Number(s[i.id]) || 0) - 1) }))}
                      className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50">−</button>
                    <span className={`w-8 text-center text-sm font-bold ${selQty > 0 ? 'text-brand' : 'text-slate-300'}`}>{selQty}</span>
                    <button onClick={() => setSelected(s => ({ ...s, [i.id]: Math.min(i.qty, (Number(s[i.id]) || 0) + 1) }))}
                      className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50">+</button>
                  </div>
                </div>
              )
            })}
          </div>

          {totalRefund > 0 && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
              <div className="flex justify-between font-bold text-brand">
                <span>ยอดคืนเงิน</span>
                <span>฿{fmt(totalRefund)}</span>
              </div>
              <input value={reason} onChange={e => setReason(e.target.value)}
                placeholder="เหตุผล (บังคับ) เช่น สินค้าชำรุด"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand outline-none" />
              <button onClick={confirmRefund} disabled={saving}
                className="w-full bg-brand text-white font-bold py-3 rounded-2xl text-sm disabled:opacity-50">
                {saving ? 'กำลังบันทึก...' : `ยืนยันคืนเงิน ฿${fmt(totalRefund)}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ประวัติ */}
      {showHistory && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between">
            <span className="font-bold text-slate-800 text-sm">ประวัติการคืนสินค้า</span>
            <button onClick={() => setShowHistory(false)} className="text-slate-400">×</button>
          </div>
          <div className="divide-y divide-slate-100">
            {history.length === 0 && <p className="text-xs text-slate-400 p-4 text-center">ยังไม่มีประวัติ</p>}
            {history.map(r => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex justify-between">
                  <span className="text-sm font-semibold text-slate-800">{r.receipt_no}</span>
                  <span className="text-xs font-bold text-red-500">−฿{fmt(r.total_refund)}</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {fmtDT(r.created_at)} · {r.refunded_by} · {r.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
