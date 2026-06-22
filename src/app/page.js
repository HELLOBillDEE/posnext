'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDate, todayISO } from '@/lib/utils'

/* ── SVG Icons (same as Nav) ── */
const IC = {
  pos: <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>,
  product: <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.82-1h12l.93 1H5.12z"/></svg>,
  po: <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>,
  report: <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"/></svg>,
  doc: <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z"/></svg>,
  employees: <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>,
  warning: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>,
  receipt: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M19.5 3.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5zM19 19.09H5V4.91h14v14.18zM6 15h12v2H6zm0-4h12v2H6zm0-4h12v2H6z"/></svg>,
  trend: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>,
  avg: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z"/></svg>,
  expense: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>,
  cal: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/></svg>,
}

/* Quick link definitions */
const QUICK = [
  { label:'ขาย', href:'/pos',        icon: IC.pos,       grad:'linear-gradient(135deg,#3B5BDB,#4C6EF5)' },
  { label:'สินค้า', href:'/products', icon: IC.product,   grad:'linear-gradient(135deg,#0ea5e9,#38bdf8)' },
  { label:'สั่งซื้อ', href:'/po',     icon: IC.po,        grad:'linear-gradient(135deg,#7c3aed,#a78bfa)' },
  { label:'รายงาน', href:'/reports',  icon: IC.report,    grad:'linear-gradient(135deg,#059669,#34d399)' },
  { label:'เอกสาร', href:'/documents',icon: IC.doc,       grad:'linear-gradient(135deg,#d97706,#fbbf24)' },
  { label:'พนักงาน', href:'/employees',icon: IC.employees, grad:'linear-gradient(135deg,#e11d48,#fb7185)' },
  { label:'ค่าใช้จ่าย', href:'/expenses', icon: IC.expense,   grad:'linear-gradient(135deg,#ea580c,#fb923c)' },
]

export default function Dashboard() {
  const [stats, setStats]         = useState({ revenue:0, orders:0, avg:0 })
  const [recentSales, setRecentSales] = useState([])
  const [lowStock, setLowStock]   = useState([])
  const [settings, setSettings]   = useState({})
  const [dateRange, setDateRange] = useState({ from: todayISO(), to: todayISO() })
  const [loading, setLoading]     = useState(true)
  const [totalExpenses, setTotalExpenses] = useState(0)

  useEffect(() => { loadAll() }, [dateRange])

  async function loadAll() {
    setLoading(true)
    const from = dateRange.from + 'T00:00:00'
    const to   = dateRange.to   + 'T23:59:59'
    const [
      { data: salesData },
      { data: low },
      { data: cfg },
      { data: recent },
      { data: expData },
    ] = await Promise.all([
      supabase.from('sales').select('total,status').gte('created_at', from).lte('created_at', to).eq('status','completed'),
      supabase.from('products').select('id,name,stock,min_stock,unit').filter('stock','lte','min_stock').eq('active',true).order('stock').limit(8),
      supabase.from('settings').select('*'),
      supabase.from('sales').select('id,receipt_no,total,payment_method,created_at,status').gte('created_at', from).lte('created_at', to).order('created_at',{ascending:false}).limit(8),
      supabase.from('expenses').select('amount').gte('expense_date', dateRange.from).lte('expense_date', dateRange.to),
    ])
    const completed = (salesData || []).filter(s => s.status === 'completed')
    const revenue = completed.reduce((s, r) => s + Number(r.total), 0)
    const orders  = completed.length
    setStats({ revenue, orders, avg: orders ? revenue / orders : 0 })
    setRecentSales(recent || [])
    setTotalExpenses((expData || []).reduce((s, e) => s + Number(e.amount), 0))
    setLowStock((low || []).filter(p => p.stock <= p.min_stock))
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))
    setLoading(false)
  }

  const shopName = settings.shop_name || 'ร้านค้า'

  return (
    <div className="max-w-4xl mx-auto px-4 py-5 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-bold text-2xl text-slate-800 leading-tight">{shopName}</h1>
          <p className="text-sm text-slate-400 mt-0.5">ระบบจัดการร้านค้า POS</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 leading-relaxed">
            {new Date().toLocaleDateString('th-TH',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}
          </p>
        </div>
      </div>

      {/* ── Date range ── */}
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-slate-500 font-medium">ช่วงวันที่:</span>
        <input type="date" value={dateRange.from}
          onChange={e => setDateRange(p => ({...p, from:e.target.value}))}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand bg-slate-50 focus:bg-white transition-all" />
        <span className="text-slate-300">—</span>
        <input type="date" value={dateRange.to}
          onChange={e => setDateRange(p => ({...p, to:e.target.value}))}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand bg-slate-50 focus:bg-white transition-all" />
        <button onClick={() => setDateRange({ from:todayISO(), to:todayISO() })}
          className="text-xs font-semibold text-brand px-3 py-1.5 rounded-lg bg-brand/8 hover:bg-brand/15 transition-colors">
          วันนี้
        </button>
        <button onClick={() => {
          const d = new Date(); d.setDate(1)
          setDateRange({ from: d.toISOString().slice(0,10), to: todayISO() })
        }} className="text-xs font-semibold text-brand px-3 py-1.5 rounded-lg bg-brand/8 hover:bg-brand/15 transition-colors">
          เดือนนี้
        </button>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

        {/* Revenue */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">ยอดขายรวม</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-brand"
              style={{ background:'rgba(59,91,219,0.1)' }}>
              {IC.trend}
            </div>
          </div>
          <p className="font-bold text-2xl text-brand leading-none">฿{fmt(stats.revenue)}</p>
          <p className="text-xs text-slate-400 mt-2">{stats.orders} บิล</p>
        </div>

        {/* Avg */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">เฉลี่ย/บิล</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600"
              style={{ background:'rgba(16,185,129,0.1)' }}>
              {IC.avg}
            </div>
          </div>
          <p className="font-bold text-2xl text-emerald-600 leading-none">฿{fmt(stats.avg)}</p>
          <p className="text-xs text-slate-400 mt-2">ต่อรายการ</p>
        </div>

        {/* Low stock */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">สินค้าใกล้หมด</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-500"
              style={{ background:'rgba(245,158,11,0.1)' }}>
              {IC.warning}
            </div>
          </div>
          <p className="font-bold text-2xl text-amber-500 leading-none">{lowStock.length}</p>
          <p className="text-xs text-slate-400 mt-2">รายการ</p>
        </div>

        {/* Date */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">วันที่</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-600"
              style={{ background:'rgba(124,58,237,0.1)' }}>
              {IC.cal}
            </div>
          </div>
          <p className="font-bold text-lg text-violet-600 leading-none">{fmtDate(todayISO())}</p>
          <p className="text-xs text-slate-400 mt-2">ปัจจุบัน</p>
        </div>

        {/* Expenses */}
        <div className="card p-4 col-span-2 md:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">ค่าใช้จ่าย</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-orange-500"
              style={{ background:'rgba(234,88,12,0.1)' }}>
              {IC.expense}
            </div>
          </div>
          <p className="font-bold text-2xl text-orange-500 leading-none">฿{fmt(totalExpenses)}</p>
          <p className="text-xs text-slate-400 mt-2"><Link href="/expenses" className="underline">ดูรายละเอียด →</Link></p>
        </div>
      </div>

      {/* ── Quick Access ── */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3 px-1">เมนูลัด</p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {QUICK.map(q => (
            <Link key={q.href} href={q.href}
              className="card p-3 flex flex-col items-center gap-2.5 active:scale-95 transition-all group hover:shadow-md">
              {/* Icon container */}
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform"
                style={{ background: q.grad, boxShadow: `0 6px 18px ${q.grad.includes('3B5BDB') ? 'rgba(59,91,219,0.35)' : 'rgba(0,0,0,0.15)'}` }}>
                {q.icon}
              </div>
              <span className="text-xs font-semibold text-slate-600">{q.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Bottom: Recent + Low Stock ── */}
      <div className="grid md:grid-cols-2 gap-4">

        {/* Recent sales */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3.5 flex justify-between items-center"
            style={{ borderBottom:'1px solid rgba(59,91,219,0.07)' }}>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 text-brand">{IC.receipt}</div>
              <h2 className="font-semibold text-sm text-slate-700">บิลล่าสุด</h2>
            </div>
            <Link href="/documents" className="text-xs font-semibold text-brand hover:underline">ดูทั้งหมด →</Link>
          </div>
          <div className="divide-y" style={{ '--tw-divide-opacity':1, borderColor:'rgba(0,0,0,0.04)' }}>
            {loading && <div className="p-5 text-center text-slate-400 text-sm">กำลังโหลด...</div>}
            {!loading && recentSales.length === 0 && (
              <div className="p-5 text-center text-slate-400 text-sm">ยังไม่มีรายการ</div>
            )}
            {recentSales.map(s => (
              <div key={s.id} className="px-4 py-2.5 flex justify-between items-center hover:bg-brand/[0.02] transition-colors">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{s.receipt_no}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(s.created_at)}</p>
                </div>
                <span className="font-bold text-brand text-sm">฿{fmt(s.total)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Low stock */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3.5 flex justify-between items-center"
            style={{ borderBottom:'1px solid rgba(59,91,219,0.07)' }}>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 text-amber-500">{IC.warning}</div>
              <h2 className="font-semibold text-sm text-slate-700">สินค้าใกล้หมด</h2>
            </div>
            <Link href="/products" className="text-xs font-semibold text-brand hover:underline">จัดการสินค้า →</Link>
          </div>
          <div>
            {lowStock.length === 0 && (
              <div className="p-5 text-center text-slate-400 text-sm">
                <span className="text-emerald-400 font-semibold">สินค้าเพียงพอ ✓</span>
              </div>
            )}
            {lowStock.map(p => (
              <div key={p.id} className="px-4 py-2.5 flex justify-between items-center hover:bg-amber-50/50 transition-colors"
                style={{ borderBottom:'1px solid rgba(0,0,0,0.04)' }}>
                <p className="text-sm text-slate-700 flex-1 truncate">{p.name}</p>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ml-3 ${
                  p.stock <= 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                }`}>
                  {p.stock} {p.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
