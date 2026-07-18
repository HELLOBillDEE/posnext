'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { convertThaiBarcode } from '@/lib/utils'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH')

export default function StockCountPage() {
  const [products, setProducts] = useState([])
  const [counts, setCounts]     = useState([]) // [{ barcode, name, pid, counted, system }]
  const [scanInput, setScanInput] = useState('')
  const [lastMsg, setLastMsg]   = useState(null) // { text, ok }
  const inputRef    = useRef(null)
  const productsRef = useRef([])

  useEffect(() => { productsRef.current = products }, [products])

  useEffect(() => {
    supabase.from('products').select('id, name, barcode, stock').eq('active', true)
      .then(({ data }) => { if (data) setProducts(data) })
    try {
      const saved = JSON.parse(localStorage.getItem('stock_count_session') || 'null')
      if (saved) setCounts(saved)
    } catch {}
    inputRef.current?.focus()
  }, [])

  const flashMsg = useCallback((text, ok = true) => {
    setLastMsg({ text, ok })
    setTimeout(() => setLastMsg(null), 2000)
  }, [])

  const processBarcode = useCallback((raw) => {
    const bc = convertThaiBarcode(raw.trim()).toUpperCase()
    if (!bc) return
    const prod = productsRef.current.find(p => (p.barcode || '').toUpperCase() === bc)
    if (!prod) { flashMsg(`ไม่พบสินค้า: ${bc}`, false); return }

    flashMsg(`+1 ${prod.name}`)
    setCounts(prev => {
      const existing = prev.find(c => c.barcode === bc)
      const next = existing
        ? prev.map(c => c.barcode === bc ? { ...c, counted: c.counted + 1 } : c)
        : [{ barcode: bc, pid: prod.id, name: prod.name, counted: 1, system: prod.stock || 0 }, ...prev]
      localStorage.setItem('stock_count_session', JSON.stringify(next))
      return next
    })
  }, [flashMsg])

  function handleInputKey(e) {
    if (e.key === 'Enter') {
      processBarcode(scanInput)
      setScanInput('')
    }
  }

  function adjustCount(barcode, delta) {
    setCounts(prev => {
      const next = prev.map(c => c.barcode === barcode
        ? { ...c, counted: Math.max(0, c.counted + delta) }
        : c
      ).filter(c => c.counted > 0)
      localStorage.setItem('stock_count_session', JSON.stringify(next))
      return next
    })
  }

  function handleReset() {
    if (!confirm('ล้างข้อมูลนับสต๊อกทั้งหมด?')) return
    setCounts([])
    localStorage.removeItem('stock_count_session')
  }

  function handleExport() {
    const rows = [['บาร์โค้ด', 'ชื่อสินค้า', 'นับได้', 'ระบบ', 'ต่าง']]
    counts.forEach(c => rows.push([c.barcode, c.name, c.counted, c.system, c.counted - c.system]))
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `stock-count-${new Date().toLocaleDateString('sv-SE')}.csv`
    a.click()
  }

  const totalItems = counts.reduce((s, c) => s + c.counted, 0)
  const diffCount  = counts.filter(c => c.counted !== c.system).length

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-700">📦 นับสต๊อก</h1>
        <div className="flex gap-2">
          {counts.length > 0 && (
            <button onClick={handleExport}
              className="text-sm text-brand border border-brand px-3 py-1.5 rounded-lg font-medium">
              ส่งออก CSV
            </button>
          )}
          <button onClick={handleReset}
            className="text-sm text-red-500 border border-red-300 px-3 py-1.5 rounded-lg font-medium">
            ล้างทั้งหมด
          </button>
        </div>
      </div>

      {/* Barcode input */}
      <div className="mb-4">
        <input
          ref={inputRef}
          type="text"
          value={scanInput}
          onChange={e => setScanInput(e.target.value)}
          onKeyDown={handleInputKey}
          onBlur={() => setTimeout(() => inputRef.current?.focus(), 80)}
          placeholder="สแกนหรือพิมพ์บาร์โค้ด..."
          className="w-full border-2 border-brand rounded-xl px-4 py-3 text-xl focus:outline-none focus:ring-2 focus:ring-brand/50"
          style={{ fontFamily: 'var(--font-kanit), sans-serif' }}
        />
        {lastMsg && (
          <p className={`text-base mt-1.5 px-1 font-medium transition-all ${lastMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
            {lastMsg.text}
          </p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl p-3 text-center shadow-sm">
          <div className="text-3xl font-bold text-slate-700">{counts.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">SKU</div>
        </div>
        <div className="bg-white rounded-xl p-3 text-center shadow-sm">
          <div className="text-3xl font-bold text-slate-700">{fmt(totalItems)}</div>
          <div className="text-xs text-slate-500 mt-0.5">ชิ้นทั้งหมด</div>
        </div>
        <div className={`rounded-xl p-3 text-center shadow-sm ${diffCount > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className={`text-3xl font-bold ${diffCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{diffCount}</div>
          <div className="text-xs text-slate-500 mt-0.5">ต่างจากระบบ</div>
        </div>
      </div>

      {/* Count list */}
      {counts.length === 0 ? (
        <div className="text-center text-slate-400 py-20">
          <div className="text-6xl mb-4">📷</div>
          <p className="text-lg">เริ่มสแกนสินค้าเพื่อนับสต๊อก</p>
          <p className="text-sm mt-2">รองรับทั้งสแกนเนอร์ HID และการพิมพ์</p>
        </div>
      ) : (
        <div className="space-y-2">
          {counts.map(c => {
            const diff = c.counted - c.system
            return (
              <div key={c.barcode} className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-700 truncate">{c.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{c.barcode}</div>
                  <div className="text-sm text-slate-500 mt-1">
                    ระบบ: <span className="font-medium">{fmt(c.system)}</span> ชิ้น
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => adjustCount(c.barcode, -1)}
                    className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 font-bold text-xl flex items-center justify-center active:scale-95">
                    −
                  </button>
                  <span className="text-2xl font-bold text-slate-700 w-12 text-center">{c.counted}</span>
                  <button onClick={() => adjustCount(c.barcode, 1)}
                    className="w-9 h-9 rounded-full text-brand font-bold text-xl flex items-center justify-center active:scale-95"
                    style={{ background: 'rgba(199,44,65,0.1)' }}>
                    +
                  </button>
                </div>
                <div className={`text-base font-bold w-14 text-right flex-shrink-0 ${
                  diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'
                }`}>
                  {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : `${diff}`}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
