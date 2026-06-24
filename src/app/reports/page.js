'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDate, todayISO, MONTHS_TH, PAY_LABEL } from '@/lib/utils'

export default function ReportsPage() {
  const [tab, setTab]           = useState('daily')
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo]     = useState(todayISO())
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)

  useEffect(() => { loadReport() }, [tab, dateFrom, dateTo])

  async function loadReport() {
    setLoading(true)
    const from = dateFrom + 'T00:00:00'
    const to   = dateTo   + 'T23:59:59'
    try {
      const [{ data: sales }, { data: items }, { data: expenses }] = await Promise.all([
        supabase.from('sales').select('*').gte('created_at', from).lte('created_at', to).eq('status','completed').order('created_at'),
        supabase.from('sale_items').select('*, sales!inner(created_at,status)').gte('sales.created_at', from).lte('sales.created_at', to).eq('sales.status','completed'),
        supabase.from('expenses').select('*').gte('expense_date', dateFrom).lte('expense_date', dateTo),
      ])
      const revenue  = (sales || []).reduce((s, r) => s + Number(r.total), 0)
      const cost     = (items || []).reduce((s, i) => s + Number(i.cost||0) * Number(i.qty), 0)
      const expTotal = (expenses || []).reduce((s, e) => s + Number(e.amount), 0)

      // Payment method breakdown
      const byPay = {}
      ;(sales || []).forEach(s => { byPay[s.payment_method] = (byPay[s.payment_method] || 0) + Number(s.total) })

      // Top products
      const byProd = {}
      ;(items || []).forEach(i => {
        if (!byProd[i.product_name]) byProd[i.product_name] = { qty: 0, revenue: 0, profit: 0 }
        byProd[i.product_name].qty     += Number(i.qty)
        byProd[i.product_name].revenue += Number(i.subtotal)
        byProd[i.product_name].profit  += (Number(i.price) - Number(i.cost||0)) * Number(i.qty)
      })

      // Daily breakdown (when range > 1 day)
      const byDay = {}
      ;(sales || []).forEach(s => {
        const d = s.created_at.slice(0, 10)
        if (!byDay[d]) byDay[d] = { date: d, revenue: 0, orders: 0 }
        byDay[d].revenue += Number(s.total)
        byDay[d].orders  += 1
      })

      setData({
        revenue, cost, profit: revenue - cost - expTotal, expTotal,
        orders: (sales || []).length,
        byPay, byProd, byDay,
        grossProfit: revenue - cost,
        margin: revenue ? ((revenue - cost) / revenue * 100) : 0,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const topProds = data ? Object.entries(data.byProd).sort((a,b) => b[1].revenue - a[1].revenue).slice(0, 10) : []
  const dayList  = data ? Object.values(data.byDay).sort((a,b) => a.date.localeCompare(b.date)) : []

  function printReport() {
    window.print()
  }

  // ─── Export รายงานเงินสดรับ-จ่าย (สรรพากร) ──────────────────────────────
  const [exportMonths, setExportMonths] = useState([])
  const [exporting, setExporting]       = useState(false)

  function toggleMonth(ym) {
    setExportMonths(prev =>
      prev.includes(ym) ? prev.filter(x => x !== ym) : prev.length >= 6 ? prev : [...prev, ym]
    )
  }

  // สร้างรายการ 12 เดือนย้อนหลัง
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    return {
      ym: `${y}-${String(m).padStart(2, '0')}`,
      label: `${MONTHS_TH[m - 1]} ${y + 543}`,
    }
  })

  async function exportCashReport() {
    if (exportMonths.length === 0) return alert('เลือกอย่างน้อย 1 เดือน')
    setExporting(true)
    try {
      const sorted = [...exportMonths].sort()
      const from   = sorted[0] + '-01'
      const lastYM = sorted[sorted.length - 1]
      const lastDay = new Date(lastYM.slice(0,4), parseInt(lastYM.slice(5,7)), 0).getDate()
      const to = lastYM + '-' + String(lastDay).padStart(2, '0')

      const [{ data: sales }, { data: pos }, { data: cfgRows }] = await Promise.all([
        supabase.from('sales').select('id,created_at,total,payment_method,note')
          .gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59')
          .eq('status', 'completed').order('created_at'),
        supabase.from('purchase_orders').select('id,created_at,total,note')
          .gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59')
          .order('created_at'),
        supabase.from('settings').select('key,value'),
      ])

      const cfg = Object.fromEntries((cfgRows || []).map(r => [r.key, r.value]))
      const rows = []

      // header
      const months = sorted.map(ym => {
        const m = parseInt(ym.slice(5, 7))
        return MONTHS_TH[m] + '  ' + (parseInt(ym.slice(0, 4)) + 543)
      }).join(' - ')

      rows.push(['รายงานเงินสดรับ - จ่าย'])
      rows.push([`ประจำเดือน  ${months}`])
      rows.push([])
      rows.push(['ชื่อผู้ประกอบกิจการ', '', cfg.owner_name || '-', '   เลขประจำตัวประชาชน', '',
        ...( (cfg.owner_id || '').split('').slice(0,13) )])
      rows.push([])
      rows.push(['ชื่อสถานประกอบการ', '', cfg.shop_name || '-', '   เลขประจำตัวผู้เสียภาษีอากร', '',
        ...( (cfg.shop_tax_id || '').replace(/-/g,'').split('').slice(0,13) )])
      rows.push([])
      rows.push(['วัน/เดือน/ปี','รายการ','','รายรับ (บาท)','รายจ่าย (บาท)','','','ค่าใช้จ่ายอื่นๆ','','','','','หมายเหตุ','','','','','','คงเหลือ'])
      rows.push(['','','','','ซื้อสินค้า'])

      // merge ทุก transactions แล้ว sort by date
      const allTx = [
        ...(sales||[]).map(s => ({
          date: s.created_at.slice(0,10),
          label: 'รายได้จากการขาย',
          income: Number(s.total),
          buy: 0, other: 0,
          note: s.payment_method === 'cash' ? 'เงินสด' : s.payment_method === 'transfer' ? 'โอนเงิน' : (s.payment_method||''),
        })),
        ...(pos||[]).map(p => ({
          date: p.created_at?.slice(0, 10),
          label: 'ซื้อสินค้า',
          income: 0, buy: Number(p.total), other: 0,
          note: p.note || '',
        })),
      ].sort((a,b) => a.date.localeCompare(b.date))

      for (const tx of allTx) {
        const [y, m, d2] = tx.date.split('-')
        const thDate = `${d2}/${m}/${parseInt(y)+543}`
        rows.push([thDate, tx.label, '', tx.income||'', tx.buy||'', '','', tx.other||'', '','','','', tx.note])
      }

      // total row
      const totalIncome = allTx.reduce((s,t) => s + t.income, 0)
      const totalBuy    = allTx.reduce((s,t) => s + t.buy, 0)
      rows.push(['', 'รวม', '', totalIncome, totalBuy])

      // export xlsx
      const XLSX = await import('xlsx')
      const ws   = XLSX.utils.aoa_to_sheet(rows)
      const wb   = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'รายงานเงินสดรับ-จ่าย')

      // column widths
      ws['!cols'] = [
        {wch:14},{wch:22},{wch:4},{wch:14},{wch:14},{wch:4},{wch:4},{wch:14},
        {wch:4},{wch:4},{wch:4},{wch:4},{wch:18}
      ]

      const fname = `รายงานเงินสดรับ-จ่าย_${sorted[0]}_ถึง_${sorted[sorted.length-1]}.xlsx`
      XLSX.writeFile(wb, fname)
    } catch (e) {
      alert('Export ผิดพลาด: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-3 py-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-heading font-bold text-xl text-brand">📊 รายงานยอดขาย</h1>
        <button onClick={printReport} className="border border-gray-300 text-gray-600 px-3 py-2 rounded-xl text-sm active:bg-gray-100">🖨️ พิมพ์</button>
      </div>

      {/* Date range */}
      <div className="bg-white rounded-2xl border border-gray-200 p-3 mb-4 flex flex-wrap gap-2 items-center shadow-sm">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
        <span className="text-gray-400">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
        {[
          ['วันนี้', () => { const d=todayISO(); setDateFrom(d); setDateTo(d) }],
          ['7 วัน', () => { const d=new Date(); d.setDate(d.getDate()-6); setDateFrom(d.toISOString().slice(0,10)); setDateTo(todayISO()) }],
          ['เดือนนี้', () => { const d=new Date(); d.setDate(1); setDateFrom(d.toISOString().slice(0,10)); setDateTo(todayISO()) }],
        ].map(([l,fn]) => (
          <button key={l} onClick={fn} className="text-xs text-brand underline">{l}</button>
        ))}
      </div>

      {/* Export รายงานเงินสดรับ-จ่าย (สรรพากร) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-semibold text-sm text-gray-700">📄 Export รายงานเงินสดรับ-จ่าย (สรรพากร)</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">เลือกเดือนที่ต้องการ (สูงสุด 6 เดือน) แล้วกด Export เพื่อดาวน์โหลดไฟล์ Excel</p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
          {monthOptions.map(({ ym, label }) => (
            <button key={ym} onClick={() => toggleMonth(ym)}
              className={`px-2 py-1.5 rounded-xl text-xs border transition-colors
                ${exportMonths.includes(ym)
                  ? 'bg-brand text-white border-brand'
                  : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
                }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={exportCashReport} disabled={exporting || exportMonths.length === 0}
            className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 active:bg-emerald-700">
            {exporting ? 'กำลัง Export...' : `⬇️ Export Excel (${exportMonths.length} เดือน)`}
          </button>
          {exportMonths.length > 0 && (
            <button onClick={() => setExportMonths([])} className="text-xs text-gray-400 underline">ล้างการเลือก</button>
          )}
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>}

      {data && !loading && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KPI label="ยอดขายรวม" val={`฿${fmt(data.revenue)}`} sub={`${data.orders} บิล`} color="text-brand" bg="bg-brand-50 border-brand/20" />
            <KPI label="กำไรขั้นต้น" val={`฿${fmt(data.grossProfit)}`} sub={`Margin ${data.margin.toFixed(1)}%`} color="text-emerald-700" bg="bg-emerald-50 border-emerald-200" />
            <KPI label="ค่าใช้จ่าย" val={`฿${fmt(data.expTotal)}`} sub="รายจ่ายรวม" color="text-red-600" bg="bg-red-50 border-red-200" />
            <KPI label="กำไรสุทธิ" val={`฿${fmt(data.profit)}`} sub="หลังหักรายจ่าย" color={data.profit>=0?'text-emerald-700':'text-red-600'} bg={data.profit>=0?'bg-emerald-50 border-emerald-200':'bg-red-50 border-red-200'} />
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {/* Payment breakdown */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-sm text-gray-700">การชำระเงิน</h2>
              </div>
              <div className="p-4 space-y-2">
                {Object.entries(data.byPay).map(([m, amt]) => {
                  const pct = data.revenue ? (amt / data.revenue * 100) : 0
                  return (
                    <div key={m}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{PAY_LABEL[m]||m}</span>
                        <span className="font-semibold text-gray-800">฿{fmt(amt)} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="bg-gray-100 rounded-full h-1.5">
                        <div className="bg-brand rounded-full h-1.5 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
                {Object.keys(data.byPay).length === 0 && <p className="text-gray-400 text-sm text-center py-4">ไม่มีข้อมูล</p>}
              </div>
            </div>

            {/* Top products */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-sm text-gray-700">สินค้าขายดี TOP 10</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {topProds.map(([name, d], i) => (
                  <div key={name} className="px-4 py-2 flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
                      ${i < 3 ? 'bg-gold text-white' : 'bg-gray-100 text-gray-500'}`}>{i+1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                      <p className="text-[10px] text-gray-400">ขาย {d.qty} ชิ้น</p>
                    </div>
                    <span className="text-sm font-semibold text-brand">฿{fmt(d.revenue)}</span>
                  </div>
                ))}
                {topProds.length === 0 && <p className="text-gray-400 text-sm text-center py-4">ไม่มีข้อมูล</p>}
              </div>
            </div>
          </div>

          {/* Daily breakdown */}
          {dayList.length > 1 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-sm text-gray-700">ยอดขายรายวัน</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-4 py-2 font-medium">วันที่</th>
                    <th className="text-center px-3 py-2 font-medium">จำนวนบิล</th>
                    <th className="text-right px-4 py-2 font-medium">ยอดขาย</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {dayList.map(d => (
                      <tr key={d.date} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-700">{fmtDate(d.date)}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{d.orders}</td>
                        <td className="px-4 py-2 text-right font-semibold text-brand">฿{fmt(d.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-brand/5 font-bold">
                      <td className="px-4 py-2 text-brand">รวม</td>
                      <td className="px-3 py-2 text-center text-gray-600">{data.orders}</td>
                      <td className="px-4 py-2 text-right text-brand text-base">฿{fmt(data.revenue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KPI({ label, val, sub, color, bg }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${bg}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`font-heading font-bold text-xl ${color} leading-tight`}>{val}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  )
}
